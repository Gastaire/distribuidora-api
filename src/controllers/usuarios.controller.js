const db = require('../db');
const bcrypt = require('bcryptjs');

const validarUsuario = ({ nombre, email, rol, password }, nuevo = false) => {
    if (typeof nombre !== 'string' || !nombre.trim()) return 'Ingresá el nombre.';
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Ingresá un correo válido.';
    if (!['admin', 'vendedor', 'deposito'].includes(rol)) return 'Seleccioná un rol válido.';
    if ((nuevo || password) && (typeof password !== 'string' || !password.trim())) return 'Ingresá una contraseña.';
    return null;
};

// Obtener todos los usuarios
exports.getUsuarios = async (req, res) => {
    try {
        const { rows } = await db.query('SELECT id, nombre, email, rol, activo FROM usuarios ORDER BY nombre ASC');
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// Crear un nuevo usuario
exports.createUsuario = async (req, res) => {
    const { nombre, email, password, rol } = req.body;
    const errorValidacion = validarUsuario(req.body, true);
    if (errorValidacion) return res.status(400).json({ message: errorValidacion });
    try {
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);
        const { rows } = await db.query(
            'INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ($1, $2, $3, $4) RETURNING id, nombre, email, rol',
            [nombre.trim(), email.trim(), password_hash, rol]
        );
        res.status(201).json(rows[0]);
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ message: 'El correo electrónico ya está registrado.' });
        }
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// Actualizar un usuario
exports.updateUsuario = async (req, res) => {
    const { id } = req.params;
    const { nombre, email, rol, password } = req.body;
    const errorValidacion = validarUsuario(req.body);
    if (errorValidacion) return res.status(400).json({ message: errorValidacion });
    try {
        let query;
        let params;

        if (password) { // Si se provee una nueva contraseña, la actualizamos
            const salt = await bcrypt.genSalt(10);
            const password_hash = await bcrypt.hash(password, salt);
            query = 'UPDATE usuarios SET nombre = $1, email = $2, rol = $3, password_hash = $4 WHERE id = $5 RETURNING id, nombre, email, rol';
            params = [nombre.trim(), email.trim(), rol, password_hash, id];
        } else { // Si no, actualizamos el resto
            query = 'UPDATE usuarios SET nombre = $1, email = $2, rol = $3 WHERE id = $4 RETURNING id, nombre, email, rol';
            params = [nombre.trim(), email.trim(), rol, id];
        }
        const { rows } = await db.query(query, params);
        if (rows.length === 0) return res.status(404).json({ message: 'Usuario no encontrado' });
        res.status(200).json(rows[0]);
    } catch (error) {
         if (error.code === '23505') {
            return res.status(400).json({ message: 'El correo electrónico ya está en uso por otro usuario.' });
        }
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// Eliminar un usuario (Soft Delete)
exports.deleteUsuario = async (req, res) => {
    const { id } = req.params;
    // Prevenir que un admin se elimine a sí mismo
    if (req.user.id == id) {
        return res.status(400).json({ message: 'No puedes eliminar tu propia cuenta.' });
    }
    try {
        // A single statement keeps deactivation and client reassignment atomic.
        const { rows } = await db.query(`
            WITH usuario AS (
                UPDATE usuarios SET activo = false WHERE id = $1 RETURNING id
            ), clientes_liberados AS (
                UPDATE clientes SET vendedor_id = null, vendedor_nombre = null
                WHERE vendedor_id IN (SELECT id FROM usuario)
            )
            SELECT id FROM usuario`, [id]);
        if (rows.length === 0) return res.status(404).json({ message: 'Usuario no encontrado' });
        res.status(204).send();
    } catch (error) {
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// Restaurar un usuario (Re-activar)
exports.restoreUsuario = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.query('UPDATE usuarios SET activo = true WHERE id = $1', [id]);
        if (result.rowCount === 0) return res.status(404).json({ message: 'Usuario no encontrado' });
        res.status(200).json({ message: 'Usuario restaurado' });
    } catch (error) {
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
};
