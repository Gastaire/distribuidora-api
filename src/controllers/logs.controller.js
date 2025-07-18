const { pool } = require('../db');

/**
 * Obtiene los registros de actividad de la base de datos.
 * Limita los resultados a los 200 más recientes para mejorar el rendimiento.
 */
const getLogs = async (req, res) => {
    try {
        // Seleccionamos explícitamente las columnas y limitamos el resultado.
        const query = 'SELECT id, accion, detalle, nombre_usuario, fecha_creacion FROM logs ORDER BY fecha_creacion DESC LIMIT 200';
        
        const result = await pool.query(query);
        
        res.status(200).json(result.rows);

    } catch (error) {
        // Si hay un error en la base de datos, lo registramos y enviamos una respuesta genérica.
        console.error('Error al obtener el registro de actividad:', error);
        res.status(500).json({ message: 'Error interno del servidor al consultar los logs.' });
    }
};

module.exports = { getLogs };
