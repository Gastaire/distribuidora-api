const db = require('../db');
const csv = require('csv-parser');
const { Readable } = require('stream');

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
const importProductos = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No se ha subido ningún archivo.' });
    }

    const resultados = [];
    const filasConError = [];
    let numeroFila = 1;

    const stream = Readable.from(req.file.buffer.toString('utf8'));

    stream
        .pipe(csv({
            mapHeaders: ({ header }) => {
                const headerTrimmed = header.trim().toLowerCase();
                if (headerTrimmed === 'a_cod') return 'codigo_sku';
                if (headerTrimmed === 'a_det') return 'nombre';
                if (headerTrimmed === 'a_plis1') return 'precio_unitario';
                return null;
            }
        }))
        .on('data', (data) => {
            numeroFila++;
            if (!data.codigo_sku || !data.nombre || data.precio_unitario === undefined || data.precio_unitario === '') {
                filasConError.push({ fila: numeroFila, error: 'Faltan datos esenciales (SKU, Nombre o Precio).', data: JSON.stringify(data) });
            } else if (isNaN(parseFloat(data.precio_unitario))) {
                filasConError.push({ fila: numeroFila, error: 'El precio no es un número válido.', data: JSON.stringify(data) });
            } else {
                resultados.push(data);
            }
        })
        .on('end', async () => {
            const client = await db.pool.connect();
            let creados = 0;
            let actualizados = 0;

            try {
                await client.query('BEGIN');

                for (const row of resultados) {
                    const sku = String(row.codigo_sku).trim();
                    const nombre = String(row.nombre).trim();
                    // Se aceptan decimales
                    const precio = parseFloat(row.precio_unitario);

                    // CORRECCIÓN: Se busca el SKU sin distinguir mayúsculas/minúsculas
                    const productoExistente = await client.query('SELECT id FROM productos WHERE LOWER(codigo_sku) = LOWER($1)', [sku]);

                    if (productoExistente.rows.length > 0) {
                        // Si existe, se actualiza
                        await client.query(
                            'UPDATE productos SET nombre = $1, precio_unitario = $2, stock = $3 WHERE LOWER(codigo_sku) = LOWER($4)',
                            [nombre, precio, 'Sí', sku]
                        );
                        actualizados++;
                    } else {
                        // Si no existe, se crea
                        await client.query(
                            'INSERT INTO productos (codigo_sku, nombre, precio_unitario, stock) VALUES ($1, $2, $3, $4)',
                            [sku, nombre, precio, 'Sí']
                        );
                        creados++;
                    }
                }
                
                await client.query('COMMIT');
                
                res.status(200).json({
                    message: `Importación completada.`,
                    creados: creados,
                    actualizados: actualizados,
                    filasOmitidas: filasConError.length,
                    errores: filasConError
                });

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
