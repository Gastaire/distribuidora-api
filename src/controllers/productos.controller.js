const db = require('../db');
const csv = require('csv-parser');
const { Readable } = require('stream');

// --- FUNCIONES CRUD ESTÁNDAR (Sin cambios) ---

const getProductos = async (req, res, next) => {
    // --- INICIO DE LA MODIFICACIÓN ---
    // Leemos los parámetros de la URL
    const { format, include_archived } = req.query;
    // La protección de ruta nos da acceso al usuario y su rol
    const { rol } = req.user;

    try {
        // Construimos la consulta base
        let queryText = `
            SELECT 
                id, codigo_sku, nombre, descripcion, precio_unitario, 
                CASE 
                    WHEN lower(stock::text) = 'sí' THEN 'Sí'
                    ELSE 'No'
                END as stock,
                imagen_url, categoria, archivado
            FROM productos 
        `;

        // Por defecto, ocultamos los archivados.
        // Si el usuario es admin y pide verlos explícitamente, los incluimos.
        if (rol !== 'admin' || include_archived !== 'true') {
            queryText += ' WHERE archivado = false ';
        }

        queryText += ' ORDER BY nombre ASC';
        
        // La consulta de productos se hace siempre.
        const productosPromise = db.query(queryText);
        // --- FIN DE LA MODIFICACIÓN ---
        
        // --- LÓGICA DE COMPATIBILIDAD ---
        if (format === 'full') {
            // FORMATO NUEVO (para el panel de admin): pide explícitamente todos los datos.
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
            // FORMATO ANTIGUO (por defecto, para la app del vendedor y otros): solo productos.
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
        const query = `
            SELECT 
                id, 
                codigo_sku, 
                nombre, 
                descripcion, 
                precio_unitario, 
                CASE 
                    WHEN lower(stock::text) IN ('si', 'sí') THEN 1
                    WHEN stock::text = '1' THEN 1
                    ELSE 0 
                END as stock,
                imagen_url,
                categoria 
            FROM productos 
            WHERE id = $1
        `;
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
    const { codigo_sku, nombre, descripcion, precio_unitario, stock, imagen_url, categoria } = req.body;
    try {
        const { rows } = await db.query(
            'INSERT INTO productos (codigo_sku, nombre, descripcion, precio_unitario, stock, imagen_url, categoria) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [codigo_sku, nombre, descripcion, precio_unitario, stock, imagen_url, categoria]
        );
        res.status(201).json(rows[0]);
    } catch (error) {
        console.error('Error al crear producto:', error);
        next(error);
    }
};

const updateProducto = async (req, res, next) => {
    const { id } = req.params;
    const { codigo_sku, nombre, descripcion, precio_unitario, stock, imagen_url, categoria } = req.body;
    try {
        const { rows } = await db.query(
            'UPDATE productos SET codigo_sku = $1, nombre = $2, descripcion = $3, precio_unitario = $4, stock = $5, imagen_url = $6, categoria = $7 WHERE id = $8 RETURNING *',
            [codigo_sku, nombre, descripcion, precio_unitario, stock, imagen_url, categoria, id]
        );
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
        // --- INICIO DE LA MODIFICACIÓN: Cambiamos DELETE por UPDATE ---
        const result = await db.query(
            'UPDATE productos SET archivado = true WHERE id = $1', 
            [id]
        );
        // --- FIN DE LA MODIFICACIÓN ---

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'Producto no encontrado' });
        }
        // --- INICIO DE LA MODIFICACIÓN: Cambiamos el status code a 200 con un mensaje ---
        res.status(200).json({ message: 'Producto archivado correctamente.' });
        // --- FIN DE LA MODIFICACIÓN ---
    } catch (error) {
        console.error(`Error al archivar producto ${id}:`, error);
        next(error);
    }
};


// --- FUNCIÓN DE IMPORTACIÓN MEJORADA ---
/**
 * @description Procesa un archivo CSV para crear o actualizar productos.
 * 1. Usa una transacción para garantizar la integridad de los datos.
 * 2. Utiliza INSERT ... ON CONFLICT (upsert) para actualizar productos existentes o crear nuevos de forma atómica y eficiente.
 * 3. Aplica las reglas de negocio: precios como enteros y stock como 1 (Sí) o 0 (No).
 * 4. Después de una importación exitosa, ejecuta una limpieza para eliminar duplicados, conservando el más antiguo.
 */
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
            separator: ';', // Asegúrate de que tu CSV usa punto y coma
            mapHeaders: ({ header }) => {
                const headerTrimmed = header.trim().toLowerCase();
                // Mapeo flexible de cabeceras
                if (['a_cod', 'codigo_sku', 'codigo'].includes(headerTrimmed)) return 'codigo_sku';
                if (['a_det', 'nombre', 'descripcion'].includes(headerTrimmed)) return 'nombre';
                if (['a_plis1', 'precio_unitario', 'precio'].includes(headerTrimmed)) return 'precio_unitario';
                if (['stock'].includes(headerTrimmed)) return 'stock';
                return null; // Ignora otras columnas
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
                // Inicia la transacción principal para la importación
                await client.query('BEGIN');

                // ... dentro del bucle for ...
                for (const row of resultados) {
                    // NORMALIZACIÓN DEL SKU
                    let sku = String(row.codigo_sku).trim().replace(/^0+/, '');
                
                    const nombre = String(row.nombre).trim();
                    const precio = parseInt(String(row.precio_unitario).replace(',', '.'), 10);
                    
                    // --- AQUÍ ESTÁ LA MEJORA ---
                    // Se crea la variable `stock` y solo se le asigna un valor si el CSV lo incluye.
                    // Si no, se queda como `null`.
                    let stock = null;
                    if (row.stock !== undefined && row.stock !== null) {
                        stock = (String(row.stock).toLowerCase().trim() === 'si') ? 'Sí' : 'No';
                    }

                    // **MEJORA CLAVE EN LA CONSULTA SQL**
                    // La consulta ahora usa COALESCE para preservar el valor del stock si no se proporciona uno nuevo.
                    const upsertQuery = `
                        INSERT INTO productos (codigo_sku, nombre, precio_unitario, stock)
                        VALUES ($1, $2, $3, $4)
                        ON CONFLICT (codigo_sku) 
                        DO UPDATE SET
                            nombre = EXCLUDED.nombre,
                            precio_unitario = EXCLUDED.precio_unitario,
                            stock = COALESCE($4, productos.stock) -- Si el nuevo stock ($4) es NULL, mantiene el valor antiguo (productos.stock)
                        RETURNING xmax;
                    `;
                    const result = await client.query(upsertQuery, [sku, nombre, precio, stock]);
                    
                    if (result.rows[0].xmax === '0') {
                        creados++;
                    } else {
                        actualizados++;
                    }
                }
                
                // Si todo fue bien, confirma la transacción de importación
                await client.query('COMMIT');

                // --- PASO DE AUTOLIMPIEZA ---
                // Después de la importación, busca y elimina duplicados, conservando el más antiguo.
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
                // Si algo falla, revierte todos los cambios
                await client.query('ROLLBACK');
                console.error('Error durante la importación de CSV:', error);
                next(error); // Pasa el error al manejador de errores de Express
            } finally {
                // Libera la conexión con la base de datos
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
};
