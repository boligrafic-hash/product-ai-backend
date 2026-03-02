const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
const bcrypt = require('bcrypt');
const session = require('express-session');
const passport = require('passport');
const sgMail = require('@sendgrid/mail');
const crypto = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configurar SendGrid con la API key
if (process.env.SENDGRID_API_KEY && process.env.SENDGRID_API_KEY.startsWith('SG.')) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    console.log('✅ SendGrid configurado correctamente');
} else {
    console.warn('⚠️ SendGrid no configurado - usando modo simulado (los tokens se muestran en consola)');
}

// Inicializar Google Gemini
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// ============================================
// CONFIGURACIÓN DE CORS
// ============================================
const allowedOrigins = [
    'http://localhost:3001',
    'https://product-ai-frontend.vercel.app',
    'https://product-ai-frontend-j3hn.vercel.app'
];

app.use(cors({
    origin: function(origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.log('🚫 Bloqueado por CORS - Origen no permitido:', origin);
            console.log('✅ Orígenes permitidos:', allowedOrigins);
            callback(new Error('No autorizado por CORS'));
        }
    },
    credentials: true,
    optionsSuccessStatus: 200
}));

app.use(express.json());

app.use(session({
    secret: process.env.SESSION_SECRET || 'tu-secreto-temporal',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
    }
}));

app.use(passport.initialize());
app.use(passport.session());

const dbConfig = {
    host: process.env.TIDB_HOST,
    port: Number(process.env.TIDB_PORT),
    user: process.env.TIDB_USER,
    password: process.env.TIDB_PASSWORD,
    database: process.env.TIDB_DATABASE,
    ssl: process.env.TIDB_ENABLE_SSL === 'true' ? {} : null
};

// ============================================
// FUNCIÓN DE EMAIL (REAL O SIMULADO)
// ============================================
function generateVerificationToken() {
    return crypto.randomBytes(32).toString('hex');
}

async function sendVerificationEmail(email, token) {
    const verificationLink = `https://product-ai-backend.onrender.com/verify-email?token=${token}`;
    
    if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_API_KEY.startsWith('SG.')) {
        console.log(`[SIMULADO] Email de verificación para ${email}: ${verificationLink}`);
        return true;
    }
    
    const msg = {
        to: email,
        from: process.env.VERIFIED_SENDER || 'info@boligrafic.site',
        subject: 'Verify your email address - AI Description Generator',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #667eea;">Welcome to AI Description Generator!</h2>
                <p>Thanks for signing up! Please verify your email address to activate your account.</p>
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${verificationLink}" 
                       style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                              color: white; padding: 12px 24px; text-decoration: none; 
                              border-radius: 5px; display: inline-block;">
                        Verify Email
                    </a>
                </div>
                <p>Or copy this link: <br> ${verificationLink}</p>
                <p>This link will expire in 24 hours.</p>
                <hr>
                <p style="color: #666; font-size: 12px;">
                    If you didn't create an account, you can ignore this email.
                </p>
            </div>
        `
    };

    try {
        await sgMail.send(msg);
        console.log(`✅ Email de verificación enviado a ${email}`);
        return true;
    } catch (error) {
        console.error('❌ Error enviando email con SendGrid:', error.response?.body || error.message);
        return false;
    }
}

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [users] = await connection.execute(
            'SELECT id, email, full_name, plan, is_verified FROM profiles WHERE id = ?',
            [id]
        );
        done(null, users[0] || null);
    } catch (error) {
        done(error, null);
    } finally {
        if (connection) await connection.end();
    }
});

// ============================================
// FUNCIONES DE MEMORIA
// ============================================
async function saveUserMemory(connection, userId, type, key, value) {
    try {
        const [existing] = await connection.execute(
            'SELECT id FROM user_memory WHERE user_id = ? AND memory_type = ? AND memory_key = ?',
            [userId, type, key]
        );
        if (existing.length > 0) {
            await connection.execute(
                'UPDATE user_memory SET memory_value = ? WHERE user_id = ? AND memory_type = ? AND memory_key = ?',
                [value, userId, type, key]
            );
        } else {
            await connection.execute(
                'INSERT INTO user_memory (user_id, memory_type, memory_key, memory_value) VALUES (?, ?, ?, ?)',
                [userId, type, key, value]
            );
        }
    } catch (error) {
        console.error('Error guardando memoria:', error);
    }
}

async function getUserMemory(connection, userId, type = null) {
    try {
        let query = 'SELECT memory_type, memory_key, memory_value FROM user_memory WHERE user_id = ?';
        const params = [userId];
        if (type) {
            query += ' AND memory_type = ?';
            params.push(type);
        }
        const [rows] = await connection.execute(query, params);
        return rows;
    } catch (error) {
        console.error('Error obteniendo memoria:', error);
        return [];
    }
}

async function buildAIContext(connection, userId, productDetails, tone) {
    const memories = await getUserMemory(connection, userId);
    let contextPrompt = '';
    const nichoMem = memories.find(m => m.memory_type === 'nicho');
    if (nichoMem) contextPrompt += `\nNicho de negocio: ${nichoMem.memory_value}`;
    const styleMem = memories.find(m => m.memory_type === 'style' && m.memory_key === 'preferred_style');
    if (styleMem) contextPrompt += `\nEstilo preferido: ${styleMem.memory_value}`;
    const productHistory = memories.filter(m => m.memory_type === 'product_history').slice(-3);
    if (productHistory.length > 0) {
        contextPrompt += '\n\nProductos descritos recientemente:';
        productHistory.forEach((p, i) => contextPrompt += `\n${i+1}. ${p.memory_value}`);
    }
    return contextPrompt;
}

// ============================================
// RUTAS EXISTENTES
// ============================================

app.post('/register', async (req, res) => {
    const { email, password, full_name, nicho, preferred_style } = req.body;
    let connection;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email y password son requeridos' });
    }

    try {
        connection = await mysql.createConnection(dbConfig);
        
        const [existing] = await connection.execute(
            'SELECT id FROM profiles WHERE email = ?',
            [email]
        );

        if (existing.length > 0) {
            return res.status(400).json({ error: 'El email ya está registrado' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = uuidv4();
        const verificationToken = generateVerificationToken();
        
        await connection.execute(
            'INSERT INTO profiles (id, email, password, full_name, plan, is_verified, verification_token) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [userId, email, hashedPassword, full_name || '', 'free', false, verificationToken]
        );
        
        await connection.execute(
            'INSERT INTO usage_limits (user_id, count, month) VALUES (?, 0, CURDATE())',
            [userId]
        );
        
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24);
        
        await connection.execute(
            'INSERT INTO email_verifications (user_id, email, token, expires_at) VALUES (?, ?, ?, ?)',
            [userId, email, verificationToken, expiresAt]
        );
        
        if (nicho) {
            await saveUserMemory(connection, userId, 'nicho', 'primary', nicho);
        }
        if (preferred_style) {
            await saveUserMemory(connection, userId, 'style', 'preferred_style', preferred_style);
        }

        const emailSent = await sendVerificationEmail(email, verificationToken);
        
        if (!emailSent) {
            console.warn('⚠️ El email no pudo enviarse, pero el usuario fue registrado');
        }

        res.json({ 
            success: true, 
            user_id: userId,
            message: emailSent 
                ? 'Registro exitoso. Por favor verifica tu email para activar tu cuenta.'
                : 'Registro exitoso. Hubo un problema enviando el email de verificación. Contacta a soporte.'
        });

    } catch (error) {
        console.error('Error en registro:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (connection) await connection.end();
    }
});

app.get('/verify-email', async (req, res) => {
    const { token } = req.query;
    let connection;

    if (!token) {
        return res.redirect('https://product-ai-frontend-j3hn.vercel.app?verification=failed');
    }

    try {
        connection = await mysql.createConnection(dbConfig);

        const [verifications] = await connection.execute(
            'SELECT * FROM email_verifications WHERE token = ? AND expires_at > NOW() AND verified_at IS NULL',
            [token]
        );

        if (verifications.length === 0) {
            return res.redirect('https://product-ai-frontend-j3hn.vercel.app?verification=invalid');
        }

        const verification = verifications[0];

        await connection.execute(
            'UPDATE email_verifications SET verified_at = NOW() WHERE id = ?',
            [verification.id]
        );

        await connection.execute(
            'UPDATE profiles SET is_verified = TRUE, verification_token = NULL WHERE id = ?',
            [verification.user_id]
        );

        res.redirect('https://product-ai-frontend-j3hn.vercel.app?verification=success');

    } catch (error) {
        console.error('Error verifying email:', error);
        res.redirect('https://product-ai-frontend-j3hn.vercel.app?verification=error');
    } finally {
        if (connection) await connection.end();
    }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    let connection;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email y password son requeridos' });
    }

    try {
        connection = await mysql.createConnection(dbConfig);
        
        const [users] = await connection.execute(
            'SELECT id, email, password, full_name, plan, is_verified FROM profiles WHERE email = ?',
            [email]
        );

        if (users.length === 0) {
            return res.status(401).json({ error: 'Email o contraseña incorrectos' });
        }

        const user = users[0];

        if (!user.password) {
            return res.status(401).json({ error: 'Email o contraseña incorrectos' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        
        if (!validPassword) {
            return res.status(401).json({ error: 'Email o contraseña incorrectos' });
        }

        if (!user.is_verified) {
            return res.status(403).json({ 
                error: 'Email no verificado',
                needs_verification: true,
                email: user.email
            });
        }

        const [usage] = await connection.execute(
            'SELECT count FROM usage_limits WHERE user_id = ? AND month = CURDATE()',
            [user.id]
        );

        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                plan: user.plan,
                is_verified: user.is_verified,
                usage_today: usage.length > 0 ? usage[0].count : 0
            }
        });

    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (connection) await connection.end();
    }
});

app.post('/resend-verification', async (req, res) => {
    const { email } = req.body;
    let connection;

    if (!email) {
        return res.status(400).json({ error: 'Email requerido' });
    }

    try {
        connection = await mysql.createConnection(dbConfig);

        const [users] = await connection.execute(
            'SELECT id, email FROM profiles WHERE email = ? AND is_verified = FALSE',
            [email]
        );

        if (users.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado o ya verificado' });
        }

        const user = users[0];

        const verificationToken = generateVerificationToken();
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24);

        await connection.execute(
            'INSERT INTO email_verifications (user_id, email, token, expires_at) VALUES (?, ?, ?, ?)',
            [user.id, email, verificationToken, expiresAt]
        );

        await sendVerificationEmail(email, verificationToken);

        res.json({ 
            success: true, 
            message: 'Email de verificación reenviado' 
        });

    } catch (error) {
        console.error('Error reenviando verificación:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (connection) await connection.end();
    }
});

// ============================================
// RUTA DE GENERACIÓN DE DESCRIPCIONES (GOOGLE GEMINI)
// ============================================
app.post('/generate-description', async (req, res) => {
    const { user_id, product_details, tone, language = 'en', include_seo = true } = req.body;
    let connection;

    if (!user_id) {
        return res.status(401).json({ error: 'Usuario no autenticado' });
    }

    // ============================================
    // CONFIGURACIÓN DE IDIOMA (FUERA DEL TRY)
    // ============================================
    const languageConfig = {
        en: {
            system: 'You are a professional e-commerce copywriter specializing in creating compelling product descriptions for the US market. Your tone is persuasive, benefit-focused, and tailored to American shoppers.',
            audience: 'US online shoppers. Use American English spelling and terminology.',
            keywords: 'Include natural SEO keywords relevant to the product category.',
            fallbackTitle: 'Discover the ultimate in comfort and style',
            fallbackDesc: 'Discover the ultimate in comfort and style with this premium product. Perfect for any occasion.'
        },
        es: {
            system: 'Eres un copywriter experto en e-commerce especializado en crear descripciones de productos persuasivas para el mercado hispanohablante. Tu tono es profesional y cercano.',
            audience: 'Público hispano. Usa español neutro y claro.',
            keywords: 'Incluye palabras clave SEO en español de forma natural.',
            fallbackTitle: 'Descubre lo último en comodidad y estilo',
            fallbackDesc: 'Descubre lo último en comodidad y estilo con este producto premium. Perfecto para cualquier ocasión.'
        }
    };

    const config = languageConfig[language] || languageConfig.en;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [userCheck] = await connection.execute(
            'SELECT is_verified FROM profiles WHERE id = ?',
            [user_id]
        );

        if (userCheck.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        if (!userCheck[0].is_verified) {
            return res.status(403).json({ 
                error: 'Email no verificado',
                needs_verification: true
            });
        }

        const [usageRows] = await connection.execute(
            'SELECT count, plan FROM usage_limits ul JOIN profiles p ON ul.user_id = p.id WHERE ul.user_id = ? AND ul.month = CURDATE()',
            [user_id]
        );

        let currentCount = 0, plan = 'free';
        if (usageRows.length > 0) {
            currentCount = usageRows[0].count;
            plan = usageRows[0].plan;
        }

        const limit = plan === 'free' ? 5 : plan === 'pro' ? 50 : 1000;
        if (currentCount >= limit) {
            return res.status(403).json({ 
                error: 'Límite alcanzado', 
                plan, 
                limit, 
                current: currentCount 
            });
        }

        const contextPrompt = await buildAIContext(connection, user_id, product_details, tone);
        await saveUserMemory(connection, user_id, 'product_history', `product_${Date.now()}`, product_details);

        // Construir el prompt según el tono seleccionado
        const toneDescription = {
            persuasive: language === 'en' ? 'persuasive, benefit-focused, and compelling' : 'persuasivo, centrado en beneficios y convincente',
            casual: language === 'en' ? 'casual, friendly, and conversational' : 'casual, amigable y conversacional',
            luxury: language === 'en' ? 'elegant, sophisticated, and aspirational' : 'elegante, sofisticado y aspiracional'
        };

        const mainPrompt = `Act as an expert e-commerce copywriter specializing in product descriptions.

Generate a product description in ${language === 'en' ? 'English' : 'Spanish'} for the following item:
"${product_details}"

Target audience: ${config.audience}
${contextPrompt}

The description must follow these guidelines:
- **Tone:** ${toneDescription[tone] || toneDescription.persuasive}
- **Focus:** Highlight emotional benefits and how the customer will feel, not just technical features.
- **SEO:** ${config.keywords}
- **Structure:** 
  1. An attractive, click-worthy title.
  2. An engaging first paragraph that connects emotionally.
  3. A list of 3-4 key features/benefits in bullet points.
  4. A closing paragraph with a subtle call to action.
- **Length:** Between 200 and 250 words.
- **Language:** ${language === 'en' ? 'Natural, fluent American English.' : 'Español neutro, claro y fluido.'}`;

        // ============================================
        // LLAMADA A GOOGLE GEMINI (GRATIS Y ROBUSTO)
        // ============================================
        
        // Obtener el modelo (Gemini 1.5 Flash es rápido y tiene excelente relación calidad/precio)
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        // Generar descripción principal
        const result = await model.generateContent(mainPrompt);
        const response = await result.response;
        let mainDescription = response.text();

        let metaDescription = '';
        let suggestedKeywords = [];

        if (include_seo) {
            // Meta description con Gemini
            const metaPrompt = language === 'en' 
                ? `Generate a persuasive SEO meta description (max 155 characters) for: ${product_details}. Include relevant keywords and a call to action.`
                : `Genera una meta descripción persuasiva para SEO (máx 155 caracteres) para: ${product_details}. Incluye palabras clave relevantes y llamada a la acción.`;

            const metaResult = await model.generateContent(metaPrompt);
            const metaResponse = await metaResult.response;
            metaDescription = metaResponse.text();

            // Keywords con Gemini
            const kwPrompt = language === 'en'
                ? `Generate 5-7 SEO keywords for: ${product_details}. Include relevant terms for the US market. Return as comma-separated list.`
                : `Genera 5-7 palabras clave SEO para: ${product_details}. Incluye términos relevantes para el mercado hispano. Devuélvelas como lista separada por comas.`;

            const kwResult = await model.generateContent(kwPrompt);
            const kwResponse = await kwResult.response;
            const kwText = kwResponse.text();
            suggestedKeywords = kwText.split(',').map(k => k.trim());
        }

        await connection.execute(
            'INSERT INTO descriptions (user_id, product_details, tone, generated_description) VALUES (?, ?, ?, ?)',
            [user_id, product_details, tone, mainDescription]
        );

        if (usageRows.length > 0) {
            await connection.execute(
                'UPDATE usage_limits SET count = count + 1 WHERE user_id = ? AND month = CURDATE()', 
                [user_id]
            );
        } else {
            await connection.execute(
                'INSERT INTO usage_limits (user_id, count, month) VALUES (?, 1, CURDATE())', 
                [user_id]
            );
        }

        res.json({ 
            success: true, 
            description: mainDescription, 
            meta_description: metaDescription, 
            suggested_keywords: suggestedKeywords, 
            remaining: limit - (currentCount + 1) 
        });

    } catch (error) {
        console.error('Error:', error);
        
        const fallbackConfig = languageConfig[req.body.language || 'en'] || languageConfig.en;
        
        res.json({ 
            success: true, 
            description: fallbackConfig.fallbackDesc, 
            meta_description: `Shop ${req.body.product_details || 'this product'} online. Fast shipping.`, 
            suggested_keywords: language === 'en' 
                ? ['quality', 'premium', 'style', 'trend', 'shop'] 
                : ['calidad', 'premium', 'estilo', 'moda', 'tienda'], 
            remaining: limit - (currentCount + 1),
            warning: 'Usando descripción de respaldo' 
        });
    } finally {
        if (connection) await connection.end();
    }
});

app.post('/user-preferences', async (req, res) => {
    const { user_id, nicho, preferred_style } = req.body;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        if (nicho) await saveUserMemory(connection, user_id, 'nicho', 'primary', nicho);
        if (preferred_style) await saveUserMemory(connection, user_id, 'style', 'preferred_style', preferred_style);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        if (connection) await connection.end();
    }
});

app.get('/my-descriptions/:userId', async (req, res) => {
    const { userId } = req.params;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute(
            'SELECT * FROM descriptions WHERE user_id = ? ORDER BY created_at DESC', 
            [userId]
        );
        res.json({ success: true, descriptions: rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        if (connection) await connection.end();
    }
});

app.get('/current-user', (req, res) => {
    if (req.isAuthenticated && req.isAuthenticated()) {
        res.json({ user: req.user });
    } else {
        res.json({ user: null });
    }
});

app.get('/logout', (req, res) => {
    req.logout((err) => {
        if (err) console.error('Error en logout:', err);
        res.redirect('https://product-ai-frontend-j3hn.vercel.app');
    });
});

app.get('/', (req, res) => {
    res.json({ 
        message: '✅ Servidor funcionando',
        auth: 'Registro y Login con email disponibles',
        cors_allowed: allowedOrigins
    });
});

// ============================================
// NUEVAS RUTAS DE RECUPERACIÓN DE CONTRASEÑA
// ============================================

app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    let connection;

    if (!email) {
        return res.status(400).json({ error: 'Email requerido' });
    }

    try {
        connection = await mysql.createConnection(dbConfig);

        const [users] = await connection.execute(
            'SELECT id, email FROM profiles WHERE email = ?',
            [email]
        );

        if (users.length === 0) {
            return res.json({ 
                success: true, 
                message: 'Si el email existe, recibirás instrucciones para restablecer tu contraseña.'
            });
        }

        const user = users[0];
        const resetToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 1);

        await connection.execute(
            'INSERT INTO password_resets (user_id, email, token, expires_at) VALUES (?, ?, ?, ?)',
            [user.id, email, resetToken, expiresAt]
        );

        const resetLink = `https://product-ai-frontend-j3hn.vercel.app/reset-password?token=${resetToken}`;
        
        if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_API_KEY.startsWith('SG.')) {
            console.log(`[SIMULADO] Email de recuperación para ${email}: ${resetLink}`);
        } else {
            const msg = {
                to: email,
                from: process.env.VERIFIED_SENDER || 'info@boligrafic.site',
                subject: 'Restablece tu contraseña - AI Description Generator',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #667eea;">¿Olvidaste tu contraseña?</h2>
                        <p>Has solicitado restablecer tu contraseña. Haz clic en el siguiente enlace:</p>
                        <div style="text-align: center; margin: 30px 0;">
                            <a href="${resetLink}" 
                               style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                                      color: white; padding: 12px 24px; text-decoration: none; 
                                      border-radius: 5px; display: inline-block;">
                                Restablecer contraseña
                            </a>
                        </div>
                        <p>Este enlace expirará en 1 hora.</p>
                    </div>
                `
            };
            await sgMail.send(msg);
        }

        res.json({ 
            success: true, 
            message: 'Si el email existe, recibirás instrucciones para restablecer tu contraseña.'
        });

    } catch (error) {
        console.error('Error en forgot-password:', error);
        res.status(500).json({ error: 'Error al procesar la solicitud' });
    } finally {
        if (connection) await connection.end();
    }
});

app.get('/reset-password', async (req, res) => {
    const { token } = req.query;
    let connection;

    if (!token) {
        return res.redirect('https://product-ai-frontend-j3hn.vercel.app?reset=invalid');
    }

    try {
        connection = await mysql.createConnection(dbConfig);

        const [resets] = await connection.execute(
            'SELECT * FROM password_resets WHERE token = ? AND expires_at > NOW() AND used = FALSE',
            [token]
        );

        if (resets.length === 0) {
            return res.redirect('https://product-ai-frontend-j3hn.vercel.app?reset=invalid');
        }

        res.redirect(`https://product-ai-frontend-j3hn.vercel.app/reset-password?token=${token}`);

    } catch (error) {
        console.error('Error en reset-password:', error);
        res.redirect('https://product-ai-frontend-j3hn.vercel.app?reset=error');
    } finally {
        if (connection) await connection.end();
    }
});

app.post('/update-password', async (req, res) => {
    const { token, newPassword } = req.body;
    let connection;

    if (!token || !newPassword) {
        return res.status(400).json({ error: 'Token y nueva contraseña requeridos' });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    try {
        connection = await mysql.createConnection(dbConfig);

        const [resets] = await connection.execute(
            'SELECT * FROM password_resets WHERE token = ? AND expires_at > NOW() AND used = FALSE',
            [token]
        );

        if (resets.length === 0) {
            return res.status(400).json({ error: 'Token inválido o expirado' });
        }

        const reset = resets[0];
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await connection.execute(
            'UPDATE profiles SET password = ? WHERE id = ?',
            [hashedPassword, reset.user_id]
        );

        await connection.execute(
            'UPDATE password_resets SET used = TRUE WHERE id = ?',
            [reset.id]
        );

        res.json({ 
            success: true, 
            message: 'Contraseña actualizada correctamente. Ya puedes iniciar sesión con tu nueva contraseña.'
        });

    } catch (error) {
        console.error('Error en update-password:', error);
        res.status(500).json({ error: 'Error al actualizar la contraseña' });
    } finally {
        if (connection) await connection.end();
    }
});

// ============================================
// INICIAR SERVIDOR
// ============================================
app.listen(PORT, () => {
    console.log(`✅ Servidor en http://localhost:${PORT}`);
    console.log(`🔐 Auth: Registro y Login con email`);
    console.log(`📧 Email: ${process.env.SENDGRID_API_KEY && process.env.SENDGRID_API_KEY.startsWith('SG.') ? 'SendGrid configurado' : 'Modo simulado'}`);
    console.log(`🤖 IA: Google Gemini conectado (modelo: gemini-1.5-flash)`);
    console.log(`🌐 CORS permitidos:`, allowedOrigins);
});
