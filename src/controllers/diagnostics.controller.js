const { pool } = require('../db');

/**
 * Analiza los items huérfanos (productos que fueron eliminados pero siguen en pedidos)
 * y los clasifica en diferentes categorías según la posibilidad de arreglo automático.
 */
const analyzeAndPreviewOrphanedItems = async (req, res) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Obtener todos los productos activos para comparar
        const { rows: activeProducts } = await client.query(`
            SELECT id, nombre, codigo_sku
            FROM productos
            WHERE archivado = false
        `);

        // 2. Obtener todos los items huérfanos (incluyendo su SKU original si existe)
        const { rows: orphanedItems } = await client.query(`
            SELECT
                pi.id as pedido_item_id,
                pi.pedido_id,
                pi.producto_id as old_producto_id,
                pi.nombre_producto,
                pi.codigo_sku,
                COALESCE(c.nombre_comercio, 'Cliente Desconocido') as nombre_comercio
            FROM
                pedido_items pi
            LEFT JOIN
                productos p ON pi.producto_id = p.id
            LEFT JOIN
                pedidos ped ON pi.pedido_id = ped.id
            LEFT JOIN
                clientes c ON ped.cliente_id = c.id
            WHERE
                p.id IS NULL
        `);

        // 3. Normalizar los SKUs para facilitar la comparación
        const normalizeSku = (sku) => {
            if (!sku) return '';
            return String(sku).trim().toLowerCase().replace(/^0+/, '');
        };

        // 4. Crear mapas para búsqueda rápida
        const productsBySku = new Map();
        const productsByName = new Map();

        activeProducts.forEach(product => {
            // Mapa de SKU -> producto
            if (product.codigo_sku) {
                const normalizedSku = normalizeSku(product.codigo_sku);
                if (normalizedSku) {
                    productsBySku.set(normalizedSku, product);
                }
            }

            // Mapa de nombre -> [productos]
            const nameKey = product.nombre.trim().toLowerCase();
            if (!productsByName.has(nameKey)) {
                productsByName.set(nameKey, []);
            }
            productsByName.get(nameKey).push(product);
        });

        // 5. Clasificar cada item huérfano en categorías
        const automaticFixCandidates = [];
        const manualFixCandidates = [];
        const needsIntervention = [];

        orphanedItems.forEach(orphan => {
            let matchFound = false;

            // --- Estrategia 1: Coincidencia por SKU (Confianza Alta) ---
            if (orphan.codigo_sku) {
                const normalizedSku = normalizeSku(orphan.codigo_sku);
                if (normalizedSku && productsBySku.has(normalizedSku)) {
                    const matchedProduct = productsBySku.get(normalizedSku);
                    automaticFixCandidates.push({
                        ...orphan,
                        new_producto_id: matchedProduct.id,
                        nombre_producto_huerfano: orphan.nombre_producto,
                        nombre_producto_nuevo: matchedProduct.nombre,
                        match_type: 'SKU'
                    });
                    matchFound = true;
                }
            }

            // --- Estrategia 2: Coincidencia por Nombre (Confianza Media) ---
            if (!matchFound && orphan.nombre_producto) {
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
                let reason = 'SIN_COINCIDENCIA';
                let nameMatches = [];
                if (orphan.nombre_producto) {
                    const nameKey = orphan.nombre_producto.trim().toLowerCase();
                    nameMatches = productsByName.get(nameKey) || [];
                    if (nameMatches.length > 1) {
                        reason = 'NOMBRE_DUPLICADO';
                    } else if (orphan.codigo_sku && productsBySku.has(normalizeSku(orphan.codigo_sku))) {
                        reason = 'SKU_DUPLICADO';
                    }
                }
                
                needsIntervention.push({
                    ...orphan,
                    reason,
                    possible_matches: nameMatches
                });
            }
        });

        await client.query('COMMIT');

        res.status(200).json({
            totalOrphanedItems: orphanedItems.length,
            automaticFixCandidates,
            manualFixCandidates,
            needsIntervention
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error analyzing orphaned items:', error);
        res.status(500).json({ message: 'Error al analizar items huérfanos' });
    } finally {
        client.release();
    }
};

/**
 * Ejecuta la corrección automática para los items huérfanos que tienen una coincidencia de alta confianza.
 */
const executeFixOrphanedItems = async (req, res) => {
    const { candidates } = req.body;
    const { id: usuario_id, nombre: nombre_usuario } = req.user;

    if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
        return res.status(400).json({ message: 'No se proporcionaron candidatos para corrección.' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        let updatedCount = 0;

        // Iterar sobre cada candidato y actualizar su producto_id
        for (const candidate of candidates) {
            const result = await client.query(
                'UPDATE pedido_items SET producto_id = $1 WHERE id = $2',
                [candidate.new_producto_id, candidate.pedido_item_id]
            );
            
            if (result.rowCount > 0) {
                updatedCount++;
            }
        }

        // Registrar la actividad en la tabla de logs
        const logDetail = `El usuario ${nombre_usuario} re-vinculó ${updatedCount} items huérfanos de pedidos.`;
        await client.query(
            'INSERT INTO actividad (id_usuario, nombre_usuario, accion, detalle) VALUES ($1, $2, $3, $4)',
            [usuario_id, nombre_usuario, 'CORREGIR_ITEMS_HUERFANOS', logDetail]
        );

        await client.query('COMMIT');

        res.status(200).json({
            success: true,
            message: 'Corrección de items huérfanos completada.',
            updatedCount
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error fixing orphaned items:', error);
        res.status(500).json({ message: 'Error al corregir items huérfanos' });
    } finally {
        client.release();
    }
};

module.exports = {
    analyzeAndPreviewOrphanedItems,
    executeFixOrphanedItems
};
