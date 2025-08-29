const { pool } = require('../db');
const fs = require('fs/promises');
const path = require('path');

const BACKUP_DIR = path.join(__dirname, '..', '..', 'pedido_backups');
const MAX_BACKUPS = 30;

// --- Función Auxiliar para Backups ---
const ensureBackupDir = async () => {
    try {
        await fs.access(BACKUP_DIR);
    } catch (error) => {
        await fs.mkdir(BACKUP_DIR, { recursive: true });
    }
};

const manageBackups = async () => {
    await ensureBackupDir();
    const files = await fs.readdir(BACKUP_DIR);
    if (files.length >= MAX_BACKUPS) {
        const sortedFiles = files.sort((a, b) => {
            return fs.statSync(path.join(BACKUP_DIR, a)).mtime.getTime() - 
                   fs.statSync(path.join(BACKUP_DIR, b)).mtime.getTime();
        });
        await fs.unlink(path.join(BACKUP_DIR, sortedFiles[0]));
    }
};

// --- CREAR un nuevo pedido (VERSIÓN MEJORADA) ---
const createPedido = async (req, res) => {
    const { cliente_id, items, notas_entrega } = req.body;
    const { id: usuario_id, nombre: nombre_usuario } = req.user;

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: 'El pedido debe contener al menos un item.' });
    }

    const client = await pool.connect();
    
    // Variables finales que se usarán para la inserción y el backup.
    let final_cliente_id = null;
    let final_notas_entrega = notas_entrega || '';

    try {
        await client.query('BEGIN'); // <-- Inicia la transacción

        // --- 1. VALIDACIÓN INTELIGENTE DEL CLIENTE ---
        if (cliente_id) {
            const clienteResult = await client.query('SELECT id FROM clientes WHERE id = $1', [cliente_id]);
            if (clienteResult.rows.length > 0) {
                final_cliente_id = cliente_id;
            } else {
                // El ID no existe. Esto significa que el frontend envió un ID local
                // que no fue sincronizado. La transacción debe fallar para que el frontend
                // pueda reintentarlo más tarde, en lugar de crear un pedido huérfano.
                await client.query('ROLLBACK'); // Revertimos inmediatamente
                client.release();
                // Devolvemos un error 422 "Unprocessable Entity", que es más específico.
                return res.status(422).json({ 
                    message: `El cliente con id '${cliente_id}' no existe en el servidor. El cliente debe ser sincronizado primero.` 
                });
            }
        } else {
            // Si no se proporciona un cliente_id, también es un error.
            await client.query('ROLLBACK');
            client.release();
            return res.status(400).json({ message: 'No se proporcionó un cliente_id para el pedido.' });
        }

        // --- 2. INSERCIÓN EN LA BASE DE DATOS ---
        const pedidoQuery = 'INSERT INTO pedidos (cliente_id, usuario_id, estado, notas_entrega) VALUES ($1, $2, $3, $4) RETURNING id, fecha_creacion';
        const pedidoResult = await client.query(pedidoQuery, [final_cliente_id, usuario_id, 'pendiente', final_notas_entrega]);
        const nuevoPedidoId = pedidoResult.rows[0].id;
        const fechaCreacion = pedidoResult.rows[0].fecha_creacion;
        
        // --- 3. PREPARACIÓN DEL BACKUP (Mejora del segundo extracto) ---
        let backupContent = `Pedido ID: ${nuevoPedidoId}\nFecha: ${new Date(fechaCreacion).toLocaleString()}\nCliente ID: ${final_cliente_id || 'N/A'}\nNotas: ${final_notas_entrega}\n\nItems:\n`;

        for (const item of items) {
            // Buscamos el producto para congelar sus datos actuales
            const productoResult = await client.query('SELECT nombre, codigo_sku, precio_unitario, stock FROM productos WHERE id = $1', [item.producto_id]);
            if (productoResult.rows.length === 0) {
                // Si un producto no existe, la transacción debe fallar.
                throw new Error(`Producto con ID ${item.producto_id} no encontrado.`);
            }

            const { nombre, codigo_sku, precio_unitario, stock } = productoResult.rows[0];
            const avisoFaltante = (stock === 'No');
            
            // Insertamos el item del pedido con los datos "congelados"
            const itemQuery = 'INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_congelado, aviso_faltante, nombre_producto, codigo_sku) VALUES ($1, $2, $3, $4, $5, $6, $7)';
            await client.query(itemQuery, [nuevoPedidoId, item.producto_id, item.cantidad, precio_unitario, avisoFaltante, nombre, codigo_sku]);
            
            // Agregamos la línea al contenido del backup
            backupContent += `- (${item.cantidad}x) ${nombre} (SKU: ${codigo_sku || 'N/A'}) @ $${precio_unitario}\n`;
        }

        // Guardamos el log de la actividad
        const logDetail = `El usuario ${nombre_usuario} creó el pedido #${nuevoPedidoId}.`;
        await client.query('INSERT INTO actividad (id_usuario, nombre_usuario, accion, detalle) VALUES ($1, $2, $3, $4)', [usuario_id, nombre_usuario, 'CREAR_PEDIDO', logDetail]);

        // Si todo fue bien, confirmamos la transacción
        await client.query('COMMIT');

        // --- 4. GUARDADO DEL ARCHIVO DE BACKUP ---
        // Esto se ejecuta solo si el COMMIT fue exitoso.
        try {
            await manageBackups(); // Limpia backups antiguos si es necesario
            const backupFileName = `pedido_${nuevoPedidoId}_${Date.now()}.txt`;
            await fs.writeFile(path.join(BACKUP_DIR, backupFileName), backupContent);
        } catch (backupError) {
            console.error(`[ERROR DE BACKUP] Pedido #${nuevoPedidoId} creado exitosamente, pero falló al guardar el archivo de respaldo:`, backupError);
            // No se devuelve un error al cliente, ya que el pedido SÍ se creó.
        }

        res.status(201).json({ message: 'Pedido creado exitosamente', pedido_id: nuevoPedidoId });

    } catch (error) {
        // Si algo falla durante la transacción, la revertimos.
        await client.query('ROLLBACK');
        console.error('Error al crear pedido (transacción revertida):', error);
        res.status(500).json({ message: error.message || 'Error interno del servidor al crear el pedido.' });
    } finally {
        // Liberamos la conexión del pool en cualquier caso.
        client.release();
    }
}

const updatePedido = async (req, res) => {
    const { id: pedido_id } = req.params;
    const { items, notas_entrega } = req.body;
    const { id: usuario_id, nombre: nombre_usuario, rol } = req.user;

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: 'El pedido debe contener al menos un item.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // --- INICIO DE VALIDACIÓN PARA EDICIÓN ---
        const pedidoOriginalResult = await client.query('SELECT * FROM pedidos WHERE id = $1', [pedido_id]);
        if (pedidoOriginalResult.rows.length === 0) {
            await client.query('ROLLBACK');
            client.release();
            return res.status(404).json({ message: 'Pedido no encontrado.' });
        }
        const pedidoOriginal = pedidoOriginalResult.rows[0];

        // Solo el creador del pedido o un admin pueden editarlo.
        if (rol !== 'admin' && pedidoOriginal.usuario_id !== usuario_id) {
            await client.query('ROLLBACK');
            client.release();
            return res.status(403).json({ message: 'No tienes permiso para editar este pedido.' });
        }

        // Si no es admin, aplicamos las reglas de tiempo y estado.
        if (rol !== 'admin') {
            if (pedidoOriginal.estado !== 'pendiente') {
                await client.query('ROLLBACK');
                client.release();
                return res.status(403).json({ message: `No se puede editar un pedido que ya está en estado '${pedidoOriginal.estado}'.` });
            }
            const ahora = new Date();
            const fechaCreacion = new Date(pedidoOriginal.fecha_creacion);
            const doceHorasEnMs = 12 * 60 * 60 * 1000;

            if ((ahora - fechaCreacion) > doceHorasEnMs) {
                await client.query('ROLLBACK');
                client.release();
                return res.status(403).json({ message: 'El tiempo para editar este pedido (12 horas) ha expirado.' });
            }
        }
        // --- FIN DE VALIDACIÓN ---


        // 1. Actualizar las notas del pedido principal
        await client.query(
            'UPDATE pedidos SET notas_entrega = $1 WHERE id = $2',
            [notas_entrega || '', pedido_id]
        );

        // 2. Borrar los items antiguos para reemplazarlos
        await client.query('DELETE FROM pedido_items WHERE pedido_id = $1', [pedido_id]);

        // 3. Insertar los nuevos items con precios actualizados
        for (const item of items) {
             const productoResult = await client.query('SELECT nombre, codigo_sku, precio_unitario, stock FROM productos WHERE id = $1', [item.producto_id]);
             if (productoResult.rows.length === 0) throw new Error(`Producto con ID ${item.producto_id} no encontrado.`);
             const { nombre, codigo_sku, precio_unitario, stock } = productoResult.rows[0];
            
             const avisoFaltante = (stock === 'No');

             const itemQuery = 'INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_congelado, aviso_faltante, nombre_producto, codigo_sku) VALUES ($1, $2, $3, $4, $5, $6, $7)';
             await client.query(itemQuery, [pedido_id, item.producto_id, item.cantidad, precio_unitario, avisoFaltante, nombre, codigo_sku]);
        }
        
        // 4. Registrar la actividad
        const logDetail = `El usuario ${nombre_usuario} actualizó el pedido #${pedido_id}.`;
        await client.query(
            'INSERT INTO actividad (id_usuario, nombre_usuario, accion, detalle) VALUES ($1, $2, $3, $4)',
            [usuario_id, nombre_usuario, 'ACTUALIZAR_PEDIDO', logDetail]
        );

        await client.query('COMMIT');
        res.status(200).json({ message: 'Pedido actualizado exitosamente.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error al actualizar el pedido:', error);
        res.status(500).json({ message: 'Error interno del servidor al actualizar el pedido.' });
    } finally {
        client.release();
    }
};

// --- ACTUALIZAR los items de un pedido (VERSIÓN MEJORADA CON LOGS) ---
const updatePedidoItems = async (req, res) => {
    const { id: pedido_id } = req.params;
    const { items } = req.body;
    const { id: usuario_id, nombre: nombre_usuario } = req.user;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const oldItemsResult = await client.query('SELECT * FROM pedido_items WHERE pedido_id = $1', [pedido_id]);
        const oldItemsMap = new Map(oldItemsResult.rows.map(i => [i.producto_id, i.cantidad]));
        
        let logDetail = `El usuario ${nombre_usuario} modificó el pedido #${pedido_id}:\n`;
        const newItemsMap = new Map(items.map(i => [i.producto_id, i.cantidad]));

        // Detectar cambios, adiciones y eliminaciones
        const todosLosProductosIds = new Set([...oldItemsMap.keys(), ...newItemsMap.keys()]);

        for (const producto_id of todosLosProductosIds) {
            const oldQty = oldItemsMap.get(producto_id) || 0;
            const newQty = newItemsMap.get(producto_id) || 0;
            if (oldQty !== newQty) {
                const productInfo = await client.query('SELECT nombre FROM productos WHERE id = $1', [producto_id]);
                const productName = productInfo.rows.length > 0 ? productInfo.rows[0].nombre : `Producto ID ${producto_id}`;
                logDetail += `- ${productName}: cantidad cambió de ${oldQty} a ${newQty}.\n`;
            }
        }
        
        // 1. Borrar items antiguos
        await client.query('DELETE FROM pedido_items WHERE pedido_id = $1', [pedido_id]);

        // 2. Insertar items nuevos
        for (const item of items) {
             const productoResult = await client.query('SELECT nombre, codigo_sku, precio_unitario FROM productos WHERE id = $1', [item.producto_id]);
             if (productoResult.rows.length === 0) throw new Error(`Producto con ID ${item.producto_id} no encontrado.`);
             const { nombre, codigo_sku, precio_unitario } = productoResult.rows[0];
            
             const itemQuery = 'INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_congelado, nombre_producto, codigo_sku) VALUES ($1, $2, $3, $4, $5, $6)';
             await client.query(itemQuery, [pedido_id, item.producto_id, item.cantidad, precio_unitario, nombre, codigo_sku]);
        }
        
        // 3. Guardar el log de actividad si hubo cambios
        if (logDetail.length > `El usuario ${nombre_usuario} modificó el pedido #${pedido_id}:\n`.length) {
             await client.query(
                'INSERT INTO actividad (id_usuario, nombre_usuario, accion, detalle) VALUES ($1, $2, $3, $4)',
                [usuario_id, nombre_usuario, 'MODIFICAR_PEDIDO', logDetail]
            );
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

// El resto de funciones (getPedidos, getPedidoById, updatePedidoEstado) no necesitan cambios drásticos.
// Pero nos aseguramos que getPedidoById devuelva las nuevas columnas.

const getPedidoById = async (req, res) => {
    const { id } = req.params;
    try {
        const pedidoQuery = `
            SELECT p.*, c.nombre_comercio, c.direccion, u.nombre as nombre_vendedor
            FROM pedidos p
            LEFT JOIN clientes c ON p.cliente_id = c.id
            LEFT JOIN usuarios u ON p.usuario_id = u.id
            WHERE p.id = $1
        `;
        const pedidoResult = await pool.query(pedidoQuery, [id]);

        if (pedidoResult.rows.length === 0) return res.status(404).json({ message: 'Pedido no encontrado' });

        const itemsQuery = `
            SELECT pi.*, pr.stock as stock_actual 
            FROM pedido_items pi
            LEFT JOIN productos pr ON pi.producto_id = pr.id
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

// GET PEDIDOS (Sin cambios)
const getPedidos = async (req, res) => {
    const { rol, id: usuario_id } = req.user;
    let query = `
        SELECT p.id, p.fecha_creacion, p.estado, p.cliente_id, c.nombre_comercio, u.nombre as nombre_vendedor
        FROM pedidos p
        LEFT JOIN clientes c ON p.cliente_id = c.id
        LEFT JOIN usuarios u ON p.usuario_id = u.id
    `;
    const queryParams = [];

    if (rol === 'vendedor') {
        query += ' WHERE p.usuario_id = $1';
        queryParams.push(usuario_id);
    } else if (rol === 'deposito') {
        query += " WHERE p.estado IN ('pendiente', 'visto', 'en_preparacion', 'listo_para_entrega', 'entregado')";
    }

    query += ' ORDER BY p.fecha_creacion DESC';

    try {
        const { rows } = await pool.query(query, queryParams);
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error al obtener pedidos:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// NUEVA FUNCIÓN para obtener el historial de un vendedor
const getMisPedidos = async (req, res) => {
    const { id: usuario_id } = req.user;
    try {
        const query = `
            SELECT p.id, p.fecha_creacion, p.estado, p.cliente_id, c.nombre_comercio
            FROM pedidos p
            LEFT JOIN clientes c ON p.cliente_id = c.id
            WHERE p.usuario_id = $1
            ORDER BY p.fecha_creacion DESC
        `;
        const { rows } = await pool.query(query, [usuario_id]);
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error al obtener el historial de pedidos:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};


// Copia esta función completa dentro de pedidos.controller.js

const combinarPedidos = async (req, res) => {
    const { pedidoIds } = req.body; // Recibimos un array de IDs desde el frontend
    const { id: usuario_id, nombre: nombre_usuario } = req.user;

    if (!pedidoIds || !Array.isArray(pedidoIds) || pedidoIds.length < 2) {
        return res.status(400).json({ message: 'Se necesitan al menos dos pedidos para combinar.' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN'); // <-- Iniciamos la transacción

        // 1. Validar que todos los pedidos existan y pertenezcan al mismo cliente
        const pedidosOriginalesResult = await client.query(
            "SELECT id, cliente_id, estado FROM pedidos WHERE id = ANY($1::int[])", [pedidoIds]
        );
        
        if (pedidosOriginalesResult.rows.length !== pedidoIds.length) {
            throw new Error('Uno o más pedidos no fueron encontrados.');
        }

        const primerClienteId = pedidosOriginalesResult.rows[0].cliente_id;
        if (!pedidosOriginalesResult.rows.every(p => p.cliente_id === primerClienteId)) {
            throw new Error('No se pueden combinar pedidos de diferentes clientes.');
        }

        // 2. Obtener y consolidar todos los items de los pedidos a combinar
        const itemsResult = await client.query("SELECT * FROM pedido_items WHERE pedido_id = ANY($1::int[])", [pedidoIds]);
        const itemsConsolidados = new Map();

        for (const item of itemsResult.rows) {
            if (itemsConsolidados.has(item.producto_id)) {
                itemsConsolidados.get(item.producto_id).cantidad += item.cantidad;
            } else {
                itemsConsolidados.set(item.producto_id, { ...item, cantidad: item.cantidad });
            }
        }

        // 3. Crear el nuevo pedido "maestro"
        const notasMaestro = `Pedido combinado a partir de los IDs: ${pedidoIds.join(', ')}.`;
        const pedidoMaestroResult = await client.query(
            'INSERT INTO pedidos (cliente_id, usuario_id, estado, notas_entrega) VALUES ($1, $2, $3, $4) RETURNING id',
            [primerClienteId, usuario_id, 'pendiente', notasMaestro]
        );
        const nuevoPedidoId = pedidoMaestroResult.rows[0].id;

        // 4. Insertar los items consolidados en el nuevo pedido maestro
        for (const item of itemsConsolidados.values()) {
            await client.query(
                'INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_congelado, nombre_producto, codigo_sku) VALUES ($1, $2, $3, $4, $5, $6)',
                [nuevoPedidoId, item.producto_id, item.cantidad, item.precio_congelado, item.nombre_producto, item.codigo_sku]
            );
        }

        // 5. Actualizar los pedidos originales para marcarlos como combinados
        await client.query(
            "UPDATE pedidos SET estado = 'combinado', pedido_maestro_id = $1 WHERE id = ANY($2::int[])",
            [nuevoPedidoId, pedidoIds]
        );

        // 6. Registrar la acción en la tabla de actividad
        const logDetail = `El usuario ${nombre_usuario} combinó los pedidos [${pedidoIds.join(', ')}] en el nuevo pedido maestro #${nuevoPedidoId}.`;
        await client.query(
            'INSERT INTO actividad (id_usuario, nombre_usuario, accion, detalle) VALUES ($1, $2, $3, $4)',
            [usuario_id, nombre_usuario, 'COMBINAR_PEDIDOS', logDetail]
        );

        await client.query('COMMIT'); // <-- Confirmamos todos los cambios

        res.status(201).json({ message: 'Pedidos combinados con éxito.', nuevoPedidoId });

    } catch (error) {
        await client.query('ROLLBACK'); // <-- Revertimos todo si algo falla
        console.error('Error al combinar pedidos:', error);
        res.status(500).json({ message: error.message || 'Error interno del servidor al combinar pedidos.' });
    } finally {
        client.release(); // <-- Liberamos la conexión
    }
};

// UPDATE ESTADO (Sin cambios)
const updatePedidoEstado = async (req, res) => {
    const { id } = req.params;
    const { estado } = req.body;
    const { rol, id: usuario_id, nombre: nombre_usuario } = req.user;

    const estadosPermitidosDeposito = ['en_preparacion', 'listo_para_entrega', 'entregado', 'visto'];

    if (rol === 'deposito' && !estadosPermitidosDeposito.includes(estado)) {
        return res.status(403).json({ message: 'No tienes permiso para cambiar a este estado.' });
    }
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const { rows } = await client.query(
            'UPDATE pedidos SET estado = $1 WHERE id = $2 RETURNING *',
            [estado, id]
        );
        if (rows.length === 0) throw new Error('Pedido no encontrado');
        
        const logDetail = `El usuario ${nombre_usuario} cambió el estado del pedido #${id} a '${estado}'.`;
        await client.query(
            'INSERT INTO actividad (id_usuario, nombre_usuario, accion, detalle) VALUES ($1, $2, $3, $4)',
            [usuario_id, nombre_usuario, 'CAMBIAR_ESTADO_PEDIDO', logDetail]
        );
        
        await client.query('COMMIT');
        res.status(200).json(rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Error al actualizar estado del pedido ${id}:`, error);
        res.status(500).json({ message: 'Error interno del servidor' });
    } finally {
        client.release();
    }
};

const archivePedido = async (req, res) => {
    const { id } = req.params;
    const { id: usuario_id, nombre: nombre_usuario } = req.user;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Actualizamos el estado del pedido a 'archivado'
        const result = await client.query(
            "UPDATE pedidos SET estado = 'archivado' WHERE id = $1 RETURNING id",
            [id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'Pedido no encontrado' });
        }

        // Creamos el registro en la tabla de actividad
        const logDetail = `El usuario ${nombre_usuario} archivó el pedido #${id}.`;
        await client.query(
            'INSERT INTO actividad (id_usuario, nombre_usuario, accion, detalle) VALUES ($1, $2, $3, $4)',
            [usuario_id, nombre_usuario, 'ARCHIVAR_PEDIDO', logDetail]
        );

        await client.query('COMMIT');
        res.status(200).json({ message: 'Pedido archivado correctamente.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Error al archivar el pedido ${id}:`, error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    } finally {
        client.release();
    }
};

const cleanupArchivedPedidos = async (req, res) => {
    const { id: usuario_id, nombre: nombre_usuario } = req.user;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Obtenemos los IDs de todos los pedidos archivados
        const archivedPedidos = await client.query("SELECT id FROM pedidos WHERE estado = 'archivado'");
        
        if (archivedPedidos.rows.length === 0) {
            return res.status(200).json({ message: 'No hay pedidos archivados para eliminar.' });
        }
        
        const archivedIds = archivedPedidos.rows.map(p => p.id);

        // Eliminamos primero los items de esos pedidos (por la clave foránea)
        await client.query('DELETE FROM pedido_items WHERE pedido_id = ANY($1::int[])', [archivedIds]);
        
        // Ahora eliminamos los pedidos
        const deleteResult = await client.query('DELETE FROM pedidos WHERE id = ANY($1::int[])', [archivedIds]);

        // Creamos el registro de la limpieza
        const logDetail = `El usuario ${nombre_usuario} eliminó permanentemente ${deleteResult.rowCount} pedido(s) archivado(s).`;
        await client.query(
            'INSERT INTO actividad (id_usuario, nombre_usuario, accion, detalle) VALUES ($1, $2, $3, $4)',
            [usuario_id, nombre_usuario, 'LIMPIAR_ARCHIVADOS', logDetail]
        );
        
        await client.query('COMMIT');
        res.status(200).json({ message: `${deleteResult.rowCount} pedido(s) archivado(s) han sido eliminados.` });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error durante la limpieza de pedidos archivados:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    } finally {
        client.release();
    }
};

const unarchivePedido = async (req, res) => {
    const { id } = req.params;
    const { id: usuario_id, nombre: nombre_usuario } = req.user;
    
    try {
        // Cambia el estado de 'archivado' de vuelta a 'pendiente'
        const { rows } = await pool.query(
            "UPDATE pedidos SET estado = 'pendiente' WHERE id = $1 AND estado = 'archivado' RETURNING *",
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Pedido no encontrado o no está archivado.' });
        }
        
        const logDetail = `El usuario ${nombre_usuario} desarchivó el pedido #${id}.`;
        await pool.query(
            'INSERT INTO actividad (id_usuario, nombre_usuario, accion, detalle) VALUES ($1, $2, $3, $4)',
            [usuario_id, nombre_usuario, 'DESARCHIVAR_PEDIDO', logDetail]
        );

        res.status(200).json({ message: 'Pedido desarchivado correctamente.' });
    } catch (error) {
        console.error(`Error al desarchivar pedido ${id}:`, error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
};

const updatePedidoNotas = async (req, res) => {
    const { id } = req.params;
    const { notas_entrega } = req.body;
    const { id: usuario_id, nombre: nombre_usuario } = req.user;

    if (typeof notas_entrega === 'undefined') {
        return res.status(400).json({ message: 'Se requiere el campo de notas.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const { rows } = await client.query(
            'UPDATE pedidos SET notas_entrega = $1 WHERE id = $2 RETURNING *',
            [notas_entrega, id]
        );
        if (rows.length === 0) throw new Error('Pedido no encontrado');
        
        const logDetail = `El usuario ${nombre_usuario} modificó las notas del pedido #${id}.`;
        await client.query(
            'INSERT INTO actividad (id_usuario, nombre_usuario, accion, detalle) VALUES ($1, $2, $3, $4)',
            [usuario_id, nombre_usuario, 'MODIFICAR_NOTAS_PEDIDO', logDetail]
        );
        
        await client.query('COMMIT');
        res.status(200).json(rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Error al actualizar notas del pedido ${id}:`, error);
        res.status(500).json({ message: 'Error interno del servidor' });
    } finally {
        client.release();
    }
};

module.exports = {
    createPedido,
    getPedidos,
    getMisPedidos, // <-- NUEVA FUNCIÓN EXPORTADA
    getPedidoById,
    updatePedidoItems,
    updatePedidoEstado,
    archivePedido,
    cleanupArchivedPedidos,
    updatePedido,
    updatePedidoNotas,
    unarchivePedido,
    combinarPedidos
};
