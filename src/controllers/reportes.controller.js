const { pool } = require('../db');

// --- Helper: parsea fechas y arma el filtro WHERE ---
const buildDateFilter = (startDate, endDate, column, paramOffset = 1) => {
    const conditions = [];
    const params = [];
    let idx = paramOffset;

    if (startDate) {
        conditions.push(`${column} >= $${idx++}`);
        params.push(startDate);
    }
    if (endDate) {
        // endDate inclusivo: tomamos hasta el final del día
        conditions.push(`${column} < ($${idx++}::date + INTERVAL '1 day')`);
        params.push(endDate);
    }

    return { conditions, params, nextIdx: idx };
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reportes/faltantes-diario (endpoint original, sin cambios)
// ─────────────────────────────────────────────────────────────────────────────
const getReporteFaltantes = async (req, res, next) => {
    try {
        const { rows } = await pool.query(`
            SELECT
                nombre_producto,
                SUM(cantidad_original) AS total_faltante
            FROM registro_faltantes
            WHERE fecha_registro >= NOW() - INTERVAL '24 hours'
            GROUP BY nombre_producto
            ORDER BY total_faltante DESC
        `);

        res.status(200).json({
            message: rows.length === 0
                ? 'No se registraron productos faltantes en las últimas 24 horas.'
                : `Reporte de ${rows.length} producto(s) faltante(s) generado.`,
            faltantes: rows
        });
    } catch (error) {
        console.error('Error al generar el reporte de faltantes:', error);
        next(error);
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reportes/diario-pedidos
// Resumen del día (o del rango indicado): pedidos por estado, monto total,
// cantidad de clientes únicos atendidos.
// Query params: startDate (YYYY-MM-DD), endDate (YYYY-MM-DD)
// Sin params = hoy
// ─────────────────────────────────────────────────────────────────────────────
const getReporteDiarioPedidos = async (req, res, next) => {
    const { startDate, endDate } = req.query;

    // Si no viene rango, usamos el día actual
    const desde = startDate || new Date().toISOString().slice(0, 10);
    const hasta = endDate   || new Date().toISOString().slice(0, 10);

    const { conditions, params, nextIdx } = buildDateFilter(desde, hasta, 'p.fecha_creacion', 1);
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
        const client = await pool.connect();
        try {
            // Resumen por estado
            const byEstado = await client.query(`
                SELECT
                    p.estado,
                    COUNT(*)                                          AS total_pedidos,
                    COUNT(DISTINCT p.cliente_id)                      AS clientes_unicos,
                    COALESCE(SUM(pi.cantidad * pi.precio_congelado), 0) AS monto_total
                FROM pedidos p
                LEFT JOIN pedido_items pi ON pi.pedido_id = p.id
                ${whereClause}
                GROUP BY p.estado
                ORDER BY total_pedidos DESC
            `, params);

            // Totales generales (todos los estados)
            const totales = await client.query(`
                SELECT
                    COUNT(DISTINCT p.id)                                AS total_pedidos,
                    COUNT(DISTINCT p.cliente_id)                        AS clientes_unicos,
                    COUNT(DISTINCT p.usuario_id)                        AS vendedores_activos,
                    COALESCE(SUM(pi.cantidad * pi.precio_congelado), 0) AS monto_total,
                    COALESCE(SUM(pi.cantidad), 0)                       AS unidades_totales
                FROM pedidos p
                LEFT JOIN pedido_items pi ON pi.pedido_id = p.id
                ${whereClause}
            `, params);

            res.status(200).json({
                periodo: { desde, hasta },
                resumen: totales.rows[0],
                por_estado: byEstado.rows,
            });
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error en reporte diario de pedidos:', error);
        next(error);
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reportes/pedidos-por-vendedor
// Rendimiento de cada vendedor: pedidos, monto, clientes únicos.
// Query params: startDate, endDate
// ─────────────────────────────────────────────────────────────────────────────
const getReportePedidosPorVendedor = async (req, res, next) => {
    const { startDate, endDate } = req.query;
    const { conditions, params } = buildDateFilter(startDate, endDate, 'p.fecha_creacion', 1);

    // Excluimos estados que no representan venta real
    const estadosExcluidos = `('cancelado', 'archivado', 'combinado')`;
    const baseWhere = `p.estado NOT IN ${estadosExcluidos}`;
    const whereClause = conditions.length
        ? `WHERE ${baseWhere} AND ${conditions.join(' AND ')}`
        : `WHERE ${baseWhere}`;

    try {
        const { rows } = await pool.query(`
            SELECT
                u.id                                                    AS vendedor_id,
                u.nombre                                                AS vendedor,
                COUNT(DISTINCT p.id)                                    AS total_pedidos,
                COUNT(DISTINCT p.cliente_id)                            AS clientes_unicos,
                COALESCE(SUM(pi.cantidad * pi.precio_congelado), 0)     AS monto_total,
                COALESCE(SUM(pi.cantidad), 0)                           AS unidades_vendidas,
                ROUND(
                    COALESCE(SUM(pi.cantidad * pi.precio_congelado), 0)
                    / NULLIF(COUNT(DISTINCT p.id), 0)
                , 2)                                                     AS ticket_promedio
            FROM pedidos p
            JOIN usuarios u ON u.id = p.usuario_id
            LEFT JOIN pedido_items pi ON pi.pedido_id = p.id
            ${whereClause}
            GROUP BY u.id, u.nombre
            ORDER BY monto_total DESC
        `, params);

        res.status(200).json({
            periodo: { startDate: startDate || null, endDate: endDate || null },
            vendedores: rows,
        });
    } catch (error) {
        console.error('Error en reporte por vendedor:', error);
        next(error);
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reportes/pedidos-entregados
// Lista de pedidos en estado "entregado", con cliente, vendedor e items.
// Query params: startDate, endDate, vendedor_id (opcional)
// ─────────────────────────────────────────────────────────────────────────────
const getReportePedidosEntregados = async (req, res, next) => {
    const { startDate, endDate, vendedor_id } = req.query;

    const params = [];
    const conditions = [`p.estado = 'entregado'`];
    let idx = 1;

    if (startDate) {
        conditions.push(`p.fecha_creacion >= $${idx++}`);
        params.push(startDate);
    }
    if (endDate) {
        conditions.push(`p.fecha_creacion < ($${idx++}::date + INTERVAL '1 day')`);
        params.push(endDate);
    }
    if (vendedor_id) {
        conditions.push(`p.usuario_id = $${idx++}`);
        params.push(parseInt(vendedor_id));
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    try {
        const client = await pool.connect();
        try {
            // Pedidos
            const pedidos = await client.query(`
                SELECT
                    p.id,
                    p.fecha_creacion,
                    p.notas_entrega,
                    c.nombre_comercio,
                    c.direccion,
                    u.nombre                                                AS vendedor,
                    COALESCE(SUM(pi.cantidad * pi.precio_congelado), 0)     AS monto_total,
                    COALESCE(SUM(pi.cantidad), 0)                           AS unidades_totales,
                    COUNT(pi.id)                                            AS cantidad_items
                FROM pedidos p
                LEFT JOIN clientes c   ON c.id = p.cliente_id
                LEFT JOIN usuarios u   ON u.id = p.usuario_id
                LEFT JOIN pedido_items pi ON pi.pedido_id = p.id
                ${whereClause}
                GROUP BY p.id, c.nombre_comercio, c.direccion, u.nombre
                ORDER BY p.fecha_creacion DESC
            `, params);

            // Totales del período
            const totales = await pool.query(`
                SELECT
                    COUNT(DISTINCT p.id)                                    AS total_pedidos,
                    COUNT(DISTINCT p.cliente_id)                            AS clientes_unicos,
                    COALESCE(SUM(pi.cantidad * pi.precio_congelado), 0)     AS monto_total
                FROM pedidos p
                LEFT JOIN pedido_items pi ON pi.pedido_id = p.id
                ${whereClause}
            `, params);

            res.status(200).json({
                periodo: { startDate: startDate || null, endDate: endDate || null, vendedor_id: vendedor_id || null },
                resumen: totales.rows[0],
                pedidos: pedidos.rows,
            });
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error en reporte de pedidos entregados:', error);
        next(error);
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reportes/clientes-inactivos
// Clientes que NO tienen pedidos en los últimos N días.
// Query params: dias (default: 30)
// ─────────────────────────────────────────────────────────────────────────────
const getReporteClientesInactivos = async (req, res, next) => {
    const dias = parseInt(req.query.dias) || 30;

    try {
        const { rows } = await pool.query(`
            SELECT
                c.id,
                c.nombre_comercio,
                c.nombre_contacto,
                c.telefono,
                c.direccion,
                MAX(p.fecha_creacion)   AS ultimo_pedido,
                COUNT(p.id)             AS total_pedidos_historicos
            FROM clientes c
            LEFT JOIN pedidos p ON p.cliente_id = c.id
                AND p.estado NOT IN ('cancelado', 'archivado', 'combinado')
            GROUP BY c.id, c.nombre_comercio, c.nombre_contacto, c.telefono, c.direccion
            HAVING
                MAX(p.fecha_creacion) < NOW() - ($1 || ' days')::INTERVAL
                OR MAX(p.fecha_creacion) IS NULL
            ORDER BY ultimo_pedido ASC NULLS FIRST
        `, [dias]);

        res.status(200).json({
            dias_sin_pedido: dias,
            total: rows.length,
            clientes: rows,
        });
    } catch (error) {
        console.error('Error en reporte de clientes inactivos:', error);
        next(error);
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reportes/productos-mas-pedidos
// Top productos ordenados por unidades o por monto.
// Query params: startDate, endDate, orderBy ('cantidad'|'monto'), limit (default: 20)
// ─────────────────────────────────────────────────────────────────────────────
const getReporteProductosMasPedidos = async (req, res, next) => {
    const { startDate, endDate, orderBy = 'cantidad' } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const { conditions, params } = buildDateFilter(startDate, endDate, 'p.fecha_creacion', 1);
    const estadosExcluidos = `('cancelado', 'archivado', 'combinado')`;
    const baseCondition = `p.estado NOT IN ${estadosExcluidos}`;

    const whereClause = conditions.length
        ? `WHERE ${baseCondition} AND ${conditions.join(' AND ')}`
        : `WHERE ${baseCondition}`;

    const orderColumn = orderBy === 'monto' ? 'monto_total' : 'unidades_vendidas';
    params.push(limit);
    const limitParam = `$${params.length}`;

    try {
        const { rows } = await pool.query(`
            SELECT
                pi.producto_id,
                pi.nombre_producto,
                pi.codigo_sku,
                pr.categoria,
                SUM(pi.cantidad)                                    AS unidades_vendidas,
                COALESCE(SUM(pi.cantidad * pi.precio_congelado), 0) AS monto_total,
                COUNT(DISTINCT pi.pedido_id)                        AS aparece_en_pedidos,
                ROUND(AVG(pi.precio_congelado), 2)                  AS precio_promedio
            FROM pedido_items pi
            JOIN pedidos p   ON p.id = pi.pedido_id
            LEFT JOIN productos pr ON pr.id = pi.producto_id
            ${whereClause}
            GROUP BY pi.producto_id, pi.nombre_producto, pi.codigo_sku, pr.categoria
            ORDER BY ${orderColumn} DESC
            LIMIT ${limitParam}
        `, params);

        res.status(200).json({
            periodo: { startDate: startDate || null, endDate: endDate || null },
            order_by: orderBy,
            total_productos: rows.length,
            productos: rows,
        });
    } catch (error) {
        console.error('Error en reporte de productos más pedidos:', error);
        next(error);
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reportes/faltantes-historico
// Historial de ítems removidos de pedidos (registro_faltantes), con rango.
// Query params: startDate, endDate, limit (default: 100)
// ─────────────────────────────────────────────────────────────────────────────
const getReporteFaltantesHistorico = async (req, res, next) => {
    const { startDate, endDate } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);

    const { conditions, params } = buildDateFilter(startDate, endDate, 'rf.fecha_registro', 1);
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit);
    const limitParam = `$${params.length}`;

    try {
        const client = await pool.connect();
        try {
            // Detalle por registro
            const detalle = await client.query(`
                SELECT
                    rf.id,
                    rf.pedido_id,
                    rf.nombre_producto,
                    rf.cantidad_original,
                    rf.fecha_registro,
                    rf.nombre_usuario_modifico AS modificado_por
                FROM registro_faltantes rf
                ${whereClause}
                ORDER BY rf.fecha_registro DESC
                LIMIT ${limitParam}
            `, params);

            // Agrupado por producto
            const paramsAgrupado = conditions.length ? params.slice(0, -1) : []; // sin el limit
            const whereAgg = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

            const agrupado = await client.query(`
                SELECT
                    nombre_producto,
                    SUM(cantidad_original) AS total_faltante,
                    COUNT(*)               AS veces_removido
                FROM registro_faltantes rf
                ${whereAgg}
                GROUP BY nombre_producto
                ORDER BY total_faltante DESC
                LIMIT 20
            `, paramsAgrupado);

            res.status(200).json({
                periodo: { startDate: startDate || null, endDate: endDate || null },
                resumen_por_producto: agrupado.rows,
                registros: detalle.rows,
            });
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error en historial de faltantes:', error);
        next(error);
    }
};

module.exports = {
    getReporteFaltantes,
    getReporteDiarioPedidos,
    getReportePedidosPorVendedor,
    getReportePedidosEntregados,
    getReporteClientesInactivos,
    getReporteProductosMasPedidos,
    getReporteFaltantesHistorico,
};
