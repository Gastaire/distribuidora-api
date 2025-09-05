const { pool } = require('../db');

/**
 * @description Guarda o actualiza un borrador de pedido (Upsert).
 * Utiliza INSERT ... ON CONFLICT para ser más eficiente.
 */
const saveBorrador = async (req, res) => {
    const { id: usuario_id } = req.user;
    const { cliente_local_id, cart, last_modified } = req.body;

    if (!cliente_local_id || !cart || !last_modified) {
        return res.status(400).json({ message: 'Faltan datos requeridos (cliente_local_id, cart, last_modified).' });
    }

    try {
        const query = `
            INSERT INTO borradores (usuario_id, cliente_local_id, borrador_data, last_modified)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (usuario_id, cliente_local_id)
            DO UPDATE SET
                borrador_data = EXCLUDED.borrador_data,
                last_modified = EXCLUDED.last_modified,
                actualizado_en = CURRENT_TIMESTAMP
            RETURNING id;
        `;
        
        await pool.query(query, [usuario_id, cliente_local_id, JSON.stringify(cart), last_modified]);
        
        res.status(200).json({ success: true, message: 'Borrador guardado en la nube.' });

    } catch (error) {
        console.error('Error al guardar borrador:', error);
        res.status(500).json({ message: 'Error interno del servidor al guardar el borrador.' });
    }
};

/**
 * @description Obtiene todos los borradores de un usuario.
 */
const getBorradores = async (req, res) => {
    const { id: usuario_id } = req.user;

    try {
        const query = 'SELECT cliente_local_id, borrador_data as cart, last_modified FROM borradores WHERE usuario_id = $1';
        const { rows } = await pool.query(query, [usuario_id]);
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error al obtener borradores:', error);
        res.status(500).json({ message: 'Error interno del servidor al obtener los borradores.' });
    }
};

module.exports = {
    saveBorrador,
    getBorradores,
};
