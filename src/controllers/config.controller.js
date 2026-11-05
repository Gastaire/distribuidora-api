const { pool } = require('../db');

// Obtener cronograma para un mes o un rango de fechas
const getCronograma = async (req, res, next) => {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
        return res.status(400).json({ message: 'startDate y endDate son requeridos (YYYY-MM-DD).' });
    }

    try {
        const query = `
            SELECT fecha, zonas
            FROM cronograma_entregas
            WHERE fecha >= $1 AND fecha <= $2
            ORDER BY fecha ASC
        `;
        const { rows } = await pool.query(query, [startDate, endDate]);
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error al obtener el cronograma:', error);
        next(error);
    }
};

// Actualizar o crear la zona para un solo día
const updateDiaCronograma = async (req, res, next) => {
    const { fecha, zonas } = req.body; // zonas = string separado por comas o un solo string.

    if (!fecha || zonas === undefined) {
        return res.status(400).json({ message: 'fecha y zonas son requeridos.' });
    }

    try {
        const query = `
            INSERT INTO cronograma_entregas (fecha, zonas)
            VALUES ($1, $2)
            ON CONFLICT (fecha)
            DO UPDATE SET zonas = EXCLUDED.zonas
            RETURNING *
        `;
        const { rows } = await pool.query(query, [fecha, zonas]);
        res.status(200).json(rows[0]);
    } catch (error) {
        console.error('Error al actualizar cronograma:', error);
        next(error);
    }
};

// Generar o copiar patrón recursivo (ej. aplicar configuración actual de la semana a las próximas X semanas)
const repeatCronogramaPattern = async (req, res, next) => {
    const { patternStartDate, patternEndDate, weeksToRepeat } = req.body;

    if (!patternStartDate || !patternEndDate || !weeksToRepeat) {
        return res.status(400).json({ message: 'Faltan parámetros de patrón.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Obtenemos el patrón original
        const { rows: patron } = await client.query(
            'SELECT fecha, zonas FROM cronograma_entregas WHERE fecha >= $1 AND fecha <= $2 ORDER BY fecha ASC',
            [patternStartDate, patternEndDate]
        );

        if (patron.length === 0) {
            throw new Error('No hay configuración en las fechas de origen para repetir.');
        }

        // Calculamos la duración en días del patrón
        const t1 = new Date(patternStartDate).getTime();
        const t2 = new Date(patternEndDate).getTime();
        const diasPatron = Math.round((t2 - t1) / (1000 * 60 * 60 * 24)) + 1;

        // Por cada semana a repetir (o bloque de días del patrón)
        for (let i = 1; i <= weeksToRepeat; i++) {
            const offsetDias = diasPatron * i;
            
            for (const item of patron) {
                // Calcular nueva fecha
                const nuevaFecha = new Date(item.fecha);
                nuevaFecha.setUTCDate(nuevaFecha.getUTCDate() + offsetDias);
                const nuevaFechaStr = nuevaFecha.toISOString().split('T')[0];

                await client.query(`
                    INSERT INTO cronograma_entregas (fecha, zonas)
                    VALUES ($1, $2)
                    ON CONFLICT (fecha) DO UPDATE SET zonas = EXCLUDED.zonas
                `, [nuevaFechaStr, item.zonas]);
            }
        }

        await client.query('COMMIT');
        res.status(200).json({ message: 'Patrón aplicado exitosamente.' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error al repetir patrón de zonas:', error);
        res.status(500).json({ message: error.message || 'Error interno' });
    } finally {
        client.release();
    }
};

// Save a repeating delivery schedule as one atomic operation.
const updateCronogramaBatch = async (req, res, next) => {
    const { fechas, zonas } = req.body;
    const validDate = value => {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const date = new Date(value);
        return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
    };
    if (!Array.isArray(fechas) || !fechas.length || fechas.length > 53 ||
        !fechas.every(validDate) || typeof zonas !== 'string' || !zonas.trim()) {
        return res.status(400).json({ message: 'Ingresá hasta 53 fechas válidas y al menos una zona.' });
    }
    try {
        const result = await pool.query(`
            INSERT INTO cronograma_entregas (fecha, zonas)
            SELECT dia, $2 FROM unnest($1::date[]) AS dia
            ON CONFLICT (fecha) DO UPDATE SET zonas = EXCLUDED.zonas
        `, [[...new Set(fechas)], zonas.trim()]);
        res.json({ dias: result.rowCount });
    } catch (err) {
        next(err);
    }
};

module.exports = {
    getCronograma,
    updateDiaCronograma,
    updateCronogramaBatch,
    repeatCronogramaPattern
};
