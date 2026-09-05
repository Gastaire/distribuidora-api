const db = require('../db');

// ============================================================
// ZONAS DE TUCUMÁN
// Para agregar más zonas, simplemente añadí una entrada al array.
// Coordenadas: bounding box (latMin, latMax, lngMin, lngMax).
// ============================================================
const ZONAS_TUCUMAN = [
    { nombre: 'Tucumán Capital', latMin: -26.90, latMax: -26.75, lngMin: -65.32, lngMax: -65.18 },
    { nombre: 'Lules',           latMin: -27.05, latMax: -26.88, lngMin: -65.45, lngMax: -65.20 },
    { nombre: 'La Reducción',    latMin: -27.18, latMax: -27.05, lngMin: -65.52, lngMax: -65.35 },
    { nombre: 'Famaillá',        latMin: -27.12, latMax: -26.98, lngMin: -65.48, lngMax: -65.33 },
    { nombre: 'Leales',          latMin: -27.28, latMax: -27.12, lngMin: -65.32, lngMax: -65.10 },
    { nombre: 'Bella Vista',     latMin: -27.05, latMax: -26.90, lngMin: -65.58, lngMax: -65.43 },
    { nombre: 'San Pablo',       latMin: -27.22, latMax: -27.08, lngMin: -65.68, lngMax: -65.52 },
    // --- Agregar aquí nuevas zonas según el dueño las defina ---
    // { nombre: 'Santa Rosa de Leales', latMin: ..., latMax: ..., lngMin: ..., lngMax: ... },
    // { nombre: 'San Andrés',           latMin: ..., latMax: ..., lngMin: ..., lngMax: ... },
];

/**
 * Detecta la zona de un cliente según sus coordenadas GPS.
 * Retorna el nombre de la zona o 'Otra' si no coincide con ninguna.
 */
const detectarZona = (lat, lng) => {
    if (!lat || !lng) return null;
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (isNaN(latNum) || isNaN(lngNum)) return null;
    const zona = ZONAS_TUCUMAN.find(z =>
        latNum >= z.latMin && latNum <= z.latMax &&
        lngNum >= z.lngMin && lngNum <= z.lngMax
    );
    return zona ? zona.nombre : 'Otra';
};

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
  
  // Calcular zona automáticamente desde GPS (si no fue definida manualmente)
  const zona = detectarZona(latitud, longitud);

  try {
    const { rows } = await db.query(
      'INSERT INTO clientes (nombre_comercio, nombre_contacto, direccion, telefono, localidad, latitud, longitud, horario_atencion, horario_entrega, vendedor_id, vendedor_nombre, zona, zona_manual) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *',
      [nombre_comercio, nombre_contacto, direccion, telefono, localidad || null, latitud || null, longitud || null, horario_atencion || null, horario_entrega || null, vendedor_id || null, vendedor_nombre || null, zona, false]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Error al crear cliente:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

const updateCliente = async (req, res) => {
    const { id } = req.params;
    const { nombre_comercio, nombre_contacto, direccion, telefono, localidad, latitud, longitud, horario_atencion, horario_entrega, vendedor_id, vendedor_nombre } = req.body;

    // Recalcular zona por GPS solo si no fue marcada como manual
    let zonaUpdate = '';
    let zonaParams = [];
    
    try {
        // Chequeamos si el cliente tiene zona_manual antes de sobreescribir
        const existingResult = await db.query('SELECT zona_manual FROM clientes WHERE id = $1', [id]);
        const esManual = existingResult.rows[0]?.zona_manual;
        
        if (!esManual && (latitud || longitud)) {
            const nuevaZona = detectarZona(latitud, longitud);
            zonaUpdate = ', zona = $13';
            zonaParams = [nuevaZona];
        }

        const params = [
            nombre_comercio, nombre_contacto, direccion, telefono,
            localidad || null, latitud || null, longitud || null,
            horario_atencion || null, horario_entrega || null,
            vendedor_id || null, vendedor_nombre || null,
            id,
            ...zonaParams
        ];

        const query = `UPDATE clientes SET 
            nombre_comercio = $1, nombre_contacto = $2, direccion = $3, telefono = $4,
            localidad = $5, latitud = $6, longitud = $7, horario_atencion = $8,
            horario_entrega = $9, vendedor_id = $10, vendedor_nombre = $11
            ${zonaUpdate}
            WHERE id = $12 RETURNING *`;

        const { rows } = await db.query(query, params);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Cliente no encontrado' });
        }
        res.status(200).json(rows[0]);
    } catch (error) {
        console.error('Error al actualizar cliente:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

/**
 * Permite al admin sobreescribir la zona de un cliente manualmente.
 * Marca zona_manual = TRUE para que los updates GPS no la pisen.
 */
const updateZonaManual = async (req, res) => {
    const { id } = req.params;
    const { zona } = req.body;
    if (!zona) return res.status(400).json({ message: 'Se requiere el campo zona.' });
    try {
        const { rows } = await db.query(
            'UPDATE clientes SET zona = $1, zona_manual = TRUE WHERE id = $2 RETURNING *',
            [zona, id]
        );
        if (rows.length === 0) return res.status(404).json({ message: 'Cliente no encontrado' });
        res.status(200).json(rows[0]);
    } catch (error) {
        console.error('Error al actualizar zona manual:', error);
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
  updateZonaManual,
  ZONAS_TUCUMAN, // Exportamos para reutilizar en el futuro si hace falta
};
