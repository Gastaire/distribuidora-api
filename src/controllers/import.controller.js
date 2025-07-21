const { pool } = require('../db');
const csv = require('csv-parser');
const { Readable } = require('stream');

exports.importVentasPresenciales = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No se ha subido ningún archivo.' });
    }

    const ventasPorComprobante = new Map();
    const filasConError = [];
    let numeroFila = 1;

    const stream = Readable.from(req.file.buffer.toString('utf8'));

    stream
        .pipe(csv({ mapHeaders: ({ header }) => header.trim().toUpperCase() }))
        .on('data', (row) => {
            numeroFila++;
            try {
                const nroComprobante = row.COMPROBANTE;
                const fecha = new Date(row.FECHA);
                const cantidad = parseFloat(row.CANTIDAD);
                const precio = parseFloat(row.PRECIOFINAL);

                // --- Validación de datos de la fila ---
                if (!nroComprobante) throw new Error('Falta el número de comprobante.');
                if (isNaN(fecha.getTime())) throw new Error(`El formato de fecha '${row.FECHA}' es inválido.`);
                if (isNaN(cantidad)) throw new Error(`El valor de CANTIDAD '${row.CANTIDAD}' no es un número.`);
                if (isNaN(precio)) throw new Error(`El valor de PRECIOFINAL '${row.PRECIOFINAL}' no es un número.`);

                // Si la fila es válida, la procesamos
                if (!ventasPorComprobante.has(nroComprobante)) {
                    ventasPorComprobante.set(nroComprobante, {
                        fecha: fecha,
                        vendedor: row.VENDEDOR,
                        items: []
                    });
                }
                ventasPorComprobante.get(nroComprobante).items.push({
                    A_COD: row.A_COD,
                    NOMART: row.NOMART,
                    CANTIDAD: cantidad,
                    PRECIOFINAL: precio
                });

            } catch (error) {
                // Si algo falla en la fila, la guardamos para el reporte de errores
                filasConError.push({ fila: numeroFila, error: error.message, data: JSON.stringify(row) });
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
                    message: `Importación completada. Se procesaron ${comprobantesCreados} nuevos comprobantes y ${itemsCreados} items.`,
                    filasOmitidas: filasConError.length,
                    errores: filasConError
                });
            } catch (error) {
                await client.query('ROLLBACK');
                console.error('Error de base de datos durante la importación:', error);
                res.status(500).json({ message: 'Error en el servidor durante la importación. Revisa los logs.' });
            } finally {
                client.release();
            }
        });
};
