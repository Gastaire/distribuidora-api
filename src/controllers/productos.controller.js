const db = require('../db'); // Asegúrate de que esta línea esté al inicio
const csv = require('csv-parser');
const { Readable } = require('stream');

// OBTENER TODOS los productos
const getProductos = async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM productos ORDER BY nombre ASC');
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error al obtener productos:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// OBTENER UN SOLO producto por ID
const getProductoById = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('SELECT * FROM productos WHERE id = $1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Producto no encontrado' });
    }
    res.status(200).json(rows[0]);
  } catch (error) {
    console.error(`Error al obtener producto ${id}:`, error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// CREAR un nuevo producto (versión actualizada)
const createProducto = async (req, res) => {
  // Añadimos imagen_url
  const { codigo_sku, nombre, descripcion, precio_unitario, stock, imagen_url } = req.body;
  try {
    const { rows } = await db.query(
      'INSERT INTO productos (codigo_sku, nombre, descripcion, precio_unitario, stock, imagen_url) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [codigo_sku, nombre, descripcion, precio_unitario, stock, imagen_url]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Error al crear producto:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// ACTUALIZAR un producto existente (versión actualizada)
const updateProducto = async (req, res) => {
  const { id } = req.params;
  // Añadimos imagen_url
  const { codigo_sku, nombre, descripcion, precio_unitario, stock, imagen_url } = req.body;
  try {
    const { rows } = await db.query(
      'UPDATE productos SET codigo_sku = $1, nombre = $2, descripcion = $3, precio_unitario = $4, stock = $5, imagen_url = $6 WHERE id = $7 RETURNING *',
      [codigo_sku, nombre, descripcion, precio_unitario, stock, imagen_url, id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Producto no encontrado' });
    }
    res.status(200).json(rows[0]);
  } catch (error) {
    console.error(`Error al actualizar producto ${id}:`, error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// ELIMINAR un producto
const deleteProducto = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query('DELETE FROM productos WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Producto no encontrado' });
    }
    res.status(204).send(); // 204 No Content: éxito, pero no hay nada que devolver
  } catch (error) {
    console.error(`Error al eliminar producto ${id}:`, error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// **VERSIÓN CORREGIDA** para importar productos desde CSV
const importProductos = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No se ha subido ningún archivo.' });
    }

    const results = [];
    const stream = Readable.from(req.file.buffer.toString('utf8'));

    stream
        .pipe(csv({
            mapHeaders: ({ header }) => header.trim()
        }))
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            // **CORRECCIÓN:** Accedemos a la pool a través del objeto 'db' importado
            const client = await db.pool.connect();
            try {
                await client.query('BEGIN');
                let importedCount = 0;
                for (const row of results) {
                    const sku = row.codigo_sku || null;
                    const nombre = row.nombre;
                    const precio = Math.round(parseFloat(row.precio_unitario));

                    if (!nombre || isNaN(precio)) {
                        console.warn('Fila omitida por datos inválidos:', row);
                        continue;
                    }

                    const query = `
                        INSERT INTO productos (codigo_sku, nombre, precio_unitario, stock)
                        VALUES ($1, $2, $3, 'Sí')
                        ON CONFLICT (codigo_sku) DO UPDATE SET
                            nombre = EXCLUDED.nombre,
                            precio_unitario = EXCLUDED.precio_unitario,
                            stock = 'Sí'
                    `;
                    await client.query(query, [sku, nombre, precio]);
                    importedCount++;
                }
                await client.query('COMMIT');
                res.status(200).json({ message: `${importedCount} productos importados/actualizados exitosamente.` });
            } catch (error) {
                await client.query('ROLLBACK');
                console.error('Error durante la importación de CSV:', error);
                res.status(500).json({ message: 'Error en el servidor durante la importación.' });
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
};
