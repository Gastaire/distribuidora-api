const db = require('../db');

const getLogs = async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM actividad ORDER BY fecha_creacion DESC LIMIT 50'); // Traemos los últimos 50 registros
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error al obtener logs de actividad:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

module.exports = {
    getLogs,
};
