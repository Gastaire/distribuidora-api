const db = require('../db');

const getClientes = async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM clientes ORDER BY nombre_comercio ASC');
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

const getClienteById = async (req, res) => {
    const { id } = req.params;
    try {
        const { rows } = await db.query('SELECT * FROM clientes WHERE id = $1', [id]);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Cliente no encontrado' });
        }
        res.status(200).json(rows[0]);
    } catch (error) {
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

const createCliente = async (req, res) => {
  const { nombre_comercio, nombre_contacto, direccion, telefono, localidad, latitud, longitud, horario_atencion, horario_entrega, vendedor_id, vendedor_nombre } = req.body;
  try {
    const { rows } = await db.query(
      'INSERT INTO clientes (nombre_comercio, nombre_contacto, direccion, telefono, localidad, latitud, longitud, horario_atencion, horario_entrega, vendedor_id, vendedor_nombre) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *',
      [nombre_comercio, nombre_contacto, direccion, telefono, localidad || null, latitud || null, longitud || null, horario_atencion || null, horario_entrega || null, vendedor_id || null, vendedor_nombre || null]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

const updateCliente = async (req, res) => {
    const { id } = req.params;
    const { nombre_comercio, nombre_contacto, direccion, telefono, localidad, latitud, longitud, horario_atencion, horario_entrega, vendedor_id, vendedor_nombre } = req.body;
    try {
        const { rows } = await db.query(
            'UPDATE clientes SET nombre_comercio = $1, nombre_contacto = $2, direccion = $3, telefono = $4, localidad = $5, latitud = $6, longitud = $7, horario_atencion = $8, horario_entrega = $9, vendedor_id = $10, vendedor_nombre = $11 WHERE id = $12 RETURNING *',
            [nombre_comercio, nombre_contacto, direccion, telefono, localidad || null, latitud || null, longitud || null, horario_atencion || null, horario_entrega || null, vendedor_id || null, vendedor_nombre || null, id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Cliente no encontrado' });
        }
        res.status(200).json(rows[0]);
    } catch (error) {
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

const deleteCliente = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.query('DELETE FROM clientes WHERE id = $1', [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'Cliente no encontrado' });
        }
        res.status(204).send();
    } catch (error) {
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

module.exports = {
  getClientes,
  getClienteById,
  createCliente,
  updateCliente,
  deleteCliente,
};
