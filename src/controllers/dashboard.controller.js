const { pool } = require('../db');

const getDashboardStats = async (req, res) => {
    console.log('--- Iniciando getDashboardStats ---');
    const { salesPeriod = '7d', topProductsLimit = 5 } = req.query;
    const client = await pool.connect();

    try {
        // --- Definición de Consultas ---
        const totalSalesQuery = `
            SELECT COALESCE(SUM(combined.total), 0) AS "totalRevenue", COALESCE(COUNT(combined.id), 0) AS "totalOrders" 
            FROM (
                SELECT p.id, SUM(pi.cantidad * pi.precio_congelado) as total FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id WHERE p.estado NOT IN ('cancelado', 'archivado') GROUP BY p.id
                UNION ALL
                SELECT vpc.id, SUM(vpi.cantidad * vpi.precio_final_unitario) as total FROM ventas_presenciales_comprobantes vpc JOIN ventas_presenciales_items vpi ON vpc.id = vpi.comprobante_id GROUP BY vpc.id
            ) as combined;
        `;
        
        console.log('1. Preparando consulta de ventas totales...');
        const totalSalesPromise = client.query(totalSalesQuery);

        const topProductsQuery = `
            SELECT nombre, SUM(totalQuantity) as "totalQuantity" FROM (
                SELECT pi.nombre_producto as nombre, SUM(pi.cantidad) AS "totalQuantity" FROM pedido_items pi JOIN pedidos p ON pi.pedido_id = p.id WHERE p.estado NOT IN ('cancelado', 'archivado') GROUP BY pi.nombre_producto
                UNION ALL
                SELECT vpi.nombre_producto as nombre, SUM(vpi.cantidad) AS "totalQuantity" FROM ventas_presenciales_items vpi GROUP BY vpi.nombre_producto
            ) as combined_products
            WHERE nombre IS NOT NULL GROUP BY nombre ORDER BY "totalQuantity" DESC LIMIT $1
        `;
        
        console.log('2. Preparando consulta de productos más vendidos...');
        const topProductsPromise = client.query(topProductsQuery, [topProductsLimit]);

        const topCustomersQuery = `
            SELECT c.nombre_comercio, SUM(pi.cantidad * pi.precio_congelado) as "totalSpent" 
            FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id JOIN clientes c ON p.cliente_id = c.id 
            WHERE p.estado NOT IN ('cancelado', 'archivado') 
            GROUP BY c.nombre_comercio ORDER BY "totalSpent" DESC LIMIT 5
        `;

        console.log('3. Preparando consulta de mejores clientes...');
        const topCustomersPromise = client.query(topCustomersQuery);

        const salesBySellerQuery = `
            SELECT u.nombre, COUNT(DISTINCT p.id) as "orderCount", SUM(pi.cantidad * pi.precio_congelado) as "totalSold" 
            FROM pedidos p JOIN pedido_items pi ON p.id = pi.pedido_id JOIN usuarios u ON p.usuario_id = u.id 
            WHERE p.estado NOT IN ('cancelado', 'archivado') AND u.rol = 'vendedor' 
            GROUP BY u.nombre ORDER BY "totalSold" DESC
        `;
        
        console.log('4. Preparando consulta de ventas por vendedor...');
        const salesBySellerPromise = client.query(salesBySellerQuery);

        // --- Ejecución y Verificación ---
        console.log('--- Ejecutando todas las promesas de consulta ---');
        
        const [
            totalSalesResult, 
            topProductsResult, 
            topCustomersResult, 
            salesBySellerResult
        ] = await Promise.all([
            totalSalesPromise,
            topProductsPromise,
            topCustomersPromise,
            salesBySellerPromise
        ]);

        console.log('--- Todas las consultas se completaron con éxito. Enviando respuesta. ---');
        
        res.status(200).json({
            totalRevenue: totalSalesResult.rows[0]?.totalRevenue || 0,
            totalOrders: totalSalesResult.rows[0]?.totalOrders || 0,
            salesByDay: [], // Dejamos esto vacío por ahora para simplificar la depuración
            topProducts: topProductsResult.rows,
            topCustomers: topCustomersResult.rows,
            salesBySeller: salesBySellerResult.rows
        });

    } catch (error) {
        console.error('--- ERROR CRÍTICO EN EL DASHBOARD CONTROLLER ---');
        console.error(error); // ESTE ES EL ERROR EXACTO QUE NECESITAMOS VER
        res.status(500).json({ message: 'Error interno del servidor.', error: error.message });
    } finally {
        if (client) {
            console.log('--- Liberando cliente de la base de datos ---');
            client.release();
        }
    }
};

module.exports = { getDashboardStats };
