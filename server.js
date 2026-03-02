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
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
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

// Inicializar Google Gemini con modelo correcto
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-pro'; // Usa 1.5-pro por defecto

// Función helper para llamar a Gemini con fallback
async function callGemini(prompt) {
    try {
        console.log(`🤖 Llamando a Gemini con modelo: ${GEMINI_MODEL}`);
        const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
        const result = await model.generateContent(prompt);
        return result.response;
    } catch (error) {
        console.error('Error con modelo principal:', error.message);
        
        // Fallback a gemini-1.0-pro si 1.5-pro falla
        if (GEMINI_MODEL === 'gemini-1.5-pro') {
            try {
                console.log('🔄 Intentando fallback con gemini-1.0-pro...');
                const fallbackModel = genAI.getGenerativeModel({ model: 'gemini-1.0-pro' });
                const result = await fallbackModel.generateContent(prompt);
                return result.response;
            } catch (fallbackError) {
                console.error('❌ Fallback también falló:', fallbackError.message);
                throw fallbackError;
            }
        }
        throw error;
    }
}

// Configuración de PostgreSQL para sesiones en producción
let sessionStore;
if (process.env.NODE_ENV === 'production' && process.env.DATABASE_URL) {
    const pgPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    sessionStore = new pgSession({
        pool: pgPool,
        tableName: 'session'
    });
    console.log('✅ Usando PostgreSQL para sesiones en producción');
} else {
    sessionStore = new session.MemoryStore();
    console.log('⚠️ Usando MemoryStore para sesiones (solo desarrollo)');
}

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
            callback(new Error('No autorizado por CORS'));
        }
    },
    credentials: true,
    optionsSuccessStatus: 200
}));

app.use(express.json());

app.use(session({
    store: sessionStore,
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
// ============================================
// FUNCIÓN PARA CREAR TABLAS SI NO EXISTEN
// ============================================
async function ensureTablesExist() {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        
        // Crear tabla user_memory si no existe
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS user_memory (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                memory_type VARCHAR(50) NOT NULL,
                memory_key VARCHAR(100) NOT NULL,
                memory_value TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_user_id (user_id),
                INDEX idx_type (memory_type),
                UNIQUE KEY unique_user_memory (user_id, memory_type, memory_key)
            )
        `);
        console.log('✅ Tabla user_memory verificada/creada');

        // Crear tabla session para PostgreSQL (si se usa)
        if (process.env.NODE_ENV === 'production' && process.env.DATABASE_URL) {
            // La tabla session la crea automáticamente connect-pg-simple
            console.log('✅ Tabla session será creada por connect-pg-simple');
        }

    } catch (error) {
        console.error('❌ Error creando tablas:', error);
    } finally {
        if (connection) await connection.end();
    }
}

// Llamar a la función al iniciar
ensureTablesExist();
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_user_id (user_id),
                INDEX idx_type (memory_type),
                UNIQUE KEY unique_user_memory (user_id, memory_type, memory_key)
            )
        `);
        console.log('✅ Tabla user_memory verificada/creada');

    } catch (error) {
        console.error('❌ Error creando tablas:', error);
    } finally {
        if (connection) await connection.end();
    }
}

// Llamar a la función al iniciar
ensureTablesExist();  // ← Línea 162 - DEBE COINCIDIR EXACTAMENTE
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
// FUNCIONES DE MEMORIA (AHORA CON TABLA VERIFICADA)
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
// RUTAS EXISTENTES (SIN CAMBIOS)
// ============================================
// [Todas tus rutas existentes se mantienen IGUAL]
// register, verify-email, login, resend-verification, etc.

// ... (mantén aquí todas tus rutas existentes sin cambios) ...

// ============================================
// RUTA DE GENERACIÓN DE DESCRIPCIONES (MODIFICADA PARA USAR callGemini)
// ============================================
app.post('/generate-description', async (req, res) => {
    const { user_id, product_details, tone, language = 'en', include_seo = true } = req.body;
    let connection;
    let limit = 5;
    let currentCount = 0;

    if (!user_id) {
        return res.status(401).json({ error: 'Usuario no autenticado' });
    }

    // ============================================
    // CONFIGURACIÓN DE IDIOMA
    // ============================================
    const languageConfig = {
        en: {
            audience: 'US online shoppers. Use American English spelling and terminology.',
            fallbackDesc: 'Discover the ultimate in comfort and style with this premium product. Perfect for any occasion.'
        },
        es: {
            audience: 'Público hispano. Usa español neutro y claro.',
            fallbackDesc: 'Descubre lo último en comodidad y estilo con este producto premium. Perfecto para cualquier ocasión.'
        }
    };

    const config = languageConfig[language] || languageConfig.en;

    // ============================================
    // PROMPTS PROFESIONALES POR ESTILO
    // ============================================
    const professionalPrompts = {
        storytelling: {
            prompt: language === 'en'
                ? `Craft an enchanting product description for: "${product_details}"\n\nWrite like a vintage fashion curator who has discovered a rare treasure. Your description should transport the reader to another era. Write between 200-250 words.`
                : `Crea una descripción encantadora para: "${product_details}"\n\nEscribe como un curador de moda vintage que ha descubierto un tesoro único. Tu descripción debe transportar al lector a otra época. Escribe entre 200-250 palabras.`
        },
        sustainable: {
            prompt: language === 'en'
                ? `Write a compelling sustainable fashion description for: "${product_details}"\n\nWrite like a conscious consumer advocate who believes fashion can change the world. Write 200-250 words.`
                : `Escribe una descripción convincente de moda sostenible para: "${product_details}"\n\nEscribe como un defensor del consumo consciente que cree que la moda puede cambiar el mundo. Escribe 200-250 palabras.`
        },
        expressive: {
            prompt: language === 'en'
                ? `Create an energetic, attitude-filled description for: "${product_details}"\n\nWrite like a street style influencer who knows exactly who they are. Write 200-250 words.`
                : `Crea una descripción enérgica y llena de actitud para: "${product_details}"\n\nEscribe como un influencer de estilo callejero que sabe exactamente quién es. Escribe 200-250 palabras.`
        }
    };

    const styleConfig = professionalPrompts[tone] || professionalPrompts.storytelling;

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

        let plan = 'free';
        if (usageRows.length > 0) {
            currentCount = usageRows[0].count;
            plan = usageRows[0].plan;
        }

        limit = plan === 'free' ? 5 : plan === 'pro' ? 50 : 1000;
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

        // ============================================
        // LLAMADA A GEMINI CON LA NUEVA FUNCIÓN
        // ============================================
        const response = await callGemini(styleConfig.prompt);
        let mainDescription = response.text();

        let metaDescription = '';
        let suggestedKeywords = [];

        if (include_seo) {
            // Meta description
            const metaPrompt = language === 'en'
                ? `Create a compelling SEO meta description (max 155 characters) for a ${tone} style product: ${product_details}. Make it irresistible.`
                : `Crea una meta descripción SEO convincente (máx 155 caracteres) para un producto de estilo ${tone}: ${product_details}. Hazla irresistible.`;
            
            const metaResponse = await callGemini(metaPrompt);
            metaDescription = metaResponse.text();

            // Keywords
            const kwPrompt = language === 'en'
                ? `Generate 5-7 powerful SEO keywords for a ${tone} style product: ${product_details}. Include emotional and descriptive terms. Return as comma-separated.`
                : `Genera 5-7 palabras clave SEO poderosas para un producto de estilo ${tone}: ${product_details}. Incluye términos emocionales y descriptivos. Devuélvelas separadas por comas.`;
            
            const kwResponse = await callGemini(kwPrompt);
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

// ============================================
// RUTA PARA OBTENER HISTORIAL DEL USUARIO
// ============================================
app.get('/my-descriptions/:userId', async (req, res) => {
    const { userId } = req.params;
    let connection;

    if (!userId) {
        return res.status(400).json({ error: 'userId requerido' });
    }

    try {
        connection = await mysql.createConnection(dbConfig);

        // Verificar que el usuario existe
        const [userCheck] = await connection.execute(
            'SELECT id FROM profiles WHERE id = ?',
            [userId]
        );

        if (userCheck.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        // Obtener las últimas 20 descripciones
        const [descriptions] = await connection.execute(
            `SELECT id, product_details, tone, generated_description, created_at 
             FROM descriptions 
             WHERE user_id = ? 
             ORDER BY created_at DESC 
             LIMIT 20`,
            [userId]
        );

        res.json({
            success: true,
            descriptions: descriptions
        });

    } catch (error) {
        console.error('Error obteniendo historial:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (connection) await connection.end();
    }
});

// ============================================
// RUTAS DE RECUPERACIÓN DE CONTRASEÑA
// ============================================
// [Mantén aquí todas tus rutas de recuperación existentes]
// forgot-password, reset-password, update-password, etc.

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
    console.log(`🤖 IA: Google Gemini - Modelo ${GEMINI_MODEL}`);
    console.log(`📝 Estilos disponibles: Storytelling Vintage, Sostenible, Expresivo Urbano`);
    console.log(`🌐 CORS permitidos:`, allowedOrigins);
    console.log(`🗄️  Sesiones: ${process.env.NODE_ENV === 'production' && process.env.DATABASE_URL ? 'PostgreSQL' : 'MemoryStore'}`);
});
