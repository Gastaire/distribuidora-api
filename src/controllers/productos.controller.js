const db = require('../db');
const csv = require('csv-parser');
const { Readable } = require('stream');

// --- FUNCIONES CRUD ESTÁNDAR ---

const getProductos = async (req, res, next) => {
    const { format, include_archived } = req.query;
    const { rol } = req.user;

    try {
        // --- INICIO DE LA MODIFICACIÓN: Añadir nuevos campos de stock a la consulta ---
        let queryText = `
            SELECT 
                id, codigo_sku, nombre, descripcion, precio_unitario, 
                CASE 
                    WHEN lower(stock::text) = 'sí' THEN 'Sí'
                    ELSE 'No'
                END as stock,
                imagen_url, categoria, archivado,
                controla_stock, stock_cantidad
            FROM productos 
        `;
        // --- FIN DE LA MODIFICACIÓN ---

        if (rol !== 'admin' || include_archived !== 'true') {
            queryText += ' WHERE archivado = false ';
        }

        queryText += ' ORDER BY nombre ASC';
        
        const productosPromise = db.query(queryText);
        
        if (format === 'full') {
            const categoriasPromise = db.query(`
                SELECT DISTINCT categoria FROM productos WHERE categoria IS NOT NULL AND categoria <> '' ORDER BY categoria ASC
            `);

            const [productosResult, categoriasResult] = await Promise.all([productosPromise, categoriasPromise]);
            const productos = productosResult.rows;
            const categorias = categoriasResult.rows.map(row => row.categoria);

            res.status(200).json({
                productos: productos,
                categorias: categorias
            });

        } else {
            const productosResult = await productosPromise;
            res.status(200).json(productosResult.rows);
        }

    } catch (error) {
        console.error('Error al obtener productos:', error);
        next(error);
    }
};

const getProductoById = async (req, res, next) => {
    const { id } = req.params;
    try {
        // --- INICIO DE LA MODIFICACIÓN: Añadir nuevos campos de stock a la consulta ---
        const query = `
            SELECT 
                id, codigo_sku, nombre, descripcion, precio_unitario, 
                CASE 
                    WHEN lower(stock::text) IN ('si', 'sí') THEN 1
                    WHEN stock::text = '1' THEN 1
                    ELSE 0 
                END as stock,
                imagen_url, categoria, controla_stock, stock_cantidad
            FROM productos 
            WHERE id = $1
        `;
        // --- FIN DE LA MODIFICACIÓN ---
        const { rows } = await db.query(query, [id]);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Producto no encontrado' });
        }
        res.status(200).json(rows[0]);
    } catch (error) {
        console.error(`Error al obtener producto ${id}:`, error);
        next(error);
    }
};

const createProducto = async (req, res, next) => {
    // --- INICIO DE LA MODIFICACIÓN: Recibir nuevos campos de stock ---
    const { codigo_sku, nombre, descripcion, precio_unitario, stock, imagen_url, categoria, controla_stock, stock_cantidad } = req.body;
    try {
        const { rows } = await db.query(
            'INSERT INTO productos (codigo_sku, nombre, descripcion, precio_unitario, stock, imagen_url, categoria, controla_stock, stock_cantidad) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
            [codigo_sku, nombre, descripcion, precio_unitario, stock, imagen_url, categoria, controla_stock, stock_cantidad]
        );
        // --- FIN DE LA MODIFICACIÓN ---
        res.status(201).json(rows[0]);
    } catch (error) {
        console.error('Error al crear producto:', error);
        next(error);
    }
};

const updateProducto = async (req, res, next) => {
    const { id } = req.params;
    // --- INICIO DE LA MODIFICACIÓN: Recibir nuevos campos de stock ---
    const { codigo_sku, nombre, descripcion, precio_unitario, stock, imagen_url, categoria, controla_stock, stock_cantidad } = req.body;
    try {
        const { rows } = await db.query(
            'UPDATE productos SET codigo_sku = $1, nombre = $2, descripcion = $3, precio_unitario = $4, stock = $5, imagen_url = $6, categoria = $7, controla_stock = $8, stock_cantidad = $9 WHERE id = $10 RETURNING *',
            [codigo_sku, nombre, descripcion, precio_unitario, stock, imagen_url, categoria, controla_stock, stock_cantidad, id]
        );
        // --- FIN DE LA MODIFICACIÓN ---
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Producto no encontrado' });
        }
        res.status(200).json(rows[0]);
    } catch (error) {
        console.error(`Error al actualizar producto ${id}:`, error);
        next(error);
    }
};

const deleteProducto = async (req, res, next) => {
    const { id } = req.params;
    try {
        const result = await db.query(
            'UPDATE productos SET archivado = true WHERE id = $1', 
            [id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'Producto no encontrado' });
        }
        res.status(200).json({ message: 'Producto archivado correctamente.' });
    } catch (error) {
        console.error(`Error al archivar producto ${id}:`, error);
        next(error);
    }
};

const restoreProducto = async (req, res, next) => {
    const { id } = req.params;
    try {
        const result = await db.query(
            'UPDATE productos SET archivado = false WHERE id = $1', 
            [id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'Producto no encontrado o ya está activo.' });
        }
        res.status(200).json({ message: 'Producto restaurado correctamente.' });
    } catch (error) {
        console.error(`Error al restaurar producto ${id}:`, error);
        next(error);
    }
};

const importProductos = async (req, res, next) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No se ha subido ningún archivo.' });
    }

    const resultados = [];
    const filasConError = [];
    let numeroFila = 1;

    const stream = Readable.from(req.file.buffer.toString('utf8'));

    stream
        .pipe(csv({
            separator: ';',
            mapHeaders: ({ header }) => {
                const headerTrimmed = header.trim().toLowerCase();
                if (['a_cod', 'codigo_sku', 'codigo'].includes(headerTrimmed)) return 'codigo_sku';
                if (['a_det', 'nombre', 'descripcion'].includes(headerTrimmed)) return 'nombre';
                if (['a_plis1', 'precio_unitario', 'precio'].includes(headerTrimmed)) return 'precio_unitario';
                if (['stock'].includes(headerTrimmed)) return 'stock';
                return null;
            }
        }))
        .on('data', (data) => {
            numeroFila++;
            const precioStr = String(data.precio_unitario || '').replace(',', '.');
            if (!data.codigo_sku || !data.nombre || data.precio_unitario === undefined || data.precio_unitario === '') {
                filasConError.push({ fila: numeroFila, error: 'Faltan datos esenciales (SKU, Nombre o Precio).', data: JSON.stringify(data) });
            } else if (isNaN(parseFloat(precioStr))) {
                filasConError.push({ fila: numeroFila, error: 'El precio no es un número válido.', data: JSON.stringify(data) });
            } else {
                resultados.push(data);
            }
        })
        .on('end', async () => {
            if (resultados.length === 0) {
                return res.status(400).json({
                    message: 'No se encontraron productos válidos para importar.',
                    errores: filasConError
                });
            }

            const client = await db.pool.connect();
            let creados = 0;
            let actualizados = 0;
            try {
                await client.query('BEGIN');

                for (const row of resultados) {
                    let sku = String(row.codigo_sku).trim().replace(/^0+/, '');
                    const nombre = String(row.nombre).trim();
                    const precio = parseInt(String(row.precio_unitario).replace(',', '.'), 10);
                    
                    let stock = null;
                    if (row.stock !== undefined && row.stock !== null) {
                        stock = (String(row.stock).toLowerCase().trim() === 'si') ? 'Sí' : 'No';
                    }

                    const upsertQuery = `
                        INSERT INTO productos (codigo_sku, nombre, precio_unitario, stock)
                        VALUES ($1, $2, $3, $4)
                        ON CONFLICT (codigo_sku) 
                        DO UPDATE SET
                            nombre = EXCLUDED.nombre,
                            precio_unitario = EXCLUDED.precio_unitario,
                            stock = COALESCE($4, productos.stock)
                        RETURNING xmax;
                    `;
                    const result = await client.query(upsertQuery, [sku, nombre, precio, stock]);
                    
                    if (result.rows[0].xmax === '0') {
                        creados++;
                    } else {
                        actualizados++;
                    }
                }
                
                await client.query('COMMIT');

                const deleteDuplicatesQuery = `
                    DELETE FROM productos
                    WHERE id IN (
                        SELECT id
                        FROM (
                            SELECT
                                id,
                                ROW_NUMBER() OVER (PARTITION BY codigo_sku ORDER BY id ASC) as rn
                            FROM productos
                        ) t
                        WHERE t.rn > 1
                    );
                `;
                const { rowCount: eliminados } = await client.query(deleteDuplicatesQuery);

                res.status(200).json({
                    message: `Importación completada.`,
                    creados: creados,
                    actualizados: actualizados,
                    duplicadosEliminados: eliminados,
                    filasOmitidas: filasConError.length,
                    errores: filasConError
                });

            } catch (error) {
                await client.query('ROLLBACK');
                console.error('Error durante la importación de CSV:', error);
                next(error);
            } finally {
                client.release();
            }
        });
};

module.exports = {
    getProductos,
    getProductoById,
    createProducto,
    updateProducto,
    deleteProducto,
    importProductos,
    restoreProducto,
};
