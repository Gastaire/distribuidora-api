const { pool } = require('../db');

/**
 * @description Genera un reporte de los productos marcados como faltantes en las últimas 24 horas.
 */
const getReporteFaltantes = async (req, res, next) => {
    try {
        const query = `
            SELECT 
                nombre_producto,
                SUM(cantidad_original) as total_faltante
            FROM 
                registro_faltantes
            WHERE 
                fecha_registro >= NOW() - INTERVAL '24 hours'
            GROUP BY 
                nombre_producto
            ORDER BY 
                total_faltante DESC;
        `;

        const { rows } = await pool.query(query);

        if (rows.length === 0) {
            return res.status(200).json({
                message: 'No se registraron productos faltantes en las últimas 24 horas.',
                faltantes: []
            });
        }

        res.status(200).json({
            message: `Reporte de ${rows.length} producto(s) faltante(s) generado.`,
            faltantes: rows
        });

    } catch (error) {
        console.error('Error al generar el reporte de faltantes:', error);
        next(error);
    }
};

module.exports = {
    getReporteFaltantes
};
