const { pool } = require('../db'); // Importamos el pool

// CREAR un nuevo pedido (Transacción)
const createPedido = async (req, res) => {
    const { cliente_id, items, notas_entrega } = req.body; // items: [{ producto_id, cantidad }]
    const { id: usuario_id } = req.user;

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: 'El pedido debe contener al menos un item.' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const pedidoQuery = 'INSERT INTO pedidos (cliente_id, usuario_id, estado, notas_entrega) VALUES ($1, $2, $3, $4) RETURNING id';
        const pedidoResult = await client.query(pedidoQuery, [cliente_id, usuario_id, 'pendiente', notas_entrega]);
        const nuevoPedidoId = pedidoResult.rows[0].id;

        for (const item of items) {
            // Obtenemos precio Y stock
            const productoResult = await client.query('SELECT precio_unitario, stock FROM productos WHERE id = $1', [item.producto_id]);
            if (productoResult.rows.length === 0) throw new Error(`Producto con ID ${item.producto_id} no encontrado.`);

            const { precio_unitario, stock } = productoResult.rows[0];
            const avisoFaltante = (stock === 'No'); // Generamos el aviso

            // Añadimos el aviso_faltante a la inserción
            const itemQuery = 'INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_congelado, aviso_faltante) VALUES ($1, $2, $3, $4, $5)';
            await client.query(itemQuery, [nuevoPedidoId, item.producto_id, item.cantidad, precio_unitario, avisoFaltante]);
        }

        await client.query('COMMIT');
        res.status(201).json({ message: 'Pedido creado exitosamente', pedido_id: nuevoPedidoId });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error al crear pedido:', error);
        res.status(500).json({ message: 'Error interno del servidor al crear el pedido.' });
    } finally {
        client.release();
    }
};

// OBTENER pedidos (con lógica de roles)
const getPedidos = async (req, res) => {
    const { rol, id: usuario_id } = req.user;
    let query = `
        SELECT p.id, p.fecha_creacion, p.estado, c.nombre_comercio, u.nombre as nombre_vendedor
        FROM pedidos p
        JOIN clientes c ON p.cliente_id = c.id
        JOIN usuarios u ON p.usuario_id = u.id
    `;
    const queryParams = [];

    if (rol === 'vendedor') {
        query += ' WHERE p.usuario_id = $1';
        queryParams.push(usuario_id);
    } else if (rol === 'deposito') {
        query += " WHERE p.estado IN ('revisado', 'en_preparacion', 'listo_para_entrega', 'entregado')";
    }
    // El admin ve todo, no se añade WHERE

    query += ' ORDER BY p.fecha_creacion DESC';

    try {
        const { rows } = await pool.query(query, queryParams);
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error al obtener pedidos:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// OBTENER UN SOLO pedido con todo su detalle
const getPedidoById = async (req, res) => {
    const { id } = req.params;
    try {
        const pedidoQuery = `
            SELECT p.*, c.nombre_comercio, c.direccion, u.nombre as nombre_vendedor
            FROM pedidos p
            JOIN clientes c ON p.cliente_id = c.id
            JOIN usuarios u ON p.usuario_id = u.id
            WHERE p.id = $1
        `;
        const pedidoResult = await pool.query(pedidoQuery, [id]);

        if (pedidoResult.rows.length === 0) return res.status(404).json({ message: 'Pedido no encontrado' });

        const itemsQuery = `
            SELECT pi.*, pr.nombre as nombre_producto, pr.codigo_sku
            FROM pedido_items pi
            JOIN productos pr ON pi.producto_id = pr.id
            WHERE pi.pedido_id = $1
        `;
        const itemsResult = await pool.query(itemsQuery, [id]);

        const pedidoCompleto = pedidoResult.rows[0];
        pedidoCompleto.items = itemsResult.rows;

        res.status(200).json(pedidoCompleto);
    } catch (error) {
        console.error(`Error al obtener pedido ${id}:`, error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// ACTUALIZAR el estado de un pedido (Lógica de roles mejorada)
const updatePedidoEstado = async (req, res) => {
    const { id } = req.params;
    const { estado } = req.body;
    const { rol } = req.user;

    // Definir los estados permitidos para el rol 'deposito'
    const estadosPermitidosDeposito = ['en_preparacion', 'listo_para_entrega', 'entregado'];

    if (rol === 'deposito' && !estadosPermitidosDeposito.includes(estado)) {
        return res.status(403).json({ message: 'No tienes permiso para cambiar a este estado.' });
    }

    // El rol 'admin' puede cambiar a cualquier estado, por lo que no necesita validación extra.

    try {
        const { rows } = await pool.query(
            'UPDATE pedidos SET estado = $1 WHERE id = $2 RETURNING *',
            [estado, id]
        );
        if (rows.length === 0) return res.status(404).json({ message: 'Pedido no encontrado' });
        res.status(200).json(rows[0]);
    } catch (error) {
        console.error(`Error al actualizar estado del pedido ${id}:`, error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// NUEVA FUNCIÓN: Actualizar los items de un pedido
const updatePedidoItems = async (req, res) => {
    const { id: pedido_id } = req.params;
    const { items } = req.body; // items: [{ producto_id, cantidad }]

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Borrar los items antiguos de este pedido
        await client.query('DELETE FROM pedido_items WHERE pedido_id = $1', [pedido_id]);

        // 2. Insertar los nuevos items
        for (const item of items) {
            // Obtenemos el precio actual del producto para "congelarlo"
            const productoResult = await client.query('SELECT precio_unitario FROM productos WHERE id = $1', [item.producto_id]);
            if (productoResult.rows.length === 0) throw new Error(`Producto con ID ${item.producto_id} no encontrado.`);
            const precioCongelado = productoResult.rows[0].precio_unitario;

            const itemQuery = 'INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_congelado) VALUES ($1, $2, $3, $4)';
            await client.query(itemQuery, [pedido_id, item.producto_id, item.cantidad, precioCongelado]);
        }

        await client.query('COMMIT');
        res.status(200).json({ message: 'Pedido actualizado exitosamente.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error al actualizar items del pedido:', error);
        res.status(500).json({ message: 'Error interno del servidor al actualizar el pedido.' });
    } finally {
        client.release();
    }
};

module.exports = {
    createPedido,
    getPedidos,
    getPedidoById,
    updatePedidoItems,
    updatePedidoEstado
};
