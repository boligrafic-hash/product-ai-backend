const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
const bcrypt = require('bcrypt');
const session = require('express-session');
const passport = require('passport');
// GoogleStrategy comentado temporalmente
// const GoogleStrategy = require('passport-google-oauth20').Strategy;
// Nodemailer comentado temporalmente
// const nodemailer = require('nodemailer');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de CORS mejorada para producción y desarrollo
const allowedOrigins = [
    'http://localhost:3001',
    'https://product-ai-frontend.vercel.app', // Tu frontend en Vercel
    process.env.ALLOWED_ORIGIN // Para añadir más orígenes desde variable de entorno
].filter(Boolean); // Filtra valores vacíos

app.use(cors({
    origin: function(origin, callback) {
        // Permitir peticiones sin origen (como apps móviles, Postman o el mismo servidor)
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
        secure: process.env.NODE_ENV === 'production', // true solo en producción con HTTPS
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

// Nodemailer comentado temporalmente
/*
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});
*/

function generateVerificationToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Función de email comentada temporalmente
async function sendVerificationEmail(email, token) {
    console.log(`[SIMULADO] Email de verificación para ${email}: https://product-ai-backend.onrender.com/verify-email?token=${token}`);
    return true;
    /*
    const verificationLink = `https://product-ai-backend.onrender.com/verify-email?token=${token}`;
    
    const mailOptions = {
        from: `"AI Descriptions" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Verify your email address',
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
        const info = await transporter.sendMail(mailOptions);
        console.log('Verification email sent:', info.messageId);
        return true;
    } catch (error) {
        console.error('Error sending email:', error);
        return false;
    }
    */
}

// Google OAuth comentado temporalmente
/*
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: '/auth/google/callback'
}, async (accessToken, refreshToken, profile, done) => {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);

        const email = profile.emails[0].value;
        const full_name = profile.displayName;

        const [users] = await connection.execute(
            'SELECT * FROM profiles WHERE email = ?',
            [email]
        );

        let user;
        if (users.length === 0) {
            const userId = uuidv4();
            await connection.execute(
                'INSERT INTO profiles (id, email, full_name, plan, is_verified) VALUES (?, ?, ?, ?, ?)',
                [userId, email, full_name, 'free', true]
            );
            
            await connection.execute(
                'INSERT INTO usage_limits (user_id, count, month) VALUES (?, 0, CURDATE())',
                [userId]
            );

            user = { id: userId, email, full_name, plan: 'free' };
        } else {
            user = users[0];
            if (!user.is_verified) {
                await connection.execute(
                    'UPDATE profiles SET is_verified = TRUE WHERE id = ?',
                    [user.id]
                );
            }
        }

        return done(null, user);

    } catch (error) {
        console.error('Error en Google auth:', error);
        return done(error, null);
    } finally {
        if (connection) await connection.end();
    }
}));
*/

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

// Rutas de Google comentadas temporalmente
/*
app.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: 'https://product-ai-frontend.vercel.app?auth=failed' }),
    (req, res) => {
        const user = req.user;
        const userData = {
            id: user.id,
            email: user.email,
            full_name: user.full_name,
            plan: user.plan,
            is_verified: user.is_verified
        };
        const userParam = encodeURIComponent(JSON.stringify(userData));
        res.redirect(`https://product-ai-frontend.vercel.app?googleUser=${userParam}`);
    }
);
*/

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

        sendVerificationEmail(email, verificationToken).catch(err => 
            console.error('Error sending verification email:', err)
        );

        res.json({ 
            success: true, 
            user_id: userId,
            message: 'Registro exitoso. Por favor verifica tu email para activar tu cuenta.'
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
        return res.redirect('https://product-ai-frontend.vercel.app?verification=failed');
    }

    try {
        connection = await mysql.createConnection(dbConfig);

        const [verifications] = await connection.execute(
            'SELECT * FROM email_verifications WHERE token = ? AND expires_at > NOW() AND verified_at IS NULL',
            [token]
        );

        if (verifications.length === 0) {
            return res.redirect('https://product-ai-frontend.vercel.app?verification=invalid');
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

        res.redirect('https://product-ai-frontend.vercel.app?verification=success');

    } catch (error) {
        console.error('Error verifying email:', error);
        res.redirect('https://product-ai-frontend.vercel.app?verification=error');
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

        sendVerificationEmail(email, verificationToken).catch(err => 
            console.error('Error sending verification email:', err)
        );

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

app.post('/generate-description', async (req, res) => {
    const { user_id, product_details, tone, language = 'en', include_seo = true } = req.body;
    let connection;

    if (!user_id) {
        return res.status(401).json({ error: 'Usuario no autenticado' });
    }

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

        const langInst = { 
            en: 'English. US shoppers.', 
            es: 'español. Público hispano.', 
            pt: 'português. Público brasileiro.' 
        };

        const mainPrompt = `Write a ${tone} product description for: ${product_details}. ${langInst[language] || langInst.en} ${contextPrompt}`;

        const mainResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` 
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: [
                    { role: 'system', content: 'E-commerce copywriter.' }, 
                    { role: 'user', content: mainPrompt }
                ],
                temperature: 0.7, 
                max_tokens: 400
            })
        });

        const mainData = await mainResponse.json();
        if (mainData.error) throw new Error(mainData.error.message);

        let mainDescription = '', metaDescription = '', suggestedKeywords = [];

        if (mainData.choices?.[0]?.message) {
            mainDescription = mainData.choices[0].message.content;

            if (include_seo) {
                const metaRes = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST', 
                    headers: { 
                        'Content-Type': 'application/json', 
                        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` 
                    },
                    body: JSON.stringify({
                        model: 'gpt-3.5-turbo',
                        messages: [
                            { role: 'system', content: 'SEO specialist.' }, 
                            { role: 'user', content: `Meta description (max 155 chars) for: ${product_details}` }
                        ],
                        temperature: 0.5, 
                        max_tokens: 60
                    })
                });
                const metaData = await metaRes.json();
                if (metaData.choices?.[0]?.message) {
                    metaDescription = metaData.choices[0].message.content;
                }

                const kwRes = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST', 
                    headers: { 
                        'Content-Type': 'application/json', 
                        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` 
                    },
                    body: JSON.stringify({
                        model: 'gpt-3.5-turbo',
                        messages: [
                            { role: 'system', content: 'SEO keyword researcher.' }, 
                            { role: 'user', content: `5-7 keywords for: ${product_details}. Comma-separated.` }
                        ],
                        temperature: 0.6, 
                        max_tokens: 100
                    })
                });
                const kwData = await kwRes.json();
                if (kwData.choices?.[0]?.message) {
                    suggestedKeywords = kwData.choices[0].message.content.split(',').map(k => k.trim());
                }
            }
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
        res.json({ 
            success: true, 
            description: 'Discover the ultimate in comfort and style.', 
            meta_description: `Shop ${req.body.product_details || 'this product'} online.`, 
            suggested_keywords: ['quality', 'premium'], 
            remaining: '?', 
            warning: 'Usando respaldo' 
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
        res.redirect('https://product-ai-frontend.vercel.app');
    });
});

app.get('/', (req, res) => {
    res.json({ 
        message: '✅ Servidor funcionando (modo desarrollo - Google OAuth y Email comentados)',
        auth: 'Registro y Login con email disponibles',
        cors_allowed: allowedOrigins
    });
});

app.listen(PORT, () => {
    console.log(`✅ Servidor en http://localhost:${PORT} (MODO DESARROLLO)`);
    console.log(`🔐 Auth: Registro y Login con email (Google OAuth comentado)`);
    console.log(`📧 Email: Modo simulado (los tokens se muestran en consola)`);
    console.log(`🤖 IA: OpenAI conectada`);
    console.log(`🌐 CORS permitidos:`, allowedOrigins);
});
