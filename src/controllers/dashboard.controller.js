const { pool } = require('../db');

const getDashboardStats = async (req, res) => {
    // Parámetros desde el frontend con valores por defecto
    const { salesPeriod = '7d', topProductsLimit = 5 } = req.query;

    try {
        // 1. Métricas Generales (sin cambios)
        const totalSalesQuery = `
            SELECT SUM(pi.cantidad * pi.precio_congelado) AS "totalRevenue", COUNT(DISTINCT p.id) AS "totalOrders"
            FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id WHERE p.estado NOT IN ('cancelado')
        `;
        const totalSalesResult = await pool.query(totalSalesQuery);

        // 2. Ventas por Período (Lógica dinámica)
        let salesByDayQuery;
        if (salesPeriod === '7d') {
            salesByDayQuery = `
                SELECT DATE(p.fecha_creacion) AS "saleDate", SUM(pi.cantidad * pi.precio_congelado) AS "dailyRevenue"
                FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id
                WHERE p.fecha_creacion >= NOW() - INTERVAL '7 days' AND p.estado NOT IN ('cancelado')
                GROUP BY DATE(p.fecha_creacion) ORDER BY "saleDate" ASC
            `;
        } else if (salesPeriod === '30d') {
             salesByDayQuery = `
                SELECT DATE(p.fecha_creacion) AS "saleDate", SUM(pi.cantidad * pi.precio_congelado) AS "dailyRevenue"
                FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id
                WHERE p.fecha_creacion >= NOW() - INTERVAL '30 days' AND p.estado NOT IN ('cancelado')
                GROUP BY DATE(p.fecha_creacion) ORDER BY "saleDate" ASC
            `;
        } else { // Por Mes (ej: '2025-07')
            salesByDayQuery = {
                text: `
                    SELECT TO_CHAR(p.fecha_creacion, 'YYYY-MM') AS "saleMonth", SUM(pi.cantidad * pi.precio_congelado) AS "monthlyRevenue"
                    FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id
                    WHERE p.estado NOT IN ('cancelado')
                    GROUP BY "saleMonth" ORDER BY "saleMonth" DESC LIMIT 6
                `,
            };
        }
        const salesByDayResult = await pool.query(salesByDayQuery);

        // 3. Top N Productos (Lógica dinámica)
        const topProductsQuery = {
            text: `
                SELECT pr.nombre, SUM(pi.cantidad) AS "totalQuantity"
                FROM pedido_items pi JOIN productos pr ON pi.producto_id = pr.id
                GROUP BY pr.nombre ORDER BY "totalQuantity" DESC LIMIT $1
            `,
            values: [topProductsLimit]
        };
        const topProductsResult = await pool.query(topProductsQuery);
        
        // 4. Top 5 Clientes por Monto
        const topCustomersQuery = `
            SELECT c.nombre_comercio, SUM(pi.cantidad * pi.precio_congelado) as "totalSpent"
            FROM pedidos p 
            JOIN pedido_items pi ON p.id = pi.pedido_id
            JOIN clientes c ON p.cliente_id = c.id
            WHERE p.estado NOT IN ('cancelado')
            GROUP BY c.nombre_comercio
            ORDER BY "totalSpent" DESC
            LIMIT 5
        `;
        const topCustomersResult = await pool.query(topCustomersQuery);

        // 5. Rendimiento de Vendedores
        const salesBySellerQuery = `
            SELECT u.nombre, COUNT(DISTINCT p.id) as "orderCount", SUM(pi.cantidad * pi.precio_congelado) as "totalSold"
            FROM pedidos p
            JOIN pedido_items pi ON p.id = pi.pedido_id
            JOIN usuarios u ON p.usuario_id = u.id
            WHERE p.estado NOT IN ('cancelado') AND u.rol = 'vendedor'
            GROUP BY u.nombre
            ORDER BY "totalSold" DESC
        `;
        const salesBySellerResult = await pool.query(salesBySellerQuery);

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
    }
};

module.exports = {
    getDashboardStats,
};
