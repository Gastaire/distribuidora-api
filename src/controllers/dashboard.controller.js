const { pool } = require('../db');

const getDashboardStats = async (req, res) => {
    try {
        // 1. Métricas Generales (Ventas totales, pedidos totales)
        const totalSalesQuery = `
            SELECT SUM(pi.cantidad * pi.precio_congelado) AS "totalRevenue", COUNT(DISTINCT p.id) AS "totalOrders"
            FROM pedidos p
            JOIN pedido_items pi ON p.id = pi.pedido_id
            WHERE p.estado NOT IN ('cancelado')
        `;
        const totalSalesResult = await pool.query(totalSalesQuery);

        // 2. Ventas en los últimos 7 días (para el gráfico de líneas)
        const salesByDayQuery = `
            SELECT 
                DATE(p.fecha_creacion) AS "saleDate", 
                SUM(pi.cantidad * pi.precio_congelado) AS "dailyRevenue"
            FROM pedidos p
            JOIN pedido_items pi ON p.id = pi.pedido_id
            WHERE p.fecha_creacion >= NOW() - INTERVAL '7 days' AND p.estado NOT IN ('cancelado')
            GROUP BY DATE(p.fecha_creacion)
            ORDER BY "saleDate" ASC
        `;
        const salesByDayResult = await pool.query(salesByDayQuery);

        // 3. Top 5 Productos más vendidos (por cantidad)
        const topProductsQuery = `
            SELECT pr.nombre, SUM(pi.cantidad) AS "totalQuantity"
            FROM pedido_items pi
            JOIN productos pr ON pi.producto_id = pr.id
            GROUP BY pr.nombre
            ORDER BY "totalQuantity" DESC
            LIMIT 5
        `;
        const topProductsResult = await pool.query(topProductsQuery);
        
        // 4. Pedidos recientes (para la tabla)
        const recentOrdersQuery = `
            SELECT p.id, c.nombre_comercio, p.estado, p.fecha_creacion
            FROM pedidos p
            JOIN clientes c ON p.cliente_id = c.id
            ORDER BY p.fecha_creacion DESC
            LIMIT 5
        `;
        const recentOrdersResult = await pool.query(recentOrdersQuery);


        res.status(200).json({
            totalRevenue: totalSalesResult.rows[0].totalRevenue || 0,
            totalOrders: totalSalesResult.rows[0].totalOrders || 0,
            salesByDay: salesByDayResult.rows,
            topProducts: topProductsResult.rows,
            recentOrders: recentOrdersResult.rows
        });

    } catch (error) {
        console.error('Error al obtener estadísticas del dashboard:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
};

module.exports = {
    getDashboardStats,
};
