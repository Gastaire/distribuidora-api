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

// Estados que no representan venta real
const ESTADOS_EXCLUIDOS = `('cancelado', 'archivado', 'combinado')`;

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
// GET /api/reportes/resumen-ejecutivo
// KPIs de alto nivel + datos temporales para gráficos.
// Query params: startDate (YYYY-MM-DD), endDate (YYYY-MM-DD)
// Sin params = últimos 7 días
// ─────────────────────────────────────────────────────────────────────────────
const getReporteResumenEjecutivo = async (req, res, next) => {
    const { startDate, endDate } = req.query;

    const desde = startDate || new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    const hasta = endDate   || new Date().toISOString().slice(0, 10);

    const { conditions, params } = buildDateFilter(desde, hasta, 'p.fecha_creacion', 1);
    conditions.push(`p.estado NOT IN ${ESTADOS_EXCLUIDOS}`);
    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    try {
        const client = await pool.connect();
        try {
            // 1. KPIs principales
            const kpis = await client.query(`
                SELECT
                    COUNT(DISTINCT p.id)                                    AS total_pedidos,
                    COUNT(DISTINCT p.cliente_id)                            AS clientes_atendidos,
                    COUNT(DISTINCT p.usuario_id)                            AS vendedores_activos,
                    COALESCE(SUM(pi.cantidad * pi.precio_congelado), 0)     AS ingresos_totales,
                    COALESCE(SUM(pi.cantidad), 0)                           AS unidades_totales,
                    ROUND(
                        COALESCE(SUM(pi.cantidad * pi.precio_congelado), 0)
                        / NULLIF(COUNT(DISTINCT p.id), 0)
                    , 2)                                                     AS ticket_promedio
                FROM pedidos p
                LEFT JOIN pedido_items pi ON pi.pedido_id = p.id
                ${whereClause}
            `, params);

            // 2. Conteos por estado (incluyendo cancelados para calcular tasas)
            const paramsTodos = [];
            const condTodos = [];
            if (desde) { condTodos.push(`p.fecha_creacion >= $${paramsTodos.length + 1}`); paramsTodos.push(desde); }
            if (hasta) { condTodos.push(`p.fecha_creacion < ($${paramsTodos.length + 1}::date + INTERVAL '1 day')`); paramsTodos.push(hasta); }
            const whereTodos = condTodos.length ? `WHERE ${condTodos.join(' AND ')}` : '';

            const porEstado = await client.query(`
                SELECT
                    p.estado,
                    COUNT(DISTINCT p.id)                                    AS total_pedidos,
                    COUNT(DISTINCT p.cliente_id)                            AS clientes_unicos,
                    COALESCE(SUM(pi.cantidad * pi.precio_congelado), 0)     AS monto_total
                FROM pedidos p
                LEFT JOIN pedido_items pi ON pi.pedido_id = p.id
                ${whereTodos}
                AND p.estado != 'archivado'
                GROUP BY p.estado
                ORDER BY total_pedidos DESC
            `, paramsTodos);

            // 3. Datos temporales para gráfico de línea (ingresos por día)
            const porDia = await client.query(`
                SELECT
                    DATE(p.fecha_creacion)                                   AS fecha,
                    COUNT(DISTINCT p.id)                                    AS pedidos,
                    COALESCE(SUM(pi.cantidad * pi.precio_congelado), 0)     AS ingresos
                FROM pedidos p
                LEFT JOIN pedido_items pi ON pi.pedido_id = p.id
                ${whereClause}
                GROUP BY DATE(p.fecha_creacion)
                ORDER BY fecha ASC
            `, params);

            // 4. Calcular métricas derivadas
            const r = kpis.rows[0];
            const totalConTodos = porEstado.rows.reduce((acc, e) => acc + parseInt(e.total_pedidos || 0), 0);
            const entregados = porEstado.rows.find(e => e.estado === 'entregado');
            const cancelados = porEstado.rows.find(e => e.estado === 'cancelado');
            const diasPeriodo = Math.max(1, Math.ceil((new Date(hasta) - new Date(desde)) / 86400000) + 1);

            res.status(200).json({
                periodo: { desde, hasta, dias: diasPeriodo },
                kpis: {
                    ingresos_totales: r.ingresos_totales,
                    total_pedidos: r.total_pedidos,
                    clientes_atendidos: r.clientes_atendidos,
                    vendedores_activos: r.vendedores_activos,
                    unidades_totales: r.unidades_totales,
                    ticket_promedio: r.ticket_promedio,
                    pedidos_por_dia: (parseInt(r.total_pedidos) / diasPeriodo).toFixed(1),
                    tasa_entrega: totalConTodos > 0
                        ? ((parseInt(entregados?.total_pedidos || 0) / totalConTodos) * 100).toFixed(1)
                        : '0.0',
                    tasa_cancelacion: totalConTodos > 0
                        ? ((parseInt(cancelados?.total_pedidos || 0) / totalConTodos) * 100).toFixed(1)
                        : '0.0',
                },
                por_estado: porEstado.rows,
                por_dia: porDia.rows,
            });
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error en resumen ejecutivo:', error);
        next(error);
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reportes/diario-pedidos  (mantenido por compatibilidad)
// ─────────────────────────────────────────────────────────────────────────────
const getReporteDiarioPedidos = async (req, res, next) => {
    const { startDate, endDate } = req.query;
    const desde = startDate || new Date().toISOString().slice(0, 10);
    const hasta = endDate   || new Date().toISOString().slice(0, 10);

    const { conditions, params } = buildDateFilter(desde, hasta, 'p.fecha_creacion', 1);
    conditions.push(`p.estado != 'archivado'`);
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
        const client = await pool.connect();
        try {
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
// ─────────────────────────────────────────────────────────────────────────────
const getReportePedidosPorVendedor = async (req, res, next) => {
    const { startDate, endDate } = req.query;
    const { conditions, params } = buildDateFilter(startDate, endDate, 'p.fecha_creacion', 1);

    const baseWhere = `p.estado NOT IN ${ESTADOS_EXCLUIDOS}`;
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
                , 2)                                                     AS ticket_promedio,
                COUNT(DISTINCT CASE WHEN p.estado = 'entregado' THEN p.id END) AS pedidos_entregados
            FROM pedidos p
            JOIN usuarios u ON u.id = p.usuario_id
            LEFT JOIN pedido_items pi ON pi.pedido_id = p.id
            ${whereClause}
            GROUP BY u.id, u.nombre
            ORDER BY monto_total DESC
        `, params);

        // Calcular tasa de entrega por vendedor
        const vendedoresConTasa = rows.map(v => ({
            ...v,
            tasa_entrega: parseInt(v.total_pedidos) > 0
                ? ((parseInt(v.pedidos_entregados) / parseInt(v.total_pedidos)) * 100).toFixed(1)
                : '0.0'
        }));

        res.status(200).json({
            periodo: { startDate: startDate || null, endDate: endDate || null },
            vendedores: vendedoresConTasa,
        });
    } catch (error) {
        console.error('Error en reporte por vendedor:', error);
        next(error);
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reportes/pedidos-entregados
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
                AND p.estado NOT IN ${ESTADOS_EXCLUIDOS}
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
// ─────────────────────────────────────────────────────────────────────────────
const getReporteProductosMasPedidos = async (req, res, next) => {
    const { startDate, endDate, orderBy = 'cantidad', categoria } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const { conditions, params } = buildDateFilter(startDate, endDate, 'p.fecha_creacion', 1);
    let baseCondition = `p.estado NOT IN ${ESTADOS_EXCLUIDOS}`;
    if (categoria) {
        params.push(categoria);
        baseCondition += ` AND pr.categoria = $${params.length}`;
    }

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

        // Calcular % del total
        const montoGlobal = rows.reduce((acc, r) => acc + parseFloat(r.monto_total), 0);
        const productosConPct = rows.map(p => ({
            ...p,
            pct_del_total: montoGlobal > 0
                ? ((parseFloat(p.monto_total) / montoGlobal) * 100).toFixed(1)
                : '0.0'
        }));

        res.status(200).json({
            periodo: { startDate: startDate || null, endDate: endDate || null },
            order_by: orderBy,
            total_productos: rows.length,
            productos: productosConPct,
        });
    } catch (error) {
        console.error('Error en reporte de productos más pedidos:', error);
        next(error);
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reportes/faltantes-historico
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

            const paramsAgrupado = conditions.length ? params.slice(0, -1) : [];
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

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reportes/categorias-comparativa
// Compara todas las categorías entre sí: monto, unidades, % del total,
// producto estrella. Reemplaza la vista "Análisis".
// Query params: startDate, endDate
// ─────────────────────────────────────────────────────────────────────────────
const getReporteCategoriasComparativa = async (req, res, next) => {
    const { startDate, endDate } = req.query;
    const { conditions, params } = buildDateFilter(startDate, endDate, 'p.fecha_creacion', 1);
    const baseCondition = `p.estado NOT IN ${ESTADOS_EXCLUIDOS}`;
    const whereClause = conditions.length
        ? `WHERE ${baseCondition} AND ${conditions.join(' AND ')}`
        : `WHERE ${baseCondition}`;

    try {
        const client = await pool.connect();
        try {
            // Resumen por categoría
            const categorias = await client.query(`
                SELECT
                    COALESCE(pr.categoria, 'Sin Categoría')                 AS categoria,
                    COALESCE(SUM(pi.cantidad * pi.precio_congelado), 0)     AS monto_total,
                    COALESCE(SUM(pi.cantidad), 0)                           AS unidades_vendidas,
                    COUNT(DISTINCT pi.producto_id)                          AS productos_activos,
                    COUNT(DISTINCT pi.pedido_id)                            AS aparece_en_pedidos
                FROM pedido_items pi
                JOIN pedidos p   ON p.id = pi.pedido_id
                LEFT JOIN productos pr ON pr.id = pi.producto_id
                ${whereClause}
                GROUP BY pr.categoria
                ORDER BY monto_total DESC
            `, params);

            // Producto estrella por categoría
            const estrellas = await client.query(`
                SELECT DISTINCT ON (cat)
                    cat, nombre_producto, monto
                FROM (
                    SELECT
                        COALESCE(pr.categoria, 'Sin Categoría') AS cat,
                        pi.nombre_producto,
                        COALESCE(SUM(pi.cantidad * pi.precio_congelado), 0) AS monto
                    FROM pedido_items pi
                    JOIN pedidos p ON p.id = pi.pedido_id
                    LEFT JOIN productos pr ON pr.id = pi.producto_id
                    ${whereClause}
                    GROUP BY pr.categoria, pi.nombre_producto
                ) sub
                ORDER BY cat, monto DESC
            `, params);

            // Calcular % del total
            const montoGlobal = categorias.rows.reduce((acc, c) => acc + parseFloat(c.monto_total), 0);
            const estrellasMap = {};
            estrellas.rows.forEach(e => { estrellasMap[e.cat] = e.nombre_producto; });

            const resultado = categorias.rows.map(c => ({
                ...c,
                pct_del_total: montoGlobal > 0
                    ? ((parseFloat(c.monto_total) / montoGlobal) * 100).toFixed(1)
                    : '0.0',
                producto_estrella: estrellasMap[c.categoria] || '-',
            }));

            res.status(200).json({
                periodo: { startDate: startDate || null, endDate: endDate || null },
                monto_global: montoGlobal,
                total_categorias: resultado.length,
                categorias: resultado,
            });
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error en comparativa de categorías:', error);
        next(error);
    }
};

module.exports = {
    getReporteFaltantes,
    getReporteDiarioPedidos,
    getReporteResumenEjecutivo,
    getReportePedidosPorVendedor,
    getReportePedidosEntregados,
    getReporteClientesInactivos,
    getReporteProductosMasPedidos,
    getReporteFaltantesHistorico,
    getReporteCategoriasComparativa,
};
