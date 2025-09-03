const { pool } = require('../db');

/**
 * @description Obtiene una lista de todas las categorías de productos únicas y no nulas.
 */
const getCategorias = async (req, res, next) => {
    try {
        const query = "SELECT DISTINCT categoria FROM productos WHERE categoria IS NOT NULL AND categoria <> '' ORDER BY categoria ASC";
        const { rows } = await pool.query(query);
        // Devolvemos un array de strings, no un array de objetos
        const categorias = rows.map(row => row.categoria);
        res.status(200).json(categorias);
    } catch (error) {
        console.error('Error al obtener categorías:', error);
        next(error);
    }
};

/**
 * @description Renombra una categoría. Actualiza todos los productos que pertenecen a la categoría antigua.
 */
const renameCategoria = async (req, res, next) => {
    const { oldName, newName } = req.body;
    const { id: usuario_id, nombre: nombre_usuario } = req.user;

    if (!oldName || !newName || oldName === newName) {
        return res.status(400).json({ message: 'Se requieren el nombre antiguo y el nuevo, y deben ser diferentes.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const updateQuery = 'UPDATE productos SET categoria = $1 WHERE categoria = $2';
        const result = await client.query(updateQuery, [newName, oldName]);

        const logDetail = `El usuario ${nombre_usuario} renombró la categoría '${oldName}' a '${newName}'. ${result.rowCount} producto(s) afectado(s).`;
        await client.query('INSERT INTO actividad (id_usuario, nombre_usuario, accion, detalle) VALUES ($1, $2, $3, $4)', [usuario_id, nombre_usuario, 'RENOMBRAR_CATEGORIA', logDetail]);

        await client.query('COMMIT');
        res.status(200).json({ message: `Categoría '${oldName}' renombrada a '${newName}' exitosamente.`, affectedCount: result.rowCount });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error al renombrar categoría:', error);
        next(error);
    } finally {
        client.release();
    }
};

/**
 * @description Asigna masivamente una lista de productos a una categoría específica.
 */
const assignProductosToCategoria = async (req, res, next) => {
    const { categoria, productoIds } = req.body;
    const { id: usuario_id, nombre: nombre_usuario } = req.user;

    if (!categoria || !Array.isArray(productoIds) || productoIds.length === 0) {
        return res.status(400).json({ message: 'Se requiere un nombre de categoría y una lista de IDs de productos.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Usamos ANY($2) para comparar con un array de IDs, es muy eficiente.
        const updateQuery = 'UPDATE productos SET categoria = $1 WHERE id = ANY($2::int[])';
        const result = await client.query(updateQuery, [categoria, productoIds]);

        const logDetail = `El usuario ${nombre_usuario} asignó ${result.rowCount} producto(s) a la categoría '${categoria}'.`;
        await client.query('INSERT INTO actividad (id_usuario, nombre_usuario, accion, detalle) VALUES ($1, $2, $3, $4)', [usuario_id, nombre_usuario, 'ASIGNAR_CATEGORIA', logDetail]);

        await client.query('COMMIT');
        res.status(200).json({ message: 'Productos asignados exitosamente.', affectedCount: result.rowCount });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error al asignar productos a categoría:', error);
        next(error);
    }
};


/**
 * @description Elimina una categoría, estableciendo el campo 'categoria' a NULL para todos los productos asociados.
 */
const deleteCategoria = async (req, res, next) => {
    // El nombre de la categoría vendrá codificado en la URL para manejar caracteres especiales
    const { name } = req.params;
    const decodedName = decodeURIComponent(name);
    const { id: usuario_id, nombre: nombre_usuario } = req.user;

    if (!decodedName) {
        return res.status(400).json({ message: 'Se requiere el nombre de la categoría a eliminar.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const updateQuery = "UPDATE productos SET categoria = NULL WHERE categoria = $1";
        const result = await client.query(updateQuery, [decodedName]);

        if (result.rowCount === 0) {
            return res.status(404).json({ message: `La categoría '${decodedName}' no fue encontrada o no tiene productos asociados.` });
        }

        const logDetail = `El usuario ${nombre_usuario} eliminó la categoría '${decodedName}', desasignándola de ${result.rowCount} producto(s).`;
        await client.query('INSERT INTO actividad (id_usuario, nombre_usuario, accion, detalle) VALUES ($1, $2, $3, $4)', [usuario_id, nombre_usuario, 'ELIMINAR_CATEGORIA', logDetail]);

        await client.query('COMMIT');
        res.status(200).json({ message: `Categoría '${decodedName}' eliminada exitosamente.`, affectedCount: result.rowCount });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error al eliminar categoría:', error);
        next(error);
    }
};


module.exports = {
    getCategorias,
    renameCategoria,
    assignProductosToCategoria,
    deleteCategoria
};
