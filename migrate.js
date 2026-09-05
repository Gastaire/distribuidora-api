const fs = require('fs');
const path = require('path');
const { pool } = require('./src/db');

const MIGRATIONS = [
    '04_ventas_fixes.sql',
    '05_zonas_pedidos_programados.sql',
];

async function migrate() {
    try {
        for (const file of MIGRATIONS) {
            const sqlPath = path.join(__dirname, 'migrations', file);
            if (!fs.existsSync(sqlPath)) {
                console.log(`Skipping ${file} (not found)`);
                continue;
            }
            const sql = fs.readFileSync(sqlPath, 'utf8');
            console.log(`Executing migration: ${file}...`);
            await pool.query(sql);
            console.log(`✓ ${file} done.`);
        }
        console.log('All migrations executed successfully.');
    } catch (e) {
        console.error('Migration failed:', e);
    } finally {
        pool.end();
    }
}

migrate();
