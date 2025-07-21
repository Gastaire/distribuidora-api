const { pool } = require('../db');
const csv = require('csv-parser');
const { Readable } = require('stream');

exports.importVentasPresenciales = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No se ha subido ningún archivo.' });
    }

    const ventasPorComprobante = new Map();

    const stream = Readable.from(req.file.buffer.toString('utf8'));

    stream
        .pipe(csv({ mapHeaders: ({ header }) => header.trim().toUpperCase() }))
        .on('data', (row) => {
            const nroComprobante = row.COMPROBANTE;
            if (nroComprobante && row.CANTIDAD && row.PRECIOFINAL) {
                if (!ventasPorComprobante.has(nroComprobante)) {
                    ventasPorComprobante.set(nroComprobante, {
                        fecha: new Date(row.FECHA),
                        vendedor: row.VENDEDOR,
                        items: []
                    });
                }
                ventasPorComprobante.get(nroComprobante).items.push({
                    A_COD: row.A_COD,
                    NOMART: row.NOMART,
                    CANTIDAD: parseFloat(row.CANTIDAD) || 0,
                    PRECIOFINAL: parseFloat(row.PRECIOFINAL) || 0
                });
            }
        })
        .on('end', async () => {
            const client = await pool.connect();
            let comprobantesCreados = 0;
            let itemsCreados = 0;

            try {
                await client.query('BEGIN');

                for (const [nro, data] of ventasPorComprobante.entries()) {
                    const existing = await client.query('SELECT id FROM ventas_presenciales_comprobantes WHERE comprobante_nro = $1', [nro]);
                    if (existing.rows.length > 0) continue;

                    const comprobanteResult = await client.query(
                        'INSERT INTO ventas_presenciales_comprobantes (comprobante_nro, fecha_venta, vendedor) VALUES ($1, $2, $3) RETURNING id',
                        [nro, data.fecha, data.vendedor]
                    );
                    const comprobanteId = comprobanteResult.rows[0].id;
                    comprobantesCreados++;

                    for (const item of data.items) {
                        if (item.CANTIDAD > 0) {
                            await client.query(
                                'INSERT INTO ventas_presenciales_items (comprobante_id, codigo_sku, nombre_producto, cantidad, precio_final_unitario) VALUES ($1, $2, $3, $4, $5)',
                                [comprobanteId, item.A_COD, item.NOMART, item.CANTIDAD, item.PRECIOFINAL]
                            );
                            itemsCreados++;
                        }
                    }
                }

                await client.query('COMMIT');
                res.status(200).json({
                    message: `Importación completada. Se procesaron ${comprobantesCreados} nuevos comprobantes y ${itemsCreados} items.`
                });
            } catch (error) {
                await client.query('ROLLBACK');
                console.error('Error durante la importación de ventas presenciales:', error);
                res.status(500).json({ message: 'Error en el servidor durante la importación.' });
            } finally {
                client.release();
            }
        });
};
