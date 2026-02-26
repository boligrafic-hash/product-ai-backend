// ============================================
// RECUPERACIÓN DE CONTRASEÑA
// ============================================

// 1. Solicitar restablecimiento de contraseña
app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    let connection;

    if (!email) {
        return res.status(400).json({ error: 'Email requerido' });
    }

    try {
        connection = await mysql.createConnection(dbConfig);

        // Verificar si el usuario existe
        const [users] = await connection.execute(
            'SELECT id, email FROM profiles WHERE email = ?',
            [email]
        );

        if (users.length === 0) {
            // Por seguridad, no revelamos si el email existe o no
            return res.json({ 
                success: true, 
                message: 'Si el email existe, recibirás instrucciones para restablecer tu contraseña.'
            });
        }

        const user = users[0];

        // Generar token único
        const resetToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 1); // Expira en 1 hora

        // Guardar token en base de datos
        await connection.execute(
            'INSERT INTO password_resets (user_id, email, token, expires_at) VALUES (?, ?, ?, ?)',
            [user.id, email, resetToken, expiresAt]
        );

        // Enviar email con enlace de restablecimiento
        const resetLink = `https://product-ai-frontend-j3hn.vercel.app/reset-password?token=${resetToken}`;
        
        const msg = {
            to: email,
            from: process.env.VERIFIED_SENDER,
            subject: 'Restablece tu contraseña - AI Description Generator',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #667eea;">¿Olvidaste tu contraseña?</h2>
                    <p>Has solicitado restablecer tu contraseña. Haz clic en el siguiente enlace para crear una nueva contraseña:</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${resetLink}" 
                           style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                                  color: white; padding: 12px 24px; text-decoration: none; 
                                  border-radius: 5px; display: inline-block;">
                            Restablecer contraseña
                        </a>
                    </div>
                    <p>O copia este enlace: <br> ${resetLink}</p>
                    <p>Este enlace expirará en 1 hora.</p>
                    <p>Si no solicitaste este cambio, ignora este email.</p>
                    <hr>
                    <p style="color: #666; font-size: 12px;">
                        © 2026 AI Description Generator. Todos los derechos reservados.
                    </p>
                </div>
            `
        };

        await sgMail.send(msg);
        console.log(`✅ Email de recuperación enviado a ${email}`);

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

// 2. Verificar token y mostrar formulario (redirige al frontend)
app.get('/reset-password', async (req, res) => {
    const { token } = req.query;
    let connection;

    if (!token) {
        return res.redirect('https://product-ai-frontend-j3hn.vercel.app?reset=invalid');
    }

    try {
        connection = await mysql.createConnection(dbConfig);

        // Buscar token válido
        const [resets] = await connection.execute(
            'SELECT * FROM password_resets WHERE token = ? AND expires_at > NOW() AND used = FALSE',
            [token]
        );

        if (resets.length === 0) {
            return res.redirect('https://product-ai-frontend-j3hn.vercel.app?reset=invalid');
        }

        // Token válido, redirigir al frontend con el token
        res.redirect(`https://product-ai-frontend-j3hn.vercel.app/reset-password?token=${token}`);

    } catch (error) {
        console.error('Error en reset-password:', error);
        res.redirect('https://product-ai-frontend-j3hn.vercel.app?reset=error');
    } finally {
        if (connection) await connection.end();
    }
});

// 3. Actualizar contraseña
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

        // Buscar token válido
        const [resets] = await connection.execute(
            'SELECT * FROM password_resets WHERE token = ? AND expires_at > NOW() AND used = FALSE',
            [token]
        );

        if (resets.length === 0) {
            return res.status(400).json({ error: 'Token inválido o expirado' });
        }

        const reset = resets[0];

        // Encriptar nueva contraseña
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Actualizar contraseña del usuario
        await connection.execute(
            'UPDATE profiles SET password = ? WHERE id = ?',
            [hashedPassword, reset.user_id]
        );

        // Marcar token como usado
        await connection.execute(
            'UPDATE password_resets SET used = TRUE WHERE id = ?',
            [reset.id]
        );

        console.log(`✅ Contraseña actualizada para usuario ${reset.user_id}`);

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
