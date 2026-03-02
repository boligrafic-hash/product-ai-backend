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
// RUTA DE GENERACIÓN DE DESCRIPCIONES (PROFESIONAL)
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
            system: language === 'en' 
                ? 'You are a master storyteller specializing in vintage fashion. Your words transport readers to another era, evoking nostalgia and authenticity. Your descriptions are poetic, warm, and deeply evocative.'
                : 'Eres un maestro narrador especializado en moda vintage. Tus palabras transportan a los lectores a otra época, evocando nostalgia y autenticidad. Tus descripciones son poéticas, cálidas y profundamente evocadoras.',
            prompt: language === 'en'
                ? `Craft an enchanting product description for: "${product_details}"

Write like a vintage fashion curator who has discovered a rare treasure. Your description should:

✨ **OPEN WITH A HOOK:** Transport the reader to another time. Was this shirt worn at a 1950s jazz club? Did it inspire an artist in 1970s Paris?

📖 **TELL ITS STORY:** Imagine the life this garment has lived. The hands that embroidered it. The stories it could tell. Create a narrative that makes the reader feel they're buying a piece of history, not just fabric.

👐 **ENGAGE THE SENSES:** Describe how the aged cotton feels against skin. The weight of the fabric. The texture of the embroidery. Make them feel it.

💫 **CONNECT EMOTIONALLY:** This isn't just a shirt—it's a time machine. Help the reader imagine wearing it: sipping espresso in a vintage café, flipping through vinyl records, living a more romantic life.

🔍 **HIGHLIGHT WHAT MAKES IT SPECIAL:** The hand-stitched details. The unique fading. The way it's been preserved through decades. The authenticity of its vintage character.

🎯 **CLOSE WITH MEANING:** End with a call to action that feels like an invitation to own a memory, not just a purchase.

Write between 200-250 words. Use warm, evocative language. Be specific, be sensory, be unforgettable.`
                : `Crea una descripción encantadora para: "${product_details}"

Escribe como un curador de moda vintage que ha descubierto un tesoro único. Tu descripción debe:

✨ **ABRE CON UN GANCHO:** Transporta al lector a otra época. ¿Esta camisa se usó en un club de jazz de los 50? ¿Inspiró a un artista en el París de los 70?

📖 **CUENTA SU HISTORIA:** Imagina la vida que ha tenido esta prenda. Las manos que la bordaron. Las historias que podría contar. Crea una narrativa que haga sentir al lector que está comprando un pedazo de historia, no solo tela.

👐 **ACTIVA LOS SENTIDOS:** Describe cómo se siente el algodón envejecido contra la piel. El peso de la tela. La textura del bordado. Haz que lo sientan.

💫 **CONECTA EMOCIONALMENTE:** Esto no es solo una camisa, es una máquina del tiempo. Ayuda al lector a imaginarse usándola: tomando un espresso en un café vintage, hojeando discos de vinilo, viviendo una vida más romántica.

🔍 **DESTACA LO QUE LA HACE ESPECIAL:** Los detalles bordados a mano. El desgaste único. Cómo se ha conservado a través de las décadas. La autenticidad de su carácter vintage.

🎯 **CIERRA CON SIGNIFICADO:** Termina con una llamada a la acción que se sienta como una invitación a poseer un recuerdo, no solo a comprar.

Escribe entre 200-250 palabras. Usa un lenguaje cálido y evocador. Sé específico, sensorial e inolvidable.`
        },
        sustainable: {
            system: language === 'en'
                ? 'You are a passionate advocate for sustainable fashion. Your words inspire conscious consumption and connect eco-friendly choices with personal style.'
                : 'Eres un apasionado defensor de la moda sostenible. Tus palabras inspiran el consumo consciente y conectan las elecciones ecológicas con el estilo personal.',
            prompt: language === 'en'
                ? `Write a compelling sustainable fashion description for: "${product_details}"

Write like a conscious consumer advocate who believes fashion can change the world. Your description should:

🌱 **OPEN WITH PURPOSE:** Start by connecting the garment to a larger mission. This isn't just clothing—it's a statement about the kind of world we want to live in.

💚 **HIGHLIGHT SUSTAINABLE FEATURES:** The organic cotton grown without pesticides. The ethical production. The low-impact dyes. The fair wages. Be specific and proud.

🤲 **CREATE EMOTIONAL CONNECTION:** Help the reader feel good about their choice. Describe the peace of mind that comes from wearing something that didn't harm the planet.

👕 **DESCRIBE THE EXPERIENCE:** How the organic fabric feels softer against skin. How knowing its story makes it more meaningful. The pride of wearing values.

🌟 **SHOW IT'S STYLISH:** Sustainability doesn't mean sacrificing style. Emphasize how modern, beautiful, and desirable this piece is—it just happens to be ethical too.

🌍 **CLOSE WITH INSPIRATION:** End with a call to action that invites the reader to be part of the solution. Every purchase is a vote for the world you want.

Write 200-250 words. Be passionate, specific, and genuinely inspiring.`
                : `Escribe una descripción convincente de moda sostenible para: "${product_details}"

Escribe como un defensor del consumo consciente que cree que la moda puede cambiar el mundo. Tu descripción debe:

🌱 **ABRE CON PROPÓSITO:** Conecta la prenda con una misión más grande. Esto no es solo ropa, es una declaración sobre el tipo de mundo en el que queremos vivir.

💚 **DESTACA CARACTERÍSTICAS SOSTENIBLES:** El algodón orgánico cultivado sin pesticidas. La producción ética. Los tintes de bajo impacto. Los salarios justos. Sé específico y orgulloso.

🤲 **CREA CONEXIÓN EMOCIONAL:** Ayuda al lector a sentirse bien con su elección. Describe la paz mental que viene de usar algo que no dañó el planeta.

👕 **DESCRIBE LA EXPERIENCIA:** Cómo la tela orgánica se siente más suave contra la piel. Cómo saber su historia la hace más significativa. El orgullo de llevar tus valores.

🌟 **MUESTRA QUE ES ESTILOSA:** La sostenibilidad no significa sacrificar estilo. Enfatiza lo moderna, hermosa y deseable que es esta pieza, que además es ética.

🌍 **CIERRA CON INSPIRACIÓN:** Termina con una llamada a la acción que invite al lector a ser parte de la solución. Cada compra es un voto por el mundo que quieres.

Escribe 200-250 palabras. Sé apasionado, específico y genuinamente inspirador.`
        },
        expressive: {
            system: language === 'en'
                ? 'You are a bold, unapologetic voice of urban fashion. You speak the language of the streets—energetic, confident, and full of attitude.'
                : 'Eres una voz audaz y sin complejos de la moda urbana. Hablas el idioma de la calle: enérgico, seguro y lleno de actitud.',
            prompt: language === 'en'
                ? `Create an energetic, attitude-filled description for: "${product_details}"

Write like a street style influencer who knows exactly who they are. Your description should:

⚡ **OPEN WITH ATTITUDE:** Grab them by the collar. This isn't a request—it's a statement. You need this. Now.

🔥 **CREATE PERSONALITY:** This piece has energy. Describe it like it's alive. It moves with you. It speaks for you. It's the loudest thing you're not saying.

👊 **EMPOWER THE READER:** This isn't just clothing—it's armor. It's for people who refuse to blend in. For the ones who walk in and own the room.

💯 **BE SPECIFIC AND VIBRANT:** The way the fabric catches light. How it feels when you move. The perfect imperfections of the embroidery. Make it visceral.

🎵 **USE RHYTHM AND FLOW:** Your words should have a beat. Short punches. Long waves. Like a track that builds.

🌟 **CLOSE WITH CERTAINTY:** No soft calls to action. This is an ending that says "you were already sold, you just didn't know it yet."

Write 200-250 words. Be bold. Be specific. Be unforgettable.`
                : `Crea una descripción enérgica y llena de actitud para: "${product_details}"

Escribe como un influencer de estilo callejero que sabe exactamente quién es. Tu descripción debe:

⚡ **ABRE CON ACTITUD:** Agárralos por el cuello. Esto no es una solicitud, es una declaración. Necesitas esto. Ahora.

🔥 **CREA PERSONALIDAD:** Esta pieza tiene energía. Descríbela como si estuviera viva. Se mueve contigo. Habla por ti. Es lo más ruidoso que no estás diciendo.

👊 **EMPODERA AL LECTOR:** Esto no es solo ropa, es armadura. Es para personas que se niegan a pasar desapercibidas. Para los que entran y se adueñan de la habitación.

💯 **SÉ ESPECÍFICO Y VIBRANTE:** Cómo la tela atrapa la luz. Cómo se siente cuando te mueves. Las imperfecciones perfectas del bordado. Hazlo visceral.

🎵 **USA RITMO Y FLUJO:** Tus palabras deben tener ritmo. Golpes cortos. Olas largas. Como una canción que construye.

🌟 **CIERRA CON CERTEZA:** Sin llamadas a la acción suaves. Este es un final que dice "ya estabas convencido, solo que no lo sabías aún".

Escribe 200-250 palabras. Sé audaz. Sé específico. Sé inolvidable.`
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
        // LLAMADA A GEMINI CON PROMPT PROFESIONAL
        // ============================================
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });

        // Generar descripción principal
        const result = await model.generateContent(styleConfig.prompt);
        const response = await result.response;
        let mainDescription = response.text();

        let metaDescription = '';
        let suggestedKeywords = [];

        if (include_seo) {
            // Meta description mejorada según el estilo
            const metaPrompt = language === 'en'
                ? `Create a compelling SEO meta description (max 155 characters) for a ${tone} style product: ${product_details}. Make it irresistible.`
                : `Crea una meta descripción SEO convincente (máx 155 caracteres) para un producto de estilo ${tone}: ${product_details}. Hazla irresistible.`;

            const metaResult = await model.generateContent(metaPrompt);
            const metaResponse = await metaResult.response;
            metaDescription = metaResponse.text();

            // Keywords mejoradas según el estilo
            const kwPrompt = language === 'en'
                ? `Generate 5-7 powerful SEO keywords for a ${tone} style product: ${product_details}. Include emotional and descriptive terms. Return as comma-separated.`
                : `Genera 5-7 palabras clave SEO poderosas para un producto de estilo ${tone}: ${product_details}. Incluye términos emocionales y descriptivos. Devuélvelas separadas por comas.`;

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
// ============================================
// RUTAS DE RECUPERACIÓN DE CONTRASEÑA
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
    console.log(`🤖 IA: Google Gemini - Estilos Profesionales Activados`);
    console.log(`📝 Estilos disponibles: Storytelling Vintage, Sostenible, Expresivo Urbano`);
    console.log(`🌐 CORS permitidos:`, allowedOrigins);
});
