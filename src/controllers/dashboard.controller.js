const { pool } = require('../db');

const getDashboardStats = async (req, res) => {
    try {
        const { source = 'pedidos', salesPeriod = '7d', topProductsLimit = 5 } = req.query;
        const limit = parseInt(topProductsLimit, 10) || 5;

        // --- Definición de variables según el origen de datos ---
        const isPresencial = source === 'presencial';
        const table = isPresencial ? 'ventas_presenciales' : 'pedidos';
        const itemsTable = isPresencial ? 'ventas_presenciales_items' : 'pedido_items';
        const priceColumn = isPresencial ? 'precio_unitario' : 'precio_congelado';
        const dateColumn = isPresencial ? 'fecha_venta' : 'fecha_creacion';
        const linkColumn = isPresencial ? 'venta_id' : 'pedido_id';

        // --- Lógica de filtros de fecha robusta ---
        let mainWhereClause = `WHERE p.estado != 'cancelado'`;
        let itemsWhereClause = `WHERE pe.estado != 'cancelado'`;

        if (salesPeriod === '7d') {
            const filter = ` AND p.${dateColumn} >= CURDATE() - INTERVAL 7 DAY`;
            mainWhereClause += filter;
            itemsWhereClause += ` AND pe.${dateColumn} >= CURDATE() - INTERVAL 7 DAY`;
        } else if (salesPeriod === '30d') {
            const filter = ` AND p.${dateColumn} >= CURDATE() - INTERVAL 30 DAY`;
            mainWhereClause += filter;
            itemsWhereClause += ` AND pe.${dateColumn} >= CURDATE() - INTERVAL 30 DAY`;
        }
        
        // --- Definición de todas las consultas ---
        const totalRevenueQuery = `SELECT SUM(p.total) as totalRevenue FROM ${table} p ${mainWhereClause}`;
        const totalOrdersQuery = `SELECT COUNT(p.id) as totalOrders FROM ${table} p ${mainWhereClause}`;

        let salesByDayQuery;
        if (salesPeriod === 'monthly') {
            salesByDayQuery = `
                SELECT DATE_FORMAT(p.${dateColumn}, '%Y-%m') as saleMonth, SUM(p.total) as monthlyRevenue 
                FROM ${table} p WHERE p.estado != 'cancelado' 
                GROUP BY saleMonth ORDER BY saleMonth ASC`;
        } else {
            salesByDayQuery = `
                SELECT DATE(p.${dateColumn}) as saleDate, SUM(p.total) as dailyRevenue 
                FROM ${table} p ${mainWhereClause} 
                GROUP BY saleDate ORDER BY saleDate ASC`;
        }

        const topProductsQuery = `
            SELECT pr.nombre, SUM(pi.cantidad) AS totalQuantity
            FROM ${itemsTable} pi
            JOIN productos pr ON pi.producto_id = pr.id
            JOIN ${table} pe ON pi.${linkColumn} = pe.id
            ${itemsWhereClause}
            GROUP BY pr.nombre ORDER BY totalQuantity DESC LIMIT ?`;

        const topProductsByRevenueQuery = `
            SELECT pr.nombre, SUM(pi.cantidad * pi.${priceColumn}) AS totalRevenue
            FROM ${itemsTable} pi
            JOIN productos pr ON pi.producto_id = pr.id
            JOIN ${table} pe ON pi.${linkColumn} = pe.id
            ${itemsWhereClause}
            GROUP BY pr.nombre ORDER BY totalRevenue DESC LIMIT ?`;

        const topCustomersQuery = `
            SELECT c.nombre_comercio, SUM(p.total) as totalSpent 
            FROM pedidos p 
            JOIN clientes c ON p.cliente_id = c.id 
            ${mainWhereClause}
            GROUP BY c.nombre_comercio ORDER BY totalSpent DESC LIMIT 5`;

        const salesBySellerQuery = `
            SELECT u.nombre, COUNT(p.id) as orderCount, SUM(p.total) as totalSold 
            FROM pedidos p 
            JOIN usuarios u ON p.vendedor_id = u.id 
            ${mainWhereClause}
            GROUP BY u.nombre ORDER BY totalSold DESC`;

        // --- Ejecución de consultas ---
        const promisePool = [
            pool.query(totalRevenueQuery),
            pool.query(totalOrdersQuery),
            pool.query(salesByDayQuery),
            pool.query(topProductsQuery, [limit]),
            pool.query(topProductsByRevenueQuery, [limit]),
        ];

        if (!isPresencial) {
            promisePool.push(pool.query(topCustomersQuery));
            promisePool.push(pool.query(salesBySellerQuery));
        }

        const results = await Promise.all(promisePool);
        const getRows = (result) => result[0];

        // --- Procesamiento de resultados ---
        const totalRevenue = getRows(results[0])[0].totalRevenue || 0;
        const totalOrders = getRows(results[1])[0].totalOrders || 0;
        const salesByDay = getRows(results[2]);
        const topProducts = getRows(results[3]);
        const topProductsByRevenue = getRows(results[4]);
        
        let topCustomers = [];
        let salesBySeller = [];
        if (!isPresencial) {
            topCustomers = getRows(results[5]);
            salesBySeller = getRows(results[6]);
        }

        // --- Envío de la respuesta ---
        res.json({
            totalRevenue,
            totalOrders,
            salesByDay,
            topProducts,
            topProductsByRevenue,
            topCustomers,
            salesBySeller,
        });

    } catch (error) {
        console.error("Error en getStats:", error);
        res.status(500).json({ message: 'Error al obtener las estadísticas del dashboard', error: error.message });
    }
};

module.exports = { getDashboardStats };
