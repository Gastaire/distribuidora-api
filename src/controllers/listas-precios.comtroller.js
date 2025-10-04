const { pool } = require('../db');

/**
 * @description Obtiene todas las listas de precios, ordenadas por fecha de creación.
 * Esta función será usada por el panel de administración para mostrar todas las listas disponibles.
 */
const getListasDePrecios = async (req, res, next) => {
    try {
        const query = 'SELECT id, nombre, fecha_creacion, activa FROM listas_de_precios ORDER BY fecha_creacion DESC';
        const { rows } = await pool.query(query);
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error al obtener listas de precios:', error);
        next(error);
    }
};

/**
 * @description Obtiene una lista de precios específica junto con todos sus items (productos y precios).
 * Esencial para ver el detalle de una lista en el panel de administración.
 */
const getListaDePreciosById = async (req, res, next) => {
    const { id } = req.params;
    try {
        const listaQuery = 'SELECT id, nombre, fecha_creacion, activa FROM listas_de_precios WHERE id = $1';
        const listaResult = await pool.query(listaQuery, [id]);

        if (listaResult.rows.length === 0) {
            return res.status(404).json({ message: 'Lista de precios no encontrada.' });
        }

        const itemsQuery = `
            SELECT 
                li.producto_id,
                p.nombre as nombre_producto,
                p.codigo_sku,
                li.precio
            FROM lista_precios_items li
            JOIN productos p ON li.producto_id = p.id
            WHERE li.lista_id = $1
            ORDER BY p.nombre ASC
        `;
        const itemsResult = await pool.query(itemsQuery, [id]);

        const listaCompleta = listaResult.rows[0];
        listaCompleta.items = itemsResult.rows;
        
        res.status(200).json(listaCompleta);
    } catch (error) {
        console.error(`Error al obtener la lista de precios ${id}:`, error);
        next(error);
    }
};

/**
 * @description Crea una nueva lista de precios.
 * Permite duplicar los productos y precios de una lista existente para facilitar la creación de nuevas versiones.
 */
const createListaDePrecios = async (req, res, next) => {
    const { nombre, sourceListId } = req.body; // sourceListId es opcional para duplicar
    const { id: usuario_id, nombre: nombre_usuario } = req.user;

    if (!nombre) {
        return res.status(400).json({ message: 'El nombre de la lista es requerido.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Crear la nueva lista (siempre se crea como inactiva por seguridad)
        const newListQuery = 'INSERT INTO listas_de_precios (nombre, activa) VALUES ($1, false) RETURNING id';
        const newListResult = await client.query(newListQuery, [nombre]);
        const newListId = newListResult.rows[0].id;

        // 2. Si se proporciona un sourceListId, duplicamos sus items
        let itemsCopiados = 0;
        if (sourceListId) {
            const copyQuery = `
                INSERT INTO lista_precios_items (lista_id, producto_id, precio)
                SELECT $1, producto_id, precio
                FROM lista_precios_items
                WHERE lista_id = $2
            `;
            const copyResult = await client.query(copyQuery, [newListId, sourceListId]);
            itemsCopiados = copyResult.rowCount;
        }

        // 3. Registrar la acción
        const logDetail = `El usuario ${nombre_usuario} creó la lista de precios '${nombre}' (ID: ${newListId}).` + (sourceListId ? ` Duplicando ${itemsCopiados} items de la lista ID ${sourceListId}.` : '');
        await client.query('INSERT INTO actividad (id_usuario, nombre_usuario, accion, detalle) VALUES ($1, $2, $3, $4)', [usuario_id, nombre_usuario, 'CREAR_LISTA_PRECIOS', logDetail]);

        await client.query('COMMIT');
        res.status(201).json({ 
            message: 'Lista de precios creada exitosamente.', 
            newList: { id: newListId, nombre, itemsCopiados }
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error al crear lista de precios:', error);
        next(error);
    } finally {
        client.release();
    }
};

/**
 * @description Activa una lista de precios, desactivando todas las demás.
 * Esto asegura que solo haya una lista "activa" a la vez, que es la que verán los vendedores por defecto.
 */
const setListaActiva = async (req, res, next) => {
    const { id } = req.params;
    const { id: usuario_id, nombre: nombre_usuario } = req.user;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Desactivar todas las listas
        await client.query('UPDATE listas_de_precios SET activa = false');
        
        // Activar solo la lista seleccionada
        const result = await client.query('UPDATE listas_de_precios SET activa = true WHERE id = $1 RETURNING nombre', [id]);

        if (result.rowCount === 0) {
            throw new Error('La lista de precios a activar no fue encontrada.');
        }
        const nombreLista = result.rows[0].nombre;

        // Registrar la acción
        const logDetail = `El usuario ${nombre_usuario} activó la lista de precios '${nombreLista}' (ID: ${id}).`;
        await client.query('INSERT INTO actividad (id_usuario, nombre_usuario, accion, detalle) VALUES ($1, $2, $3, $4)', [usuario_id, nombre_usuario, 'ACTIVAR_LISTA_PRECIOS', logDetail]);

        await client.query('COMMIT');
        res.status(200).json({ message: `La lista de precios '${nombreLista}' ha sido activada.` });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error al activar lista de precios:', error);
        next(error);
    } finally {
        client.release();
    }
};


module.exports = {
    getListasDePrecios,
    getListaDePreciosById,
    createListaDePrecios,
    setListaActiva
};
