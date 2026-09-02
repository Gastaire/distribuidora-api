const fs = require('fs');
const path = require('path');
const { pool } = require('./src/db');

async function migrate() {
    try {
        const sqlPath = path.join(__dirname, 'migrations/04_ventas_fixes.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        console.log('Executing migration 04...');
        await pool.query(sql);
        console.log('Migration executed successfully.');
    } catch (e) {
        console.error('Migration failed:', e);
    } finally {
        pool.end();
    }
}

migrate();
