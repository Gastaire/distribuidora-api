const { pool } = require('../db');

const getDashboardStats = async (req, res) => {
    const { startDate, endDate, topProductsLimit = 10, source = 'pedidos' } = req.query;
    const client = await pool.connect();

    try {
        let stats = {};

        let dateFilter = "";
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

        if (source === 'pedidos') {
            // KPIs principales: ingresos, pedidos y unidades vendidas
            const totalQuery = `
                SELECT
                    COALESCE(SUM(pi.cantidad * pi.precio_congelado), 0) AS "totalRevenue",
                    COUNT(DISTINCT p.id) AS "totalOrders",
                    COALESCE(SUM(pi.cantidad), 0) AS "unidadesVendidas"
                FROM pedidos p
                JOIN pedido_items pi ON p.id = pi.pedido_id
                WHERE p.estado NOT IN ('cancelado', 'archivado') ${dateFilter}`;

            // Ventas por día
            const salesByPeriodQuery = `
                SELECT
                    DATE(p.fecha_creacion) AS "saleDate",
                    SUM(pi.cantidad * pi.precio_congelado) AS "dailyRevenue"
                FROM pedidos p
                JOIN pedido_items pi ON p.id = pi.pedido_id
                WHERE p.estado NOT IN ('cancelado', 'archivado') ${dateFilter}
                GROUP BY DATE(p.fecha_creacion)
                ORDER BY "saleDate" ASC`;

            // Top N productos más vendidos por unidades
            const topProductsQuery = `
                SELECT
                    pi.nombre_producto AS nombre,
                    SUM(pi.cantidad) AS "totalQuantity",
                    COALESCE(SUM(pi.cantidad * pi.precio_congelado), 0) AS "totalRevenue"
                FROM pedido_items pi
                JOIN pedidos p ON pi.pedido_id = p.id
                WHERE p.estado NOT IN ('cancelado', 'archivado') ${dateFilter}
                GROUP BY pi.nombre_producto
                ORDER BY "totalQuantity" DESC
                LIMIT $${paramCount}`;

            // Top faltantes del período agrupados
            let faltDateFilter = "";
            let faltParams = [];
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
                    rf.nombre_producto AS nombre,
                    SUM(rf.cantidad_original) AS "totalFaltante",
                    COUNT(DISTINCT rf.pedido_id) AS "vecesRemovido"
                FROM registro_faltantes rf
                WHERE 1=1 ${faltDateFilter}
                GROUP BY rf.nombre_producto
                ORDER BY "totalFaltante" DESC
                LIMIT $${faltParamCount}`;

            // Evolución comparada: top 5 productos más vendidos, unidades por día
            const top5SubQuery = `
                SELECT pi2.nombre_producto
                FROM pedido_items pi2
                JOIN pedidos p2 ON pi2.pedido_id = p2.id
                WHERE p2.estado NOT IN ('cancelado', 'archivado') ${dateFilter}
                GROUP BY pi2.nombre_producto
                ORDER BY SUM(pi2.cantidad) DESC
                LIMIT 5`;

            const evolutionQuery = `
                SELECT
                    DATE(p.fecha_creacion) AS "fecha",
                    pi.nombre_producto AS "producto",
                    SUM(pi.cantidad) AS "cantidad"
                FROM pedido_items pi
                JOIN pedidos p ON pi.pedido_id = p.id
                WHERE p.estado NOT IN ('cancelado', 'archivado') ${dateFilter}
                  AND pi.nombre_producto IN (${top5SubQuery})
                GROUP BY DATE(p.fecha_creacion), pi.nombre_producto
                ORDER BY "fecha" ASC, "producto" ASC`;

            // Ventas perdidas por faltantes
            const lostSalesQuery = `
                SELECT
                    COALESCE(SUM(rf.cantidad_original * p_prod.precio_unitario), 0) AS "lostRevenue",
                    COALESCE(SUM(rf.cantidad_original), 0) AS "lostUnits"
                FROM registro_faltantes rf
                LEFT JOIN productos p_prod ON rf.nombre_producto = p_prod.nombre
                JOIN pedidos p ON rf.pedido_id = p.id
                WHERE 1=1 ${dateFilter}`;

            const customersQuery = `
                SELECT COUNT(DISTINCT cliente_id) AS "activeCustomers"
                FROM pedidos p
                WHERE p.estado NOT IN ('cancelado', 'archivado') ${dateFilter}`;

            const totalCustomersQuery = `SELECT COUNT(*) AS "totalCustomers" FROM clientes`;

            let evolutionData = { fechas: [], series: [] };
            let evolutionRows = [];
            try {
                const evolutionResult = await client.query(evolutionQuery, dateParams);
                evolutionRows = evolutionResult.rows;
            } catch (evoErr) {
                console.error('Error en query de evolución (no crítico):', evoErr.message);
            }

            const [total, period, products, topFaltantes, lost, activeCust, totalCust] = await Promise.all([
                client.query(totalQuery, dateParams),
                client.query(salesByPeriodQuery, dateParams),
                client.query(topProductsQuery, [...dateParams, topProductsLimit]),
                client.query(topFaltantesQuery, faltParams),
                client.query(lostSalesQuery, dateParams),
                client.query(customersQuery, dateParams),
                client.query(totalCustomersQuery),
            ]);

            // Transformar datos de evolución en estructura { fechas, series }
            const allFechas = [...new Set(evolutionRows.map(r => r.fecha))].sort();
            const allProductos = [...new Set(evolutionRows.map(r => r.producto))];
            const seriesMap = {};
            evolutionRows.forEach(r => {
                if (!seriesMap[r.producto]) seriesMap[r.producto] = {};
                seriesMap[r.producto][r.fecha] = parseFloat(r.cantidad);
            });
            evolutionData = {
                fechas: allFechas,
                series: allProductos.map(prod => ({
                    producto: prod,
                    datos: allFechas.map(f => seriesMap[prod]?.[f] || 0),
                })),
            };

            stats = {
                totalRevenue: total.rows[0]?.totalRevenue,
                totalOrders: total.rows[0]?.totalOrders,
                unidadesVendidas: total.rows[0]?.unidadesVendidas,
                salesByDay: period.rows,
                topProducts: products.rows,
                topFaltantes: topFaltantes.rows,
                topProductsEvolution: evolutionData,
                lostRevenue: lost.rows[0]?.lostRevenue,
                lostUnits: lost.rows[0]?.lostUnits,
                activeCustomers: activeCust.rows[0]?.activeCustomers,
                totalCustomers: totalCust.rows[0]?.totalCustomers,
            };

        } else {
            // --- Ventas Presenciales ---
            let vpDateFilter = "";
            let vpParams = [];
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
                    COUNT(DISTINCT vpc.id) AS "totalOrders",
                    COALESCE(SUM(vpi.cantidad), 0) AS "unidadesVendidas"
                FROM ventas_presenciales_comprobantes vpc
                JOIN ventas_presenciales_items vpi ON vpc.id = vpi.comprobante_id
                WHERE 1=1 ${vpDateFilter}`;

            const salesByPeriodQuery = `
                SELECT
                    DATE(vpc.fecha_venta) AS "saleDate",
                    SUM(vpi.cantidad * vpi.precio_final_unitario) AS "dailyRevenue"
                FROM ventas_presenciales_comprobantes vpc
                JOIN ventas_presenciales_items vpi ON vpc.id = vpi.comprobante_id
                WHERE 1=1 ${vpDateFilter}
                GROUP BY DATE(vpc.fecha_venta)
                ORDER BY "saleDate" ASC`;

            const topProductsQuery = `
                SELECT
                    vpi.nombre_producto AS nombre,
                    SUM(vpi.cantidad) AS "totalQuantity",
                    COALESCE(SUM(vpi.cantidad * vpi.precio_final_unitario), 0) AS "totalRevenue"
                FROM ventas_presenciales_items vpi
                JOIN ventas_presenciales_comprobantes vpc ON vpi.comprobante_id = vpc.id
                WHERE 1=1 ${vpDateFilter}
                GROUP BY vpi.nombre_producto
                ORDER BY "totalQuantity" DESC
                LIMIT $${vpParamCount}`;

            // Evolución comparada para ventas presenciales
            const top5SubQueryVP = `
                SELECT vpi2.nombre_producto
                FROM ventas_presenciales_items vpi2
                JOIN ventas_presenciales_comprobantes vpc2 ON vpi2.comprobante_id = vpc2.id
                WHERE 1=1 ${vpDateFilter}
                GROUP BY vpi2.nombre_producto
                ORDER BY SUM(vpi2.cantidad) DESC
                LIMIT 5`;

            const evolutionQueryVP = `
                SELECT
                    DATE(vpc.fecha_venta) AS "fecha",
                    vpi.nombre_producto AS "producto",
                    SUM(vpi.cantidad) AS "cantidad"
                FROM ventas_presenciales_items vpi
                JOIN ventas_presenciales_comprobantes vpc ON vpi.comprobante_id = vpc.id
                WHERE 1=1 ${vpDateFilter}
                  AND vpi.nombre_producto IN (${top5SubQueryVP})
                GROUP BY DATE(vpc.fecha_venta), vpi.nombre_producto
                ORDER BY "fecha" ASC, "producto" ASC`;

            const [total, period, products, evolutionVP] = await Promise.all([
                client.query(totalQuery, vpParams),
                client.query(salesByPeriodQuery, vpParams),
                client.query(topProductsQuery, [...vpParams, topProductsLimit]),
                client.query(evolutionQueryVP, vpParams),
            ]);

            const allFechas = [...new Set(evolutionVP.rows.map(r => r.fecha))].sort();
            const allProductos = [...new Set(evolutionVP.rows.map(r => r.producto))];
            const seriesMap = {};
            evolutionVP.rows.forEach(r => {
                if (!seriesMap[r.producto]) seriesMap[r.producto] = {};
                seriesMap[r.producto][r.fecha] = parseFloat(r.cantidad);
            });
            const evolutionData = {
                fechas: allFechas,
                series: allProductos.map(prod => ({
                    producto: prod,
                    datos: allFechas.map(f => seriesMap[prod]?.[f] || 0),
                })),
            };

            stats = {
                totalRevenue: total.rows[0]?.totalRevenue,
                totalOrders: total.rows[0]?.totalOrders,
                unidadesVendidas: total.rows[0]?.unidadesVendidas,
                salesByDay: period.rows,
                topProducts: products.rows,
                topFaltantes: [],
                topProductsEvolution: evolutionData,
                lostRevenue: 0,
                lostUnits: 0,
                activeCustomers: 0,
                totalCustomers: 0,
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
