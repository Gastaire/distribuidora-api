const { pool } = require('../db');

const getDashboardStats = async (req, res) => {
    const { startDate, endDate, topProductsLimit = 5, source = 'pedidos' } = req.query;
    const client = await pool.connect();

    try {
        let stats = {};
        
        const desde = startDate ? `AND p.fecha_creacion >= $1` : `AND p.fecha_creacion >= NOW() - INTERVAL '7 days'`;
        const hasta = endDate ? `AND p.fecha_creacion <= $2::date + interval '1 day' - interval '1 second'` : ``;
        const dateParams = [];
        let paramCount = 1;
        
        let dateFilter = "";
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
            const totalQuery = `SELECT COALESCE(SUM(pi.cantidad * pi.precio_congelado), 0) AS "totalRevenue", COUNT(DISTINCT p.id) AS "totalOrders" FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id WHERE p.estado NOT IN ('cancelado', 'archivado') ${dateFilter}`;
            
            const salesByPeriodQuery = `SELECT DATE(p.fecha_creacion) AS "saleDate", SUM(pi.cantidad * pi.precio_congelado) AS "dailyRevenue" FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id WHERE p.estado NOT IN ('cancelado', 'archivado') ${dateFilter} GROUP BY DATE(p.fecha_creacion) ORDER BY "saleDate" ASC`;

            const topProductsQuery = `SELECT pi.nombre_producto as nombre, SUM(pi.cantidad) AS "totalQuantity" FROM pedido_items pi JOIN pedidos p ON pi.pedido_id = p.id WHERE p.estado NOT IN ('cancelado', 'archivado') ${dateFilter} GROUP BY pi.nombre_producto ORDER BY "totalQuantity" DESC LIMIT $${paramCount}`;
            
            const lostSalesQuery = `SELECT COALESCE(SUM(rf.cantidad_original * p_prod.precio_base), 0) AS "lostRevenue", COALESCE(SUM(rf.cantidad_original), 0) AS "lostUnits" FROM registro_faltantes rf JOIN productos p_prod ON rf.nombre_producto = p_prod.nombre JOIN pedidos p ON rf.pedido_id = p.id WHERE 1=1 ${dateFilter}`;
            
            const customersQuery = `SELECT COUNT(DISTINCT cliente_id) as "activeCustomers" FROM pedidos p WHERE p.estado NOT IN ('cancelado', 'archivado') ${dateFilter}`;
            
            const totalCustomersQuery = `SELECT COUNT(*) as "totalCustomers" FROM clientes`;

            const [total, period, products, lost, activeCust, totalCust] = await Promise.all([
                client.query(totalQuery, dateParams), 
                client.query(salesByPeriodQuery, dateParams), 
                client.query(topProductsQuery, [...dateParams, topProductsLimit]),
                client.query(lostSalesQuery, dateParams),
                client.query(customersQuery, dateParams),
                client.query(totalCustomersQuery)
            ]);

            stats = { 
                totalRevenue: total.rows[0]?.totalRevenue, 
                totalOrders: total.rows[0]?.totalOrders, 
                salesByDay: period.rows, 
                topProducts: products.rows,
                lostRevenue: lost.rows[0]?.lostRevenue,
                lostUnits: lost.rows[0]?.lostUnits,
                activeCustomers: activeCust.rows[0]?.activeCustomers,
                totalCustomers: totalCust.rows[0]?.totalCustomers
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

            const totalQuery = `SELECT COALESCE(SUM(vpi.cantidad * vpi.precio_final_unitario), 0) AS "totalRevenue", COUNT(DISTINCT vpc.id) AS "totalOrders" FROM ventas_presenciales_comprobantes vpc JOIN ventas_presenciales_items vpi ON vpc.id = vpi.comprobante_id WHERE 1=1 ${vpDateFilter}`;
            
            const salesByPeriodQuery = `SELECT DATE(vpc.fecha_venta) AS "saleDate", SUM(vpi.cantidad * vpi.precio_final_unitario) AS "dailyRevenue" FROM ventas_presenciales_comprobantes vpc JOIN ventas_presenciales_items vpi ON vpc.id = vpi.comprobante_id WHERE 1=1 ${vpDateFilter} GROUP BY DATE(vpc.fecha_venta) ORDER BY "saleDate" ASC`;

            const topProductsQuery = `SELECT vpi.nombre_producto as nombre, SUM(vpi.cantidad) AS "totalQuantity" FROM ventas_presenciales_items vpi JOIN ventas_presenciales_comprobantes vpc ON vpi.comprobante_id = vpc.id WHERE 1=1 ${vpDateFilter} GROUP BY vpi.nombre_producto ORDER BY "totalQuantity" DESC LIMIT $${vpParamCount}`;
            
            const [total, period, products] = await Promise.all([
                client.query(totalQuery, vpParams), 
                client.query(salesByPeriodQuery, vpParams), 
                client.query(topProductsQuery, [...vpParams, topProductsLimit])
            ]);

            stats = { totalRevenue: total.rows[0]?.totalRevenue, totalOrders: total.rows[0]?.totalOrders, salesByDay: period.rows, topProducts: products.rows, lostRevenue: 0, lostUnits: 0, activeCustomers: 0, totalCustomers: 0 };
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
