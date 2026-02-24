const mysql = require('mysql2/promise');
require('dotenv').config();

async function testConnection() {
    const config = {
        host: process.env.TIDB_HOST,
        port: Number(process.env.TIDB_PORT),
        user: process.env.TIDB_USER,
        password: process.env.TIDB_PASSWORD,
        database: process.env.TIDB_DATABASE,
        ssl: process.env.TIDB_ENABLE_SSL === 'true' ? {} : null
    };

    console.log('Probando conexión a TiDB...');
    console.log('Host:', config.host);
    console.log('User:', config.user);
    console.log('Database:', config.database);

    try {
        const conn = await mysql.createConnection(config);
        const [rows] = await conn.execute('SELECT VERSION() as version');
        console.log('✅ CONEXIÓN EXITOSA!');
        console.log('Versión de TiDB:', rows[0].version);
        await conn.end();
    } catch (error) {
        console.error('❌ ERROR:', error.message);
    }
}

testConnection();
