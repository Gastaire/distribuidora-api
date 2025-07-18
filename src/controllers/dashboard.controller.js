const { pool } = require('../db'); // <-- CORRECCIÓN: Faltaba importar el 'pool' de la base de datos.

const getDashboardStats = async (req, res) => {
    const { salesPeriod = '7d', topProductsLimit = 5 } = req.query;

    try {
        // --- Consultas a la Base de Datos ---

        // Consulta para ingresos totales y número de pedidos.
        const totalSalesQuery = `
            SELECT 
                COALESCE(SUM(pi.cantidad * pi.precio_congelado), 0) AS "totalRevenue", 
                COALESCE(COUNT(DISTINCT p.id), 0) AS "totalOrders" 
            FROM pedidos p 
            JOIN pedido_items pi ON p.id = pi.pedido_id 
            WHERE p.estado NOT IN ('cancelado', 'archivado')
        `;

        // CORRECCIÓN: Se reestructuró la lógica para construir la consulta de ventas por día de manera más clara y segura.
        let salesByDayQuery;
        if (salesPeriod === 'monthly') {
            salesByDayQuery = {
                text: `
                    SELECT 
                        TO_CHAR(p.fecha_creacion, 'YYYY-MM') AS "saleMonth", 
                        SUM(pi.cantidad * pi.precio_congelado) AS "monthlyRevenue"
                    FROM pedidos p 
                    JOIN pedido_items pi ON p.id = pi.pedido_id
                    WHERE p.estado NOT IN ('cancelado', 'archivado')
                    GROUP BY "saleMonth" 
                    ORDER BY "saleMonth" DESC LIMIT 6
                `,
            };
        } else {
            const interval = salesPeriod === '30d' ? '30 days' : '7 days';
            salesByDayQuery = {
                text: `
                    SELECT 
                        DATE(p.fecha_creacion) AS "saleDate", 
                        SUM(pi.cantidad * pi.precio_congelado) AS "dailyRevenue"
                    FROM pedidos p 
                    JOIN pedido_items pi ON p.id = pi.pedido_id
                    WHERE p.fecha_creacion >= NOW() - INTERVAL $1
                    AND p.estado NOT IN ('cancelado', 'archivado')
                    GROUP BY DATE(p.fecha_creacion) 
                    ORDER BY "saleDate" ASC
                `,
                values: [interval]
            };
        }

        // Consulta para los productos más vendidos.
        const topProductsQuery = {
            text: `
                SELECT 
                    pi.nombre_producto as nombre, 
                    SUM(pi.cantidad) AS "totalQuantity"
                FROM pedido_items pi 
                JOIN pedidos p ON pi.pedido_id = p.id
                WHERE p.estado NOT IN ('cancelado', 'archivado')
                GROUP BY pi.nombre_producto 
                ORDER BY "totalQuantity" DESC 
                LIMIT $1
            `,
            values: [topProductsLimit]
        };

        // Consulta para los mejores clientes.
        const topCustomersQuery = `
            SELECT 
                c.nombre_comercio, 
                SUM(pi.cantidad * pi.precio_congelado) as "totalSpent"
            FROM pedidos p 
            JOIN pedido_items pi ON p.id = pi.pedido_id
            JOIN clientes c ON p.cliente_id = c.id
            WHERE p.estado NOT IN ('cancelado', 'archivado')
            GROUP BY c.nombre_comercio 
            ORDER BY "totalSpent" DESC 
            LIMIT 5
        `;

        // Consulta para las ventas por vendedor.
        const salesBySellerQuery = `
            SELECT 
                u.nombre, 
                COUNT(DISTINCT p.id) as "orderCount", 
                SUM(pi.cantidad * pi.precio_congelado) as "totalSold"
            FROM pedidos p
            JOIN pedido_items pi ON p.id = pi.pedido_id
            JOIN usuarios u ON p.usuario_id = u.id
            WHERE p.estado NOT IN ('cancelado', 'archivado') AND u.rol = 'vendedor'
            GROUP BY u.nombre 
            ORDER BY "totalSold" DESC
        `;

        // Ejecutar todas las consultas en paralelo para mayor eficiencia.
        const [
            totalSalesResult,
            salesByDayResult,
            topProductsResult,
            topCustomersResult,
            salesBySellerResult
        ] = await Promise.all([
            pool.query(totalSalesQuery),
            pool.query(salesByDayQuery),
            pool.query(topProductsQuery),
            pool.query(topCustomersQuery),
            pool.query(salesBySellerQuery)
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
    }
};

// <-- CORRECCIÓN: Faltaba exportar la función para que pueda ser usada en las rutas.
module.exports = {
    getDashboardStats
};
