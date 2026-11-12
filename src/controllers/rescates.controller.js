const { pool } = require('../db');
const bcrypt = require('bcryptjs');
const { writeReceipt } = require('../services/syncReceipt');

const decodeSnapshot = row => JSON.parse(row.detalle.slice(row.detalle.indexOf('\n') + 1));
const rescueResult = (id, snapshot) => ({
    rescate_id: id,
    rescatado: snapshot.resolution?.type === 'recovered',
    pedido_id: snapshot.resolution?.pedido_id || null,
    message: 'Copia recibida para revisión del administrador.'
});

const rescuePedido = async (req, res, next) => {
    const pedido = req.body.pedido;
    const key = pedido?.local_id == null ? '' : String(pedido.local_id);
    if (!/^[a-zA-Z0-9_-]{1,150}$/.test(key) || !Array.isArray(pedido?.items) || JSON.stringify(pedido).length > 250000) {
        return res.status(400).json({ message: 'El pedido debe tener un identificador local e ítems, y ocupar menos de 250 KB.' });
    }
    // Preserve legacy invalid data as a review snapshot, separate from operational orders.
    const snapshot = {
        local_id: key, id: pedido.id, cliente_id: pedido.cliente_id,
        cliente_nombre_snapshot: pedido.cliente_nombre_snapshot, cliente_local_id: pedido.cliente_local_id,
        usuario_origen: pedido.usuario_id, fecha: pedido.fecha, items: pedido.items,
        notas_entrega: pedido.notas_entrega, fecha_entrega_programada: pedido.fecha_entrega_programada,
        sync_error: pedido.sync_error, estado: pedido.estado, status: pedido.status,
        updated_at: new Date().toISOString()
    };
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`rescate:${req.user.id}:${key}`]);
        const previous = await client.query("SELECT id, detalle FROM actividad WHERE accion = 'PEDIDO_RESCATADO' AND id_usuario = $1 AND split_part(detalle, E'\\n', 1) = $2 ORDER BY id DESC LIMIT 1 FOR UPDATE", [req.user.id, key]);
        const old = previous.rows[0];
        if (old) {
            const saved = decodeSnapshot(old);
            if (saved.resolution?.type === 'recovered') {
                await client.query('COMMIT');
                return res.json(rescueResult(old.id, saved));
            }
        }
        if (pedido.status === 'synced' && Number.isSafeInteger(Number(pedido.id)) && Number(pedido.id) > 0) {
            const confirmed = await client.query('SELECT id FROM pedidos WHERE id = $1 AND usuario_id = $2', [pedido.id, req.user.id]);
            if (confirmed.rows.length) snapshot.resolution = { type: 'sent', pedido_id: pedido.id };
        }
        const detalle = `${key}\n${JSON.stringify(snapshot)}`;
        let id = old?.id;
        if (id) {
            await client.query('UPDATE actividad SET detalle = $1 WHERE id = $2', [detalle, id]);
        } else {
            const saved = await client.query("INSERT INTO actividad (id_usuario, nombre_usuario, accion, detalle) VALUES ($1, $2, 'PEDIDO_RESCATADO', $3) RETURNING id", [req.user.id, req.user.nombre, detalle]);
            id = saved.rows[0].id;
        }
        await client.query('COMMIT');
        res.json(rescueResult(id, snapshot));
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally { client.release(); }
};

const getRescates = async (req, res, next) => {
    const cursor = req.query.before == null ? null : Number(req.query.before);
    if (cursor !== null && (!Number.isSafeInteger(cursor) || cursor <= 0)) return res.status(400).json({ message: 'Página inválida.' });
    try {
        const { rows } = await pool.query("SELECT id, nombre_usuario, fecha_creacion, detalle FROM actividad WHERE accion = 'PEDIDO_RESCATADO' AND ($1::bigint IS NULL OR id < $1) ORDER BY id DESC LIMIT 51", [cursor]);
        const page = rows.slice(0, 50);
        res.json({
            rescates: page.map(row => ({ id: row.id, vendedor: row.nombre_usuario, fecha: row.fecha_creacion, pedido: decodeSnapshot(row) })),
            next: rows.length > 50 ? page[page.length - 1].id : null
        });
    } catch (error) { next(error); }
};

const recoverRescate = async (req, res, next) => {
    const { password, cliente_id, items } = req.body;
    const client = await pool.connect();
    try {
        const account = await client.query('SELECT password_hash, activo, rol FROM usuarios WHERE id = $1', [req.user.id]);
        const admin = account.rows[0];
        if (!admin || admin.activo === false || admin.rol !== 'admin' || typeof password !== 'string' || !await bcrypt.compare(password, admin.password_hash)) {
            return res.status(403).json({ message: 'Confirmá tu contraseña de administrador.' });
        }
        await client.query('BEGIN');
        const found = await client.query("SELECT * FROM actividad WHERE id = $1 AND accion = 'PEDIDO_RESCATADO'", [req.params.id]);
        if (!found.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'No se encontró el rescate.' });
        }
        const owner = found.rows[0].id_usuario;
        const key = decodeSnapshot(found.rows[0]).local_id;
        // Same lock as normal order creation: recovery and a phone retry cannot create two orders.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`SYNC_PEDIDO:${owner}:${key}`]);
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`rescate:${owner}:${key}`]);
        const locked = await client.query('SELECT * FROM actividad WHERE id = $1 FOR UPDATE', [req.params.id]);
        const snapshot = decodeSnapshot(locked.rows[0]);
        const receipts = await client.query("SELECT detalle FROM actividad WHERE id_usuario = $1 AND accion = 'SYNC_PEDIDO' AND split_part(detalle, E'\\n', 1) = $2 ORDER BY id DESC LIMIT 1", [owner, key]);
        const receiptId = receipts.rows.length ? decodeSnapshot(receipts.rows[0]).result.pedido_id : null;
        const existingId = snapshot.resolution?.pedido_id || receiptId || snapshot.id;
        if (existingId) {
            if (!snapshot.resolution) {
                snapshot.resolution = {type:'sent',pedido_id:existingId};
                await client.query('UPDATE actividad SET detalle = $1 WHERE id = $2', [`${key}\n${JSON.stringify(snapshot)}`, req.params.id]);
            }
            await client.query('COMMIT');
            return res.json({ pedido_id: existingId, existing: true, message: 'Ya hay un pedido asociado. Revisá ese pedido y la copia rescatada antes de aplicar cambios.' });
        }
        if (!Number.isSafeInteger(Number(cliente_id)) || Number(cliente_id) <= 0 || !Array.isArray(items) || !items.length || items.length > 1000 || items.some(item => !item || typeof item !== 'object' || !Number.isSafeInteger(Number(item.producto_id)) || Number(item.producto_id) <= 0 || !Number.isFinite(Number(item.cantidad)) || Number(item.cantidad) <= 0 || item.precio_congelado == null || item.precio_congelado === '' || !Number.isFinite(Number(item.precio_congelado)) || Number(item.precio_congelado) < 0) || new Set(items.map(item => String(item.producto_id))).size !== items.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Revisá el cliente, los productos sin repetir, las cantidades y los precios del rescate.' });
        }
        const customer = await client.query('SELECT id FROM clientes WHERE id = $1 FOR SHARE', [cliente_id]);
        if (!customer.rows.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Seleccioná un cliente existente.' });
        }
        const created = await client.query("INSERT INTO pedidos (cliente_id, usuario_id, estado, notas_entrega) VALUES ($1, $2, 'archivado', $3) RETURNING id", [cliente_id, owner, `Recuperado desde rescate #${req.params.id}. Fecha original: ${snapshot.fecha || 'sin fecha'}.\n${snapshot.notas_entrega || ''}`]);
        const pedidoId = created.rows[0].id;
        for (const item of items) {
            const product = await client.query('SELECT nombre, codigo_sku FROM productos WHERE id = $1', [item.producto_id]);
            if (!product.rows.length) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: `Reemplazá el producto inexistente ${item.producto_id} antes de recuperar.` });
            }
            await client.query('INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_congelado, nombre_producto, codigo_sku) VALUES ($1, $2, $3, $4, $5, $6)', [pedidoId, item.producto_id, item.cantidad, item.precio_congelado, product.rows[0].nombre, product.rows[0].codigo_sku]);
        }
        snapshot.resolution = { type: 'recovered', pedido_id: pedidoId, admin_id: req.user.id, at: new Date().toISOString() };
        await client.query('UPDATE actividad SET detalle = $1 WHERE id = $2', [`${key}\n${JSON.stringify(snapshot)}`, req.params.id]);
        await writeReceipt(client, { user: { id: owner, nombre: locked.rows[0].nombre_usuario }, body: { sync_request_id: key } }, 'SYNC_PEDIDO', { pedido_id: pedidoId, rescatado: true, estado: 'archivado' });
        await client.query('INSERT INTO actividad (id_usuario, nombre_usuario, accion, detalle) VALUES ($1, $2, $3, $4)', [req.user.id, req.user.nombre, 'RECUPERAR_PEDIDO', `Recuperó el rescate #${req.params.id} como pedido archivado #${pedidoId}.`]);
        await client.query('COMMIT');
        res.status(201).json({ pedido_id: pedidoId, message: 'Pedido recuperado como archivado. Revisalo antes de desarchivar.' });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally { client.release(); }
};

module.exports = { rescuePedido, getRescates, recoverRescate };
