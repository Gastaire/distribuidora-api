const db = require('../db');
const csv = require('csv-parser');
const { Readable } = require('stream');
const fs = require('fs');


const getProductos = async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM productos ORDER BY nombre ASC');
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error al obtener productos:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

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

const createProducto = async (req, res) => {
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

const updateProducto = async (req, res) => {
  const { id } = req.params;
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

const deleteProducto = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query('DELETE FROM productos WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Producto no encontrado' });
    }
    res.status(204).send();
  } catch (error) {
    console.error(`Error al eliminar producto ${id}:`, error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};


// **FUNCIÓN DE IMPORTACIÓN REFINADA Y CORREGIDA**
const importProducts = async (req, res, next) => {
    if (!req.file) {
        return res.status(400).send('No se ha subido ningún archivo.');
    }

    const results = [];
    const filePath = req.file.path;

    try {
        await new Promise((resolve, reject) => {
            fs.createReadStream(filePath)
                .pipe(csv({ separator: ';' }))
                .on('data', (data) => results.push(data))
                .on('end', resolve)
                .on('error', reject);
        });

        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            for (const item of results) {
                const codigo_sku = item.codigo_sku ? item.codigo_sku.trim() : null;
                const nombre = item.nombre;
                const descripcion = item.descripcion || '';

                // --- BUSINESS LOGIC CHANGES ---
                // 1. Price: Parse price as a float first, then truncate to an integer.
                const precio_unitario = parseInt(String(item.precio_unitario || '0').replace(',', '.'), 10);

                // 2. Stock: Interpret 'si' as 1 (available) and anything else as 0 (unavailable).
                const stock = (item.stock || '').toLowerCase().trim() === 'si' ? 1 : 0;
                // --- END OF CHANGES ---

                if (!codigo_sku || !nombre) {
                    console.warn('Fila de CSV omitida por no tener codigo_sku o nombre:', item);
                    continue;
                }

                if (isNaN(precio_unitario)) {
                    console.warn('Fila de CSV omitida por precio inválido:', item);
                    continue;
                }

                const upsertQuery = `
                    INSERT INTO productos (codigo_sku, nombre, descripcion, precio_unitario, stock)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (codigo_sku) 
                    DO UPDATE SET
                        nombre = EXCLUDED.nombre,
                        descripcion = EXCLUDED.descripcion,
                        precio_unitario = EXCLUDED.precio_unitario,
                        stock = EXCLUDED.stock;
                `;
                
                await client.query(upsertQuery, [codigo_sku, nombre, descripcion, precio_unitario, stock]);
            }

            await client.query('COMMIT');
            res.status(200).json({ message: 'Productos importados y actualizados correctamente.' });

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error durante la importación de productos. Se revirtieron los cambios:', error);
            next(error);
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error al leer el archivo CSV:', error);
        res.status(500).json({ message: 'Error al procesar el archivo CSV.' });
    } finally {
        fs.unlinkSync(filePath);
    }
};

module.exports = {
  getProductos,
  getProductoById,
  createProducto,
  updateProducto,
  deleteProducto,
  importProductos,
};
