const { pool } = require('../db');

const getDashboardStats = async (req, res) => {
    const { salesPeriod = '7d', topProductsLimit = 5 } = req.query;
    const client = await pool.connect(); // Obtenemos un cliente del pool para todas las consultas.

    try {
        // --- Consultas a la Base de Datos (Versión Simplificada y Segura) ---

        // 1. Ingresos totales y número de pedidos
        const totalSalesQuery = `
            SELECT 
                COALESCE(SUM(pi.cantidad * pi.precio_congelado), 0) AS "totalRevenue", 
                COALESCE(COUNT(DISTINCT p.id), 0) AS "totalOrders" 
            FROM pedidos p 
            JOIN pedido_items pi ON p.id = pi.pedido_id 
            WHERE p.estado NOT IN ('cancelado', 'archivado')
        `;

        // 2. Ventas por período de tiempo
        let salesByDayQuery;
        if (salesPeriod === 'monthly') {
            salesByDayQuery = {
                text: `
                    SELECT 
                        TO_CHAR(p.fecha_creacion, 'YYYY-MM') AS "saleMonth", 
                        SUM(pi.cantidad * pi.precio_congelado) AS "monthlyRevenue"
                    FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id
                    WHERE p.estado NOT IN ('cancelado', 'archivado')
                    GROUP BY "saleMonth" ORDER BY "saleMonth" DESC LIMIT 6
                `,
                values: []
            };
        } else {
            const interval = salesPeriod === '30d' ? '30 days' : '7 days';
            salesByDayQuery = {
                text: `
                    SELECT 
                        DATE(p.fecha_creacion) AS "saleDate", 
                        SUM(pi.cantidad * pi.precio_congelado) AS "dailyRevenue"
                    FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id
                    WHERE p.fecha_creacion >= NOW() - INTERVAL $1 AND p.estado NOT IN ('cancelado', 'archivado')
                    GROUP BY DATE(p.fecha_creacion) ORDER BY "saleDate" ASC
                `,
                values: [interval]
            };
        }

        // 3. Productos más vendidos
        const topProductsQuery = {
            text: `
                SELECT pi.nombre_producto as nombre, SUM(pi.cantidad) AS "totalQuantity"
                FROM pedido_items pi JOIN pedidos p ON pi.pedido_id = p.id
                WHERE p.estado NOT IN ('cancelado', 'archivado')
                GROUP BY pi.nombre_producto ORDER BY "totalQuantity" DESC LIMIT $1
            `,
            values: [topProductsLimit]
        };

        // 4. Mejores clientes
        const topCustomersQuery = `
            SELECT c.nombre_comercio, SUM(pi.cantidad * pi.precio_congelado) as "totalSpent"
            FROM pedidos p 
            JOIN pedido_items pi ON p.id = pi.pedido_id JOIN clientes c ON p.cliente_id = c.id
            WHERE p.estado NOT IN ('cancelado', 'archivado')
            GROUP BY c.nombre_comercio ORDER BY "totalSpent" DESC LIMIT 5
        `;

        // 5. Ventas por vendedor
        const salesBySellerQuery = `
            SELECT u.nombre, COUNT(DISTINCT p.id) as "orderCount", SUM(pi.cantidad * pi.precio_congelado) as "totalSold"
            FROM pedidos p
            JOIN pedido_items pi ON p.id = pi.pedido_id JOIN usuarios u ON p.usuario_id = u.id
            WHERE p.estado NOT IN ('cancelado', 'archivado') AND u.rol = 'vendedor'
            GROUP BY u.nombre ORDER BY "totalSold" DESC
        `;

        // Ejecutar todas las consultas en paralelo con el mismo cliente
        const [
            totalSalesResult,
            salesByDayResult,
            topProductsResult,
            topCustomersResult,
            salesBySellerResult
        ] = await Promise.all([
            client.query(totalSalesQuery),
            client.query(salesByDayQuery.text, salesByDayQuery.values),
            client.query(topProductsQuery.text, topProductsQuery.values),
            client.query(topCustomersQuery),
            client.query(salesBySellerQuery)
        ]);

        // Formatear la respuesta para el frontend
        const responseData = {
            totalRevenue: totalSalesResult.rows[0].totalRevenue || 0,
            totalOrders: totalSalesResult.rows[0].totalOrders || 0,
            salesByDay: salesByDayResult.rows,
            topProducts: topProductsResult.rows,
            topCustomers: topCustomersResult.rows,
            salesBySeller: salesBySellerResult.rows
        };

        // Si es una consulta mensual, ajustar el nombre del campo para el gráfico
        if (salesPeriod === 'monthly') {
            responseData.salesByDay = responseData.salesByDay.map(row => ({
                saleMonth: row.saleMonth,
                monthlyRevenue: row.monthlyRevenue
            }));
        } else {
             responseData.salesByDay = responseData.salesByDay.map(row => ({
                saleDate: row.saleDate,
                dailyRevenue: row.dailyRevenue
            }));
        }
        
        res.status(200).json(responseData);

    } catch (error) {
        console.error('Error al obtener estadísticas del dashboard:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    } finally {
        if (client) {
            client.release(); // Liberar el cliente de vuelta al pool
        }
    }
};

module.exports = {
    getDashboardStats
};
