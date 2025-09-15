const db = require('../db');

/**
 * @description Busca en la base de datos los items de pedidos cuyo `producto_id` asociado ya no existe en la tabla de productos.
 * Estos son "items huérfanos" que pueden causar inconsistencias.
 * @returns Un array de objetos, donde cada objeto representa un item huérfano con detalles del pedido y cliente al que pertenece.
 */
const getOrphanedOrderItems = async (req, res, next) => {
    try {
        const query = `
            SELECT
                pi.pedido_id,
                pi.producto_id,
                pi.nombre_producto,
                pi.cantidad,
                pi.precio_congelado,
                p_pedido.fecha_creacion,
                c.nombre_comercio
            FROM
                pedido_items pi
            LEFT JOIN
                productos p ON pi.producto_id = p.id
            LEFT JOIN
                pedidos p_pedido ON pi.pedido_id = p_pedido.id
            LEFT JOIN
                clientes c ON p_pedido.cliente_id = c.id
            WHERE
                p.id IS NULL -- La magia sucede aquí: filtramos solo aquellos donde no hubo coincidencia en la tabla de productos.
            ORDER BY
                p_pedido.fecha_creacion DESC;
        `;
        const { rows } = await db.query(query);
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error al obtener items de pedido huérfanos:', error);
        // Usamos next(error) para un manejo de errores más centralizado si Express tiene un middleware para ello.
        res.status(500).json({ message: 'Error interno del servidor al realizar el diagnóstico.' });
    }
};

module.exports = {
    getOrphanedOrderItems,
};
