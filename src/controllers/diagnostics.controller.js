const db = require('../db');

/**
 * @description Normaliza un SKU eliminando los ceros iniciales para una comparación consistente.
 * Ej: '0480' -> '480', '00123' -> '123'
 * @param {string} sku El SKU a normalizar.
 * @returns {string} El SKU normalizado.
 */
const normalizeSku = (sku) => {
    if (!sku || typeof sku !== 'string') return '';
    return sku.replace(/^0+/, '');
};


/**
 * @description Analiza los items de pedidos huérfanos y los clasifica en categorías según la probabilidad de corrección.
 * @returns Un objeto con tres listas: `automaticFixCandidates`, `manualFixCandidates`, y `needsIntervention`.
 */
const analyzeAndPreviewOrphanedItems = async (req, res, next) => {
    const client = await db.pool.connect();
    try {
        // 1. Obtener todos los productos activos y organizarlos para búsqueda rápida
        const { rows: activeProducts } = await client.query('SELECT id, nombre, codigo_sku FROM productos WHERE archivado = false');
        
        const productsBySku = new Map();
        const productsByName = new Map();

        for (const product of activeProducts) {
            // Mapeo por SKU normalizado
            if (product.codigo_sku) {
                const normalized = normalizeSku(product.codigo_sku);
                if (!productsBySku.has(normalized)) {
                    productsBySku.set(normalized, []);
                }
                productsBySku.get(normalized).push(product);
            }
            // Mapeo por nombre
            const nameKey = product.nombre.trim().toLowerCase();
            if (!productsByName.has(nameKey)) {
                productsByName.set(nameKey, []);
            }
            productsByName.get(nameKey).push(product);
        }

        // 2. Obtener todos los items huérfanos (incluyendo su SKU original si existe)
        const { rows: orphanedItems } = await client.query(`
            SELECT
                pi.id as pedido_item_id,
                pi.pedido_id,
                pi.producto_id as old_producto_id,
                pi.nombre_producto,
                pi.codigo_sku,
                c.nombre_comercio
            FROM
                pedido_items pi
            LEFT JOIN
                productos p ON pi.producto_id = p.id
            LEFT JOIN
                pedidos ped ON pi.pedido_id = ped.id
            LEFT JOIN
                borradores b ON ped.borrador_id = b.id
            LEFT JOIN
                clientes c ON b.cliente_id = c.id
            WHERE
                p.id IS NULL
        `);

        // 3. Clasificar los huérfanos
        const automaticFixCandidates = [];
        const manualFixCandidates = [];
        const needsIntervention = [];

        for (const orphan of orphanedItems) {
            let matchFound = false;

            // --- Estrategia 1: Coincidencia por SKU (Alta Confianza) ---
            if (orphan.codigo_sku) {
                const normalizedOrphanSku = normalizeSku(orphan.codigo_sku);
                const skuMatches = productsBySku.get(normalizedOrphanSku);
                if (skuMatches && skuMatches.length === 1) {
                    automaticFixCandidates.push({
                        pedido_item_id: orphan.pedido_item_id,
                        old_producto_id: orphan.old_producto_id,
                        new_producto_id: skuMatches[0].id,
                        nombre_producto_huerfano: orphan.nombre_producto,
                        nombre_producto_nuevo: skuMatches[0].nombre,
                        match_type: 'SKU_UNICO'
                    });
                    matchFound = true;
                }
            }

            // --- Estrategia 2: Coincidencia por Nombre (Confianza Media) ---
            if (!matchFound) {
                const nameKey = orphan.nombre_producto.trim().toLowerCase();
                const nameMatches = productsByName.get(nameKey);
                if (nameMatches && nameMatches.length === 1) {
                    manualFixCandidates.push({
                        ...orphan,
                        new_producto_id: nameMatches[0].id,
                        new_producto_sku: nameMatches[0].codigo_sku,
                        match_type: 'NOMBRE_UNICO'
                    });
                    matchFound = true;
                }
            }
            
            // --- Estrategia 3: Casos para Intervención Manual ---
            if (!matchFound) {
                const nameKey = orphan.nombre_producto.trim().toLowerCase();
                const nameMatches = productsByName.get(nameKey);
                let reason = 'SIN_COINCIDENCIA';
                if (nameMatches && nameMatches.length > 1) {
                    reason = 'NOMBRE_DUPLICADO';
                } else if (orphan.codigo_sku && productsBySku.has(normalizeSku(orphan.codigo_sku))) {
                    reason = 'SKU_DUPLICADO';
                }
                
                needsIntervention.push({
                    ...orphan,
                    reason,
                    possible_matches: nameMatches || []
                });
            }
        }

        res.status(200).json({
            automaticFixCandidates,
            manualFixCandidates,
            needsIntervention
        });

    } catch (error) {
        console.error('Error al analizar items huérfanos:', error);
        next(error);
    } finally {
        client.release();
    }
};


/**
 * @description Ejecuta la corrección de items huérfanos actualizando su `producto_id`.
 * Recibe una lista de candidatos a corregir.
 */
const executeFixOrphanedItems = async (req, res, next) => {
    const { candidates } = req.body;
    const { id: usuario_id, nombre: nombre_usuario } = req.user;

    if (!Array.isArray(candidates) || candidates.length === 0) {
        return res.status(400).json({ message: 'No se proporcionaron candidatos para la corrección.' });
    }

    const client = await db.pool.connect();
    let updatedCount = 0;
    try {
        await client.query('BEGIN');

        for (const candidate of candidates) {
            const { pedido_item_id, new_producto_id } = candidate;
            
            // Verificación de seguridad
            if (!pedido_item_id || !new_producto_id) {
                throw new Error(`Candidato inválido: ${JSON.stringify(candidate)}`);
            }

            const result = await client.query(
                'UPDATE pedido_items SET producto_id = $1 WHERE id = $2',
                [new_producto_id, pedido_item_id]
            );
            updatedCount += result.rowCount;
        }
        
        const logDetail = `El usuario ${nombre_usuario} ejecutó una corrección automática de integridad, revinculando ${updatedCount} items de pedidos huérfanos.`;
        await client.query(
            'INSERT INTO actividad (id_usuario, nombre_usuario, accion, detalle) VALUES ($1, $2, $3, $4)',
            [usuario_id, nombre_usuario, 'CORREGIR_INTEGRIDAD', logDetail]
        );

        await client.query('COMMIT');

        res.status(200).json({
            message: `Proceso completado. Se corrigieron exitosamente ${updatedCount} items.`,
            updatedCount
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error durante la ejecución de la corrección de huérfanos:', error);
        next(error);
    } finally {
        client.release();
    }
};


module.exports = {
    analyzeAndPreviewOrphanedItems,
    executeFixOrphanedItems
};
