const {createHash} = require('node:crypto');
const fingerprint = req => {
    const ignored = new Set(['sync_request_id', 'local_id', 'status', 'retries', 'sync_error']);
    const sorted = value => {
        if (Array.isArray(value)) return value.map(sorted);
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(Object.keys(value).sort().filter(key => !ignored.has(key)).map(key => [key, sorted(value[key])]));
    };
    return createHash('sha256').update(JSON.stringify(sorted(req.body))).digest('hex');
};
// Persist confirmations in the existing audit table, within the creation transaction.
const readReceipt = async (client, req, kind) => {
    const key = req.body.sync_request_id;
    if (key == null) return null;
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{1,150}$/.test(key)) {
        const error = new Error('Identificador de envío inválido.');
        error.status = 400;
        throw error;
    }
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${kind}:${req.user.id}:${key}`]);
    const { rows } = await client.query(
        "SELECT detalle FROM actividad WHERE id_usuario = $1 AND accion = $2 AND split_part(detalle, E'\\n', 1) = $3 ORDER BY id DESC LIMIT 1",
        [req.user.id, kind, key]
    );
    if (!rows.length) return null;
    const saved = JSON.parse(rows[0].detalle.slice(key.length + 1));
    if (saved.fingerprint !== fingerprint(req)) {
        const error = new Error('El envío anterior ya fue confirmado. Se recuperó su número. Volvé a sincronizar para aplicar los cambios pendientes.');
        error.status = 409;
        error.existing_id = saved.result.pedido_id || saved.result.id;
        throw error;
    }
    return saved.result;
};
const writeReceipt = async (client, req, kind, result) => {
    if (req.body.sync_request_id == null) return;
    await client.query('INSERT INTO actividad (id_usuario, nombre_usuario, accion, detalle) VALUES ($1, $2, $3, $4)',
        [req.user.id, req.user.nombre, kind, `${req.body.sync_request_id}\n${JSON.stringify({fingerprint:fingerprint(req), result})}`]);
};
module.exports = {readReceipt, writeReceipt};
