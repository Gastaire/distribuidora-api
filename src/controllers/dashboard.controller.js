const { pool } = require('../db');

const getDashboardStats = async (req, res) => {
    const { startDate, endDate, topProductsLimit = 10, source = 'pedidos' } = req.query;
    const client = await pool.connect();

    try {
        let stats = {};

        // ── Armar filtro de fechas ────────────────────────────────────────────
        let dateFilter = '';
        const dateParams = [];
        let paramCount = 1;

        if (startDate) {
            dateFilter += ` AND p.fecha_creacion >= $${paramCount++}`;
            dateParams.push(startDate);
        } else {
            dateFilter += ` AND p.fecha_creacion >= NOW() - INTERVAL '30 days'`;
        }
        if (endDate) {
            dateFilter += ` AND p.fecha_creacion <= $${paramCount++}::date + interval '1 day' - interval '1 second'`;
            dateParams.push(endDate);
        }

        // ─────────────────────────────────────────────────────────────────────
        // FUENTE: pedidos (app)
        // ─────────────────────────────────────────────────────────────────────
        if (source === 'pedidos') {

            const totalQuery = `
                SELECT
                    COALESCE(SUM(pi.cantidad * pi.precio_congelado), 0) AS "totalRevenue",
                    COUNT(DISTINCT p.id)                                 AS "totalOrders",
                    COALESCE(SUM(pi.cantidad), 0)                        AS "unidadesVendidas"
                FROM pedidos p
                JOIN pedido_items pi ON p.id = pi.pedido_id
                WHERE p.estado NOT IN ('cancelado', 'archivado') ${dateFilter}`;

            const topProductsQuery = `
                SELECT
                    pi.nombre_producto                                      AS nombre,
                    SUM(pi.cantidad)                                        AS "totalQuantity",
                    COALESCE(SUM(pi.cantidad * pi.precio_congelado), 0)    AS "totalRevenue"
                FROM pedido_items pi
                JOIN pedidos p ON pi.pedido_id = p.id
                WHERE p.estado NOT IN ('cancelado', 'archivado') ${dateFilter}
                GROUP BY pi.nombre_producto
                ORDER BY "totalQuantity" DESC
                LIMIT $${paramCount}`;

            // Faltantes: filtro separado sobre registro_faltantes
            let faltDateFilter = '';
            const faltParams = [];
            let faltParamCount = 1;
            if (startDate) {
                faltDateFilter += ` AND rf.fecha_registro >= $${faltParamCount++}`;
                faltParams.push(startDate);
            } else {
                faltDateFilter += ` AND rf.fecha_registro >= NOW() - INTERVAL '30 days'`;
            }
            if (endDate) {
                faltDateFilter += ` AND rf.fecha_registro <= $${faltParamCount++}::date + interval '1 day' - interval '1 second'`;
                faltParams.push(endDate);
            }
            faltParams.push(10);

            const topFaltantesQuery = `
                SELECT
                    rf.nombre_producto                  AS nombre,
                    SUM(rf.cantidad_original)           AS "totalFaltante",
                    COUNT(DISTINCT rf.pedido_id)        AS "vecesRemovido"
                FROM registro_faltantes rf
                WHERE 1=1 ${faltDateFilter}
                GROUP BY rf.nombre_producto
                ORDER BY "totalFaltante" DESC
                LIMIT $${faltParamCount}`;

            const lostSalesQuery = `
                SELECT
                    COALESCE(SUM(rf.cantidad_original * p_prod.precio_unitario), 0) AS "lostRevenue",
                    COALESCE(SUM(rf.cantidad_original), 0)                           AS "lostUnits"
                FROM registro_faltantes rf
                LEFT JOIN productos p_prod ON rf.nombre_producto = p_prod.nombre
                JOIN pedidos p ON rf.pedido_id = p.id
                WHERE 1=1 ${dateFilter}`;

            const customersQuery = `
                SELECT COUNT(DISTINCT cliente_id) AS "activeCustomers"
                FROM pedidos p
                WHERE p.estado NOT IN ('cancelado', 'archivado') ${dateFilter}`;

            const totalCustomersQuery = `SELECT COUNT(*) AS "totalCustomers" FROM clientes`;

            const pendientesQuery = `
                SELECT COUNT(*) AS count
                FROM pedidos
                WHERE estado = 'pendiente'
                  AND fecha_creacion >= NOW() - INTERVAL '7 days'`;

            const facturados12hQuery = `
                SELECT COUNT(*) AS count
                FROM pedidos
                WHERE estado = 'facturado'
                  AND fecha_creacion >= NOW() - INTERVAL '12 hours'`;

            const evolucionSemanalQuery = `
                SELECT
                    DATE(p.fecha_creacion) as dia,
                    COALESCE(SUM(pi.cantidad * pi.precio_congelado), 0) as ingresos
                FROM pedidos p
                JOIN pedido_items pi ON p.id = pi.pedido_id
                WHERE p.estado NOT IN ('cancelado', 'archivado')
                  AND p.fecha_creacion >= NOW() - INTERVAL '14 days'
                GROUP BY DATE(p.fecha_creacion)
                ORDER BY dia ASC`;

            const anioAnteriorSemanalQuery = `
                SELECT
                    EXTRACT(DOW FROM p.fecha_creacion) as dow,
                    COALESCE(SUM(pi.cantidad * pi.precio_congelado), 0) as ingresos
                FROM pedidos p
                JOIN pedido_items pi ON p.id = pi.pedido_id
                WHERE p.estado NOT IN ('cancelado', 'archivado')
                  AND p.fecha_creacion >= NOW() - INTERVAL '1 year' - INTERVAL '7 days'
                  AND p.fecha_creacion <= NOW() - INTERVAL '1 year' + INTERVAL '7 days'
                GROUP BY EXTRACT(DOW FROM p.fecha_creacion)
                ORDER BY dow ASC`;

            const [total, products, topFaltantes, lost, activeCust, totalCust, pendientesResult, facturados12hResult, evolucionResult, anioAnteriorResult] = await Promise.all([
                client.query(totalQuery, dateParams),
                client.query(topProductsQuery, [...dateParams, topProductsLimit]),
                client.query(topFaltantesQuery, faltParams),
                client.query(lostSalesQuery, dateParams),
                client.query(customersQuery, dateParams),
                client.query(totalCustomersQuery),
                client.query(pendientesQuery),
                client.query(facturados12hQuery),
                client.query(evolucionSemanalQuery),
                client.query(anioAnteriorSemanalQuery),
            ]);

            stats = {
                totalRevenue:           total.rows[0]?.totalRevenue,
                totalOrders:            total.rows[0]?.totalOrders,
                unidadesVendidas:       total.rows[0]?.unidadesVendidas,
                topProducts:            products.rows,
                topFaltantes:           topFaltantes.rows,
                lostRevenue:            lost.rows[0]?.lostRevenue,
                lostUnits:              lost.rows[0]?.lostUnits,
                activeCustomers:        activeCust.rows[0]?.activeCustomers,
                totalCustomers:         totalCust.rows[0]?.totalCustomers,
                pedidos_pendientes:     pendientesResult.rows[0]?.count || 0,
                facturados_12h:         facturados12hResult.rows[0]?.count || 0,
                evolucion_semanal:      evolucionResult.rows,
                anio_anterior_semanal:  anioAnteriorResult.rows,
            };

        // ─────────────────────────────────────────────────────────────────────
        // FUENTE: presencial
        // ─────────────────────────────────────────────────────────────────────
        } else {
            let vpDateFilter = '';
            const vpParams = [];
            let vpParamCount = 1;

            if (startDate) {
                vpDateFilter += ` AND vpc.fecha_venta >= $${vpParamCount++}`;
                vpParams.push(startDate);
            } else {
                vpDateFilter += ` AND vpc.fecha_venta >= NOW() - INTERVAL '30 days'`;
            }
            if (endDate) {
                vpDateFilter += ` AND vpc.fecha_venta <= $${vpParamCount++}::date + interval '1 day' - interval '1 second'`;
                vpParams.push(endDate);
            }

            const totalQuery = `
                SELECT
                    COALESCE(SUM(vpi.cantidad * vpi.precio_final_unitario), 0) AS "totalRevenue",
                    COUNT(DISTINCT vpc.id)                                       AS "totalOrders",
                    COALESCE(SUM(vpi.cantidad), 0)                              AS "unidadesVendidas"
                FROM ventas_presenciales_comprobantes vpc
                JOIN ventas_presenciales_items vpi ON vpc.id = vpi.comprobante_id
                WHERE 1=1 ${vpDateFilter}`;

            const topProductsQuery = `
                SELECT
                    vpi.nombre_producto                                          AS nombre,
                    SUM(vpi.cantidad)                                            AS "totalQuantity",
                    COALESCE(SUM(vpi.cantidad * vpi.precio_final_unitario), 0)  AS "totalRevenue"
                FROM ventas_presenciales_items vpi
                JOIN ventas_presenciales_comprobantes vpc ON vpi.comprobante_id = vpc.id
                WHERE 1=1 ${vpDateFilter}
                GROUP BY vpi.nombre_producto
                ORDER BY "totalQuantity" DESC
                LIMIT $${vpParamCount}`;

            const [total, products] = await Promise.all([
                client.query(totalQuery, vpParams),
                client.query(topProductsQuery, [...vpParams, topProductsLimit]),
            ]);

            stats = {
                totalRevenue:     total.rows[0]?.totalRevenue,
                totalOrders:      total.rows[0]?.totalOrders,
                unidadesVendidas: total.rows[0]?.unidadesVendidas,
                topProducts:      products.rows,
                topFaltantes:     [],
                lostRevenue:      0,
                lostUnits:        0,
                activeCustomers:  0,
                totalCustomers:   0,
            };
        }

        res.status(200).json(stats);

    } catch (error) {
        console.error(`Error en dashboard (source: ${source}):`, error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    } finally {
        if (client) client.release();
    }
};

module.exports = { getDashboardStats };
