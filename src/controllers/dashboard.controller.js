const { pool } = require('../db');

// Esta función auxiliar ejecuta una consulta y devuelve las filas o un array vacío.
const queryDatabase = async (client, query, params = []) => {
    try {
        const result = await client.query(query, params);
        return result.rows;
    } catch (error) {
        console.error('Error en la consulta:', error.message);
        // En lugar de detener todo, devolvemos un resultado vacío para esa métrica.
        return []; 
    }
};

const getDashboardStats = async (req, res) => {
    const { salesPeriod = '7d', topProductsLimit = 5 } = req.query;
    const client = await pool.connect(); // Usamos un único cliente para todas las consultas.

    try {
        // --- Definición de Consultas (Simplificadas y Seguras) ---

        const totalSalesQuery = `
            SELECT COALESCE(SUM(pi.cantidad * pi.precio_congelado), 0) AS "totalRevenue", 
                   COALESCE(COUNT(DISTINCT p.id), 0) AS "totalOrders" 
            FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id 
            WHERE p.estado NOT IN ('cancelado', 'archivado')`;

        const interval = salesPeriod === '30d' ? '30 days' : '7 days';
        const salesByDayQuery = `
            SELECT DATE(p.fecha_creacion) AS "saleDate", SUM(pi.cantidad * pi.precio_congelado) AS "dailyRevenue"
            FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id
            WHERE p.fecha_creacion >= NOW() - $1::interval AND p.estado NOT IN ('cancelado', 'archivado')
            GROUP BY DATE(p.fecha_creacion) ORDER BY "saleDate" ASC`;

        const salesByMonthQuery = `
            SELECT TO_CHAR(p.fecha_creacion, 'YYYY-MM') AS "saleMonth", SUM(pi.cantidad * pi.precio_congelado) AS "monthlyRevenue"
            FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id
            WHERE p.estado NOT IN ('cancelado', 'archivado')
            GROUP BY "saleMonth" ORDER BY "saleMonth" DESC LIMIT 6`;

        const topProductsQuery = `
            SELECT pi.nombre_producto as nombre, SUM(pi.cantidad) AS "totalQuantity"
            FROM pedido_items pi JOIN pedidos p ON pi.pedido_id = p.id
            WHERE p.estado NOT IN ('cancelado', 'archivado')
            GROUP BY pi.nombre_producto ORDER BY "totalQuantity" DESC LIMIT $1`;

        const topCustomersQuery = `
            SELECT c.nombre_comercio, SUM(pi.cantidad * pi.precio_congelado) as "totalSpent"
            FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id JOIN clientes c ON p.cliente_id = c.id
            WHERE p.estado NOT IN ('cancelado', 'archivado')
            GROUP BY c.nombre_comercio ORDER BY "totalSpent" DESC LIMIT 5`;

        const salesBySellerQuery = `
            SELECT u.nombre, COUNT(DISTINCT p.id) as "orderCount", SUM(pi.cantidad * pi.precio_congelado) as "totalSold"
            FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id JOIN usuarios u ON p.usuario_id = u.id
            WHERE p.estado NOT IN ('cancelado', 'archivado') AND u.rol = 'vendedor'
            GROUP BY u.nombre ORDER BY "totalSold" DESC`;

        // --- Ejecución de Consultas ---

        const [
            totalSalesResult,
            topProductsResult,
            topCustomersResult,
            salesBySellerResult
        ] = await Promise.all([
            queryDatabase(client, totalSalesQuery),
            queryDatabase(client, topProductsQuery, [topProductsLimit]),
            queryDatabase(client, topCustomersQuery),
            queryDatabase(client, salesBySellerQuery)
        ]);

        const salesByPeriodResult = salesPeriod === 'monthly'
            ? await queryDatabase(client, salesByMonthQuery)
            : await queryDatabase(client, salesByDayQuery, [interval]);

        // --- Ensamblaje de la Respuesta ---
        
        const responseData = {
            totalRevenue: totalSalesResult[0]?.totalRevenue || 0,
            totalOrders: totalSalesResult[0]?.totalOrders || 0,
            salesByDay: salesByPeriodResult,
            topProducts: topProductsResult,
            topCustomers: topCustomersResult,
            salesBySeller: salesBySellerResult
        };

        res.status(200).json(responseData);

    } catch (error) {
        // Este error se capturaría si falla la conexión inicial al pool.
        console.error('Error crítico en el controlador del dashboard:', error);
        res.status(500).json({ message: 'Error interno del servidor al conectar con la base de datos.' });
    } finally {
        if (client) {
            client.release(); // Muy importante: liberar la conexión.
        }
    }
};

module.exports = {
    getDashboardStats
};
