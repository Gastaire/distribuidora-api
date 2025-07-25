const { pool } = require('../db');



const getDashboardStats = async (req, res) => {
    const { salesPeriod = '7d', topProductsLimit = 5, source = 'pedidos' } = req.query;
    const client = await pool.connect();
    try {
        let stats = {};
        if (source === 'pedidos') {
            // --- Lógica para Pedidos de la App ---
            let dateFilter = "";
            if (salesPeriod === '7d') dateFilter = `AND p.fecha_creacion >= NOW() - INTERVAL '7 days'`;
            if (salesPeriod === '30d') dateFilter = `AND p.fecha_creacion >= NOW() - INTERVAL '30 days'`;
            const totalQuery = `SELECT COALESCE(SUM(pi.cantidad * pi.precio_congelado), 0) AS "totalRevenue", COUNT(DISTINCT p.id) AS "totalOrders" FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id WHERE p.estado NOT IN ('cancelado', 'archivado')`;
            const salesByPeriodQuery = salesPeriod === 'monthly'
                ? `SELECT TO_CHAR(p.fecha_creacion, 'YYYY-MM') AS "saleMonth", SUM(pi.cantidad * pi.precio_congelado) AS "monthlyRevenue" FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id WHERE p.estado NOT IN ('cancelado', 'archivado') GROUP BY "saleMonth" ORDER BY "saleMonth" DESC LIMIT 6`
                : `SELECT DATE(p.fecha_creacion) AS "saleDate", SUM(pi.cantidad * pi.precio_congelado) AS "dailyRevenue" FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id WHERE p.estado NOT IN ('cancelado', 'archivado') ${dateFilter} GROUP BY DATE(p.fecha_creacion) ORDER BY "saleDate" ASC`;
            const topProductsQuery = `SELECT pi.nombre_producto as nombre, SUM(pi.cantidad) AS "totalQuantity" FROM pedido_items pi JOIN pedidos p ON pi.pedido_id = p.id WHERE p.estado NOT IN ('cancelado', 'archivado') GROUP BY pi.nombre_producto ORDER BY "totalQuantity" DESC LIMIT $1`;
            const topCustomersQuery = `SELECT c.nombre_comercio, SUM(pi.cantidad * pi.precio_congelado) as "totalSpent" FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id JOIN clientes c ON p.cliente_id = c.id WHERE p.estado NOT IN ('cancelado', 'archivado') GROUP BY c.nombre_comercio ORDER BY "totalSpent" DESC LIMIT 5`;
            const salesBySellerQuery = `SELECT u.nombre, COUNT(DISTINCT p.id) as "orderCount", SUM(pi.cantidad * pi.precio_congelado) as "totalSold" FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id JOIN usuarios u ON p.usuario_id = u.id WHERE p.estado NOT IN ('cancelado', 'archivado') AND u.rol = 'vendedor' GROUP BY u.nombre ORDER BY "totalSold" DESC`;
            const [total, period, products, customers, sellers] = await Promise.all([
                client.query(totalQuery), client.query(salesByPeriodQuery), client.query(topProductsQuery, [topProductsLimit]), client.query(topCustomersQuery), client.query(salesBySellerQuery)
            stats = { totalRevenue: total.rows[0]?.totalRevenue, totalOrders: total.rows[0]?.totalOrders, salesByDay: period.rows, topProducts: products.rows, topCustomers: customers.rows, salesBySeller: sellers.rows };
        } else {
            // --- Lógica para Ventas Presenciales ---
            let dateFilter = "";
            if (salesPeriod === '7d') dateFilter = `WHERE vpc.fecha_venta >= NOW() - INTERVAL '7 days'`;
            if (salesPeriod === '30d') dateFilter = `WHERE vpc.fecha_venta >= NOW() - INTERVAL '30 days'`;
            const totalQuery = `SELECT COALESCE(SUM(vpi.cantidad * vpi.precio_final_unitario), 0) AS "totalRevenue", COUNT(DISTINCT vpc.id) AS "totalOrders" FROM ventas_presenciales_comprobantes vpc JOIN ventas_presenciales_items vpi ON vpc.id = vpi.comprobante_id`;
            const salesByPeriodQuery = salesPeriod === 'monthly'
                ? `SELECT TO_CHAR(vpc.fecha_venta, 'YYYY-MM') AS "saleMonth", SUM(vpi.cantidad * vpi.precio_final_unitario) AS "monthlyRevenue" FROM ventas_presenciales_comprobantes vpc JOIN ventas_presenciales_items vpi ON vpc.id = vpi.comprobante_id GROUP BY "saleMonth" ORDER BY "saleMonth" DESC LIMIT 6`
                : `SELECT DATE(vpc.fecha_venta) AS "saleDate", SUM(vpi.cantidad * vpi.precio_final_unitario) AS "dailyRevenue" FROM ventas_presenciales_comprobantes vpc JOIN ventas_presenciales_items vpi ON vpc.id = vpi.comprobante_id ${dateFilter} GROUP BY DATE(vpc.fecha_venta) ORDER BY "saleDate" ASC`;
            const topProductsQuery = `SELECT vpi.nombre_producto as nombre, SUM(vpi.cantidad) AS "totalQuantity" FROM ventas_presenciales_items vpi GROUP BY vpi.nombre_producto ORDER BY "totalQuantity" DESC LIMIT $1`;
            const [total, period, products] = await Promise.all([
                client.query(totalQuery), client.query(salesByPeriodQuery), client.query(topProductsQuery, [topProductsLimit])
            ]);
            stats = { totalRevenue: total.rows[0]?.totalRevenue, totalOrders: total.rows[0]?.totalOrders, salesByDay: period.rows, topProducts: products.rows, topCustomers: [], salesBySeller: [] }; // Datos vacíos para mantener la estructura
        }
        res.status(200).json(stats);
    } catch (error) {
        console.error(`Error en dashboard (source: ${source}):`, error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    } finally {
        if (client) client.release();
    }
};
