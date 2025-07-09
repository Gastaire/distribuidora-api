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
  const { nombre_comercio, nombre_contacto, direccion, telefono } = req.body;
  try {
    const { rows } = await db.query(
      'INSERT INTO clientes (nombre_comercio, nombre_contacto, direccion, telefono) VALUES ($1, $2, $3, $4) RETURNING *',
      [nombre_comercio, nombre_contacto, direccion, telefono]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

const updateCliente = async (req, res) => {
    const { id } = req.params;
    const { nombre_comercio, nombre_contacto, direccion, telefono } = req.body;
    try {
        const { rows } = await db.query(
            'UPDATE clientes SET nombre_comercio = $1, nombre_contacto = $2, direccion = $3, telefono = $4 WHERE id = $5 RETURNING *',
            [nombre_comercio, nombre_contacto, direccion, telefono, id]
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
