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
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configurar SendGrid
if (process.env.SENDGRID_API_KEY && process.env.SENDGRID_API_KEY.startsWith('SG.')) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    console.log('✅ SendGrid configurado correctamente');
} else {
    console.warn('⚠️ SendGrid no configurado - usando modo simulado');
}

// CORS configuration
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

// Función para generar tokens
function generateVerificationToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Función de email (con fallback a simulado)
async function sendVerificationEmail(email, token) {
    const verificationLink = `https://product-ai-backend.onrender.com/verify-email?token=${token}`;
    
    // Si no hay SendGrid configurado, modo simulado
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
        console.error('❌ Error enviando email:', error.response?.body || error.message);
        return false;
    }
}

// [AQUÍ VAN TODAS TUS RUTAS EXISTENTES: 
//  saveUserMemory, getUserMemory, buildAIContext, 
//  register, verify-email, login, generate-description, etc.]

// ============================================
// RECUPERACIÓN DE CONTRASEÑA (NUEVAS RUTAS)
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
        
        // Usar la misma lógica de email (simulado o real)
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
            message: 'Contraseña actualizada correctamente. Ya puedes iniciar sesión.'
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
    console.log(`📧 Email: ${process.env.SENDGRID_API_KEY ? 'SendGrid configurado' : 'Modo simulado'}`);
    console.log(`🤖 IA: OpenAI conectada`);
    console.log(`🌐 CORS permitidos:`, allowedOrigins);
});
