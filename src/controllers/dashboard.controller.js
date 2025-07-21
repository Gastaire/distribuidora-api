const { pool } = require('../db');

const getDashboardStats = async (req, res) => {
    const { salesPeriod = '7d', topProductsLimit = 5 } = req.query;
    const client = await pool.connect();

    try {
        let dateFilterPedidos = "";
        let dateFilterPresenciales = "";
        
        if (salesPeriod === '7d') {
            dateFilterPedidos = `AND p.fecha_creacion >= NOW() - INTERVAL '7 days'`;
            dateFilterPresenciales = `WHERE vpc.fecha_venta >= NOW() - INTERVAL '7 days'`;
        } else if (salesPeriod === '30d') {
            dateFilterPedidos = `AND p.fecha_creacion >= NOW() - INTERVAL '30 days'`;
            dateFilterPresenciales = `WHERE vpc.fecha_venta >= NOW() - INTERVAL '30 days'`;
        }

        const totalSalesQuery = `
            SELECT COALESCE(SUM(total), 0) AS "totalRevenue", COALESCE(SUM(orders), 0) AS "totalOrders"
            FROM (
                SELECT SUM(pi.cantidad * pi.precio_congelado) as total, COUNT(DISTINCT p.id) as orders
                FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id WHERE p.estado NOT IN ('cancelado', 'archivado')
                UNION ALL
                SELECT SUM(vpi.cantidad * vpi.precio_final_unitario) as total, COUNT(DISTINCT vpc.id) as orders
                FROM ventas_presenciales_comprobantes vpc JOIN ventas_presenciales_items vpi ON vpc.id = vpi.comprobante_id
            ) as combined_sales;
        `;
        
        const topProductsQuery = `
            SELECT nombre, SUM(totalQuantity) as "totalQuantity" FROM (
                SELECT pi.nombre_producto as nombre, SUM(pi.cantidad) AS "totalQuantity"
                FROM pedido_items pi JOIN pedidos p ON pi.pedido_id = p.id WHERE p.estado NOT IN ('cancelado', 'archivado')
                GROUP BY pi.nombre_producto
                UNION ALL
                SELECT vpi.nombre_producto as nombre, SUM(vpi.cantidad) AS "totalQuantity"
                FROM ventas_presenciales_items vpi GROUP BY vpi.nombre_producto
            ) as combined_products
            WHERE nombre IS NOT NULL GROUP BY nombre ORDER BY "totalQuantity" DESC LIMIT $1
        `;

        const salesByPeriodQueryText = salesPeriod !== 'monthly' ? `
            SELECT "saleDate", SUM("dailyRevenue") as "dailyRevenue" FROM (
                SELECT DATE(p.fecha_creacion) AS "saleDate", SUM(pi.cantidad * pi.precio_congelado) AS "dailyRevenue"
                FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id
                WHERE p.estado NOT IN ('cancelado', 'archivado') ${dateFilterPedidos} GROUP BY DATE(p.fecha_creacion)
                UNION ALL
                SELECT DATE(vpc.fecha_venta) AS "saleDate", SUM(vpi.cantidad * vpi.precio_final_unitario)
                FROM ventas_presenciales_comprobantes vpc JOIN ventas_presenciales_items vpi ON vpc.id = vpi.comprobante_id
                ${dateFilterPresenciales} GROUP BY DATE(vpc.fecha_venta)
            ) as combined_sales GROUP BY "saleDate" ORDER BY "saleDate" ASC
        ` : `
            SELECT "saleMonth", SUM("monthlyRevenue") as "monthlyRevenue" FROM (
                SELECT TO_CHAR(p.fecha_creacion, 'YYYY-MM') AS "saleMonth", SUM(pi.cantidad * pi.precio_congelado) AS "monthlyRevenue"
                FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id
                WHERE p.estado NOT IN ('cancelado', 'archivado') GROUP BY "saleMonth"
                UNION ALL
                SELECT TO_CHAR(vpc.fecha_venta, 'YYYY-MM') AS "saleMonth", SUM(vpi.cantidad * vpi.precio_final_unitario)
                FROM ventas_presenciales_comprobantes vpc JOIN ventas_presenciales_items vpi ON vpc.id = vpi.comprobante_id
                GROUP BY "saleMonth"
            ) as combined_sales GROUP BY "saleMonth" ORDER BY "saleMonth" DESC LIMIT 6
        `;
        
        const topCustomersQuery = `SELECT c.nombre_comercio, SUM(pi.cantidad * pi.precio_congelado) as "totalSpent" FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id JOIN clientes c ON p.cliente_id = c.id WHERE p.estado NOT IN ('cancelado', 'archivado') GROUP BY c.nombre_comercio ORDER BY "totalSpent" DESC LIMIT 5`;
        const salesBySellerQuery = `SELECT u.nombre, COUNT(DISTINCT p.id) as "orderCount", SUM(pi.cantidad * pi.precio_congelado) as "totalSold" FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id JOIN usuarios u ON p.usuario_id = u.id WHERE p.estado NOT IN ('cancelado', 'archivado') AND u.rol = 'vendedor' GROUP BY u.nombre ORDER BY "totalSold" DESC`;

        const [
            totalSalesResult, salesByDayResult, topProductsResult, topCustomersResult, salesBySellerResult
        ] = await Promise.all([
            client.query(totalSalesQuery),
            client.query(salesByPeriodQueryText),
            client.query(topProductsQuery, [topProductsLimit]),
            client.query(topCustomersQuery),
            client.query(salesBySellerQuery)
        ]);
        
        res.status(200).json({
            totalRevenue: totalSalesResult.rows[0].totalRevenue || 0,
            totalOrders: totalSalesResult.rows[0].totalOrders || 0,
            salesByDay: salesByDayResult.rows,
            topProducts: topProductsResult.rows,
            topCustomers: topCustomersResult.rows,
            salesBySeller: salesBySellerResult.rows
        });
    } catch (error) {
        console.error('Error al obtener estadísticas del dashboard:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    } finally {
        if (client) client.release();
    }
};

module.exports = { getDashboardStats };
