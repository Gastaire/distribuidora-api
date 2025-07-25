const { pool } = require('../db');

const getDashboardStats = async (req, res) => {
    const { source = 'pedidos', salesPeriod = '7d', topProductsLimit = 5 } = req.query;
    const limit = parseInt(topProductsLimit, 10) || 5;

    let dateFilter = '';
    if (salesPeriod === '7d') {
        dateFilter = `AND fecha_creacion >= CURDATE() - INTERVAL 7 DAY`;
    } else if (salesPeriod === '30d') {
        dateFilter = `AND fecha_creacion >= CURDATE() - INTERVAL 30 DAY`;
    }

    const isPresencial = source === 'presencial';
    const table = isPresencial ? 'ventas_presenciales' : 'pedidos';
    const itemsTable = isPresencial ? 'ventas_presenciales_items' : 'pedido_items';
    const priceColumn = isPresencial ? 'precio_unitario' : 'precio_congelado';
    const dateColumn = isPresencial ? 'fecha_venta' : 'fecha_creacion';

    try {
        // --- Consultas existentes ---
        const totalRevenueQuery = `SELECT SUM(total) as totalRevenue FROM ${table} WHERE estado != 'cancelado'`;
        const totalOrdersQuery = `SELECT COUNT(id) as totalOrders FROM ${table} WHERE estado != 'cancelado'`;
        
        let salesByDayQuery;
        if (salesPeriod === 'monthly') {
            salesByDayQuery = `
                SELECT DATE_FORMAT(${dateColumn}, '%Y-%m') as saleMonth, SUM(total) as monthlyRevenue 
                FROM ${table} 
                WHERE estado != 'cancelado' 
                GROUP BY saleMonth 
                ORDER BY saleMonth ASC`;
        } else {
            salesByDayQuery = `
                SELECT DATE(${dateColumn}) as saleDate, SUM(total) as dailyRevenue 
                FROM ${table} 
                WHERE estado != 'cancelado' ${dateFilter.replace('fecha_creacion', dateColumn)} 
                GROUP BY saleDate 
                ORDER BY saleDate ASC`;
        }

        const topProductsQuery = `
            SELECT p.nombre, SUM(pi.cantidad) AS totalQuantity
            FROM ${itemsTable} pi
            JOIN productos p ON pi.producto_id = p.id
            JOIN ${table} pe ON pi.${isPresencial ? 'venta_id' : 'pedido_id'} = pe.id
            WHERE pe.estado != 'cancelado'
            GROUP BY p.nombre
            ORDER BY totalQuantity DESC
            LIMIT ?`;

        // --- NUEVA CONSULTA: Top Productos por Ingresos ---
        const topProductsByRevenueQuery = `
            SELECT p.nombre, SUM(pi.cantidad * pi.${priceColumn}) AS totalRevenue
            FROM ${itemsTable} pi
            JOIN productos p ON pi.producto_id = p.id
            JOIN ${table} pe ON pi.${isPresencial ? 'venta_id' : 'pedido_id'} = pe.id
            WHERE pe.estado != 'cancelado'
            GROUP BY p.nombre
            ORDER BY totalRevenue DESC
            LIMIT ?`;

        const topCustomersQuery = `
            SELECT c.nombre_comercio, SUM(p.total) as totalSpent 
            FROM pedidos p 
            JOIN clientes c ON p.cliente_id = c.id 
            WHERE p.estado != 'cancelado' 
            GROUP BY c.nombre_comercio 
            ORDER BY totalSpent DESC 
            LIMIT 5`;

        const salesBySellerQuery = `
            SELECT u.nombre, COUNT(p.id) as orderCount, SUM(p.total) as totalSold 
            FROM pedidos p 
            JOIN usuarios u ON p.vendedor_id = u.id 
            WHERE p.estado != 'cancelado' 
            GROUP BY u.nombre 
            ORDER BY totalSold DESC`;

        // --- Ejecución de todas las consultas ---
        const [
            [revenueResult], 
            [ordersResult], 
            [salesByDay], 
            [topProducts],
            [topProductsByRevenue], // Nueva variable para el resultado
            [topCustomers], 
            [salesBySeller]
        ] = await Promise.all([
            pool.query(totalRevenueQuery),
            pool.query(totalOrdersQuery),
            pool.query(salesByDayQuery),
            pool.query(topProductsQuery, [limit]),
            pool.query(topProductsByRevenueQuery, [limit]), // Ejecución de la nueva consulta
            source === 'pedidos' ? pool.query(topCustomersQuery) : Promise.resolve([[]]),
            source === 'pedidos' ? pool.query(salesBySellerQuery) : Promise.resolve([[]])
        ]);

        res.json({
            totalRevenue: revenueResult.totalRevenue || 0,
            totalOrders: ordersResult.totalOrders || 0,
            salesByDay,
            topProducts,
            topProductsByRevenue, // Añadir el nuevo dato a la respuesta
            topCustomers: source === 'pedidos' ? topCustomers : [],
            salesBySeller: source === 'pedidos' ? salesBySeller : []
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error al obtener las estadísticas del dashboard' });
    }
};

module.exports = { getDashboardStats };
