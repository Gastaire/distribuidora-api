const { pool } = require('../db');

// --- Funciones Auxiliares para cada fuente de datos ---

const getPedidosStats = async (client, salesPeriod, topProductsLimit) => {
    let dateFilter = "";
    if (salesPeriod === '7d') dateFilter = `AND p.fecha_creacion >= NOW() - INTERVAL '7 days'`;
    if (salesPeriod === '30d') dateFilter = `AND p.fecha_creacion >= NOW() - INTERVAL '30 days'`;

    const totalSalesQuery = `
        SELECT COALESCE(SUM(pi.cantidad * pi.precio_congelado), 0) AS "totalRevenue", COUNT(DISTINCT p.id) AS "totalOrders"
        FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id WHERE p.estado NOT IN ('cancelado', 'archivado')`;
    
    const salesByPeriodQuery = `
        SELECT DATE(p.fecha_creacion) AS "saleDate", SUM(pi.cantidad * pi.precio_congelado) AS "dailyRevenue"
        FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id
        WHERE p.estado NOT IN ('cancelado', 'archivado') ${dateFilter}
        GROUP BY DATE(p.fecha_creacion) ORDER BY "saleDate" ASC`;

    const topProductsQuery = `
        SELECT pi.nombre_producto as nombre, SUM(pi.cantidad) AS "totalQuantity"
        FROM pedido_items pi JOIN pedidos p ON pi.pedido_id = p.id WHERE p.estado NOT IN ('cancelado', 'archivado')
        GROUP BY pi.nombre_producto ORDER BY "totalQuantity" DESC LIMIT $1`;

    const [totalResult, periodResult, productsResult] = await Promise.all([
        client.query(totalSalesQuery),
        client.query(salesByPeriodQuery),
        client.query(topProductsQuery, [topProductsLimit])
    ]);

    return {
        totalRevenue: totalResult.rows[0]?.totalRevenue || 0,
        totalOrders: totalResult.rows[0]?.totalOrders || 0,
        salesByDay: periodResult.rows,
        topProducts: productsResult.rows,
    };
};

const getPresencialesStats = async (client, salesPeriod, topProductsLimit) => {
    let dateFilter = "";
    if (salesPeriod === '7d') dateFilter = `WHERE vpc.fecha_venta >= NOW() - INTERVAL '7 days'`;
    if (salesPeriod === '30d') dateFilter = `WHERE vpc.fecha_venta >= NOW() - INTERVAL '30 days'`;
    
    const totalSalesQuery = `
        SELECT COALESCE(SUM(vpi.cantidad * vpi.precio_final_unitario), 0) AS "totalRevenue", COUNT(DISTINCT vpc.id) AS "totalOrders"
        FROM ventas_presenciales_comprobantes vpc JOIN ventas_presenciales_items vpi ON vpc.id = vpi.comprobante_id`;
    
    const salesByPeriodQuery = `
        SELECT DATE(vpc.fecha_venta) AS "saleDate", SUM(vpi.cantidad * vpi.precio_final_unitario) AS "dailyRevenue"
        FROM ventas_presenciales_comprobantes vpc JOIN ventas_presenciales_items vpi ON vpc.id = vpi.comprobante_id
        ${dateFilter}
        GROUP BY DATE(vpc.fecha_venta) ORDER BY "saleDate" ASC`;

    const topProductsQuery = `
        SELECT vpi.nombre_producto as nombre, SUM(vpi.cantidad) AS "totalQuantity"
        FROM ventas_presenciales_items vpi GROUP BY vpi.nombre_producto
        ORDER BY "totalQuantity" DESC LIMIT $1`;

    const [totalResult, periodResult, productsResult] = await Promise.all([
        client.query(totalSalesQuery),
        client.query(salesByPeriodQuery),
        client.query(topProductsQuery, [topProductsLimit])
    ]);

    return {
        totalRevenue: totalResult.rows[0]?.totalRevenue || 0,
        totalOrders: totalResult.rows[0]?.totalOrders || 0,
        salesByDay: periodResult.rows,
        topProducts: productsResult.rows,
    };
};


// --- Controlador Principal ---

const getDashboardStats = async (req, res) => {
    const { salesPeriod = '7d', topProductsLimit = 5, source = 'pedidos' } = req.query; // Nuevo parámetro 'source'
    const client = await pool.connect();

    try {
        let stats;
        if (source === 'presencial') {
            console.log('Obteniendo estadísticas de Ventas Presenciales...');
            stats = await getPresencialesStats(client, salesPeriod, topProductsLimit);
        } else {
            console.log('Obteniendo estadísticas de Pedidos de App...');
            stats = await getPedidosStats(client, salesPeriod, topProductsLimit);
        }
        res.status(200).json(stats);
    } catch (error) {
        console.error(`Error al obtener estadísticas del dashboard para la fuente "${source}":`, error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    } finally {
        if (client) client.release();
    }
};

module.exports = { getDashboardStats };
