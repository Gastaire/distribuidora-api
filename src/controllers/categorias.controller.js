const { pool } = require('../db');

/**
 * @description Renombra una categoría. Actualiza todos los productos que pertenecen a la categoría antigua.
 * Esta función es llamada por el modal "Renombrar Categoría".
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
 * @description Gestiona masivamente los productos de una categoría.
 * Esta función es llamada por el modal "Gestionar Productos".
 */
const manageProducts = async (req, res, next) => {
    const { categoryName, productIds } = req.body;
    const { id: usuario_id, nombre: nombre_usuario } = req.user;

    if (!categoryName || !Array.isArray(productIds)) {
        return res.status(400).json({ message: 'Se requiere un nombre de categoría y una lista de IDs de productos.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Paso 1: Desasignar esta categoría de TODOS los productos que la tenían antes.
        const unassignQuery = 'UPDATE productos SET categoria = NULL WHERE categoria = $1';
        await client.query(unassignQuery, [categoryName]);
        
        // Paso 2: Asignar la categoría a la nueva lista de productos.
        // Si la lista está vacía, no hace nada, lo cual es correcto.
        let affectedRows = 0;
        if (productIds.length > 0) {
            const assignQuery = 'UPDATE productos SET categoria = $1 WHERE id = ANY($2::int[])';
            const result = await client.query(assignQuery, [categoryName, productIds]);
            affectedRows = result.rowCount;
        }

        const logDetail = `El usuario ${nombre_usuario} gestionó la categoría '${categoryName}', asignándola a ${affectedRows} producto(s).`;
        await client.query('INSERT INTO actividad (id_usuario, nombre_usuario, accion, detalle) VALUES ($1, $2, $3, $4)', [usuario_id, nombre_usuario, 'GESTIONAR_CATEGORIA', logDetail]);

        await client.query('COMMIT');
        res.status(200).json({ message: 'Productos de la categoría actualizados exitosamente.', affectedCount: affectedRows });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error al gestionar productos de categoría:', error);
        next(error);
    } finally {
        client.release();
    }
};


module.exports = {
    renameCategoria,
    manageProducts
};
