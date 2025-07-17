const { pool } = require('../db');

const getDashboardStats = async (req, res) => {
    // Parámetros desde el frontend con valores por defecto
    const { salesPeriod = '7d', topProductsLimit = 5 } = req.query;

    try {
        // --- Lógica de Filtros de Fecha ---
        let dateFilterPedidos = "";
        let dateFilterPresenciales = "";
        let dateColumnPedidos = `DATE(p.fecha_creacion)`;
        let dateColumnPresenciales = `DATE(vpc.fecha_venta)`;
        let isMonthly = false;
        
        if (salesPeriod === '7d') {
            dateFilterPedidos = `AND p.fecha_creacion >= NOW() - INTERVAL '7 days'`;
            dateFilterPresenciales = `WHERE vpc.fecha_venta >= NOW() - INTERVAL '7 days'`;
        } else if (salesPeriod === '30d') {
            dateFilterPedidos = `AND p.fecha_creacion >= NOW() - INTERVAL '30 days'`;
            dateFilterPresenciales = `WHERE vpc.fecha_venta >= NOW() - INTERVAL '30 days'`;
        } else if (salesPeriod === 'monthly') {
            isMonthly = true;
            dateColumnPedidos = `TO_CHAR(p.fecha_creacion, 'YYYY-MM')`;
            dateColumnPresenciales = `TO_CHAR(vpc.fecha_venta, 'YYYY-MM')`;
        }

        // --- Consultas Unificadas ---

        const totalSalesQuery = `
            SELECT 
                COALESCE(SUM(combined.total), 0) AS "totalRevenue", 
                COALESCE(COUNT(combined.id), 0) AS "totalOrders" 
            FROM (
                SELECT p.id, SUM(pi.cantidad * pi.precio_congelado) as total 
                FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id 
                WHERE p.estado NOT IN ('cancelado', 'archivado') 
                GROUP BY p.id
                UNION ALL
                SELECT vpc.id, SUM(vpi.cantidad * vpi.precio_final_unitario) as total 
                FROM ventas_presenciales_comprobantes vpc JOIN ventas_presenciales_items vpi ON vpc.id = vpi.comprobante_id 
                GROUP BY vpc.id
            ) as combined;
        `;
        
        const salesByDayQuery = `
            SELECT "saleDate", SUM("dailyRevenue") as "dailyRevenue" FROM (
                SELECT ${dateColumnPedidos} AS "saleDate", SUM(pi.cantidad * pi.precio_congelado) AS "dailyRevenue"
                FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id
                WHERE p.estado NOT IN ('cancelado', 'archivado') ${dateFilterPedidos}
                GROUP BY "saleDate"
                UNION ALL
                SELECT ${dateColumnPresenciales} AS "saleDate", SUM(vpi.cantidad * vpi.precio_final_unitario) AS "dailyRevenue"
                FROM ventas_presenciales_comprobantes vpc JOIN ventas_presenciales_items vpi ON vpc.id = vpi.comprobante_id
                ${dateFilterPresenciales}
                GROUP BY "saleDate"
            ) as combined_sales_by_day
            GROUP BY "saleDate" ORDER BY "saleDate" ${isMonthly ? 'DESC LIMIT 6' : 'ASC'}
        `;

        const topProductsQuery = {
            text: `
                SELECT nombre, SUM(totalQuantity) as "totalQuantity" FROM (
                    SELECT pi.nombre_producto as nombre, SUM(pi.cantidad) AS "totalQuantity"
                    FROM pedido_items pi JOIN pedidos p ON pi.pedido_id = p.id
                    WHERE p.estado NOT IN ('cancelado', 'archivado')
                    GROUP BY pi.nombre_producto
                    UNION ALL
                    SELECT vpi.nombre_producto as nombre, SUM(vpi.cantidad) AS "totalQuantity"
                    FROM ventas_presenciales_items vpi
                    GROUP BY vpi.nombre_producto
                ) as combined_products
                WHERE nombre IS NOT NULL
                GROUP BY nombre ORDER BY "totalQuantity" DESC LIMIT $1
            `,
            values: [topProductsLimit]
        };

        const topCustomersQuery = `SELECT c.nombre_comercio, SUM(pi.cantidad * pi.precio_congelado) as "totalSpent" FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id JOIN clientes c ON p.cliente_id = c.id WHERE p.estado NOT IN ('cancelado', 'archivado') GROUP BY c.nombre_comercio ORDER BY "totalSpent" DESC LIMIT 5`;
        const salesBySellerQuery = `SELECT u.nombre, COUNT(DISTINCT p.id) as "orderCount", SUM(pi.cantidad * pi.precio_congelado) as "totalSold" FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id JOIN usuarios u ON p.usuario_id = u.id WHERE p.estado NOT IN ('cancelado', 'archivado') AND u.rol = 'vendedor' GROUP BY u.nombre ORDER BY "totalSold" DESC`;
        
        // Ejecutamos todas las consultas en paralelo
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
            salesByDay: salesByDayResult.rows.map(r => ({ ...r, saleMonth: r.saleDate, monthlyRevenue: r.dailyRevenue })),
            topProducts: topProductsResult.rows,
            topCustomers: topCustomersResult.rows,
            salesBySeller: salesBySellerResult.rows
        });

    } catch (error) {
        console.error('Error al obtener estadísticas del dashboard:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
};

module.exports = { getDashboardStats };
