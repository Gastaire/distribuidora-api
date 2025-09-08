const { pool } = require('../db');

/**
 * @description Obtiene KPIs (Key Performance Indicators) de ventas para una categoría específica,
 * combinando datos de los pedidos de la app y de las ventas presenciales.
 * Acepta filtros por rango de fechas y canal de venta.
 */
const getCategoryKpis = async (req, res, next) => {
    const { 
        category, 
        channel = 'todos', // 'pedidos', 'presencial', o 'todos'
        startDate, 
        endDate 
    } = req.query;

    if (!category) {
        return res.status(400).json({ message: 'El parámetro "category" es requerido.' });
    }

    const client = await pool.connect();
    try {
        let queryParts = [];
        const queryParams = [category];

        // Construcción dinámica de la consulta de Pedidos
        const pedidosQuery = `
            SELECT 
                pr.nombre,
                SUM(pi.cantidad) as cantidad,
                SUM(pi.cantidad * pi.precio_congelado) as monto
            FROM pedido_items pi
            JOIN pedidos p ON pi.pedido_id = p.id
            JOIN productos pr ON pi.producto_id = pr.id
            WHERE pr.categoria = $1
              AND p.estado NOT IN ('cancelado', 'archivado', 'combinado')
              ${startDate ? `AND p.fecha_creacion >= $${queryParams.push(startDate)}` : ''}
              ${endDate ? `AND p.fecha_creacion <= $${queryParams.push(endDate)}` : ''}
            GROUP BY pr.nombre
        `;

        // Construcción dinámica de la consulta de Ventas Presenciales
        // Nota: Unimos por SKU, asumiendo que es el identificador común.
        const presencialesQuery = `
            SELECT 
                vpi.nombre_producto as nombre,
                SUM(vpi.cantidad) as cantidad,
                SUM(vpi.cantidad * vpi.precio_final_unitario) as monto
            FROM ventas_presenciales_items vpi
            JOIN ventas_presenciales_comprobantes vpc ON vpi.comprobante_id = vpc.id
            JOIN productos pr ON vpi.codigo_sku = pr.codigo_sku
            WHERE pr.categoria = $1
              ${startDate ? `AND vpc.fecha_venta >= $${queryParams.push(startDate)}` : ''}
              ${endDate ? `AND vpc.fecha_venta <= $${queryParams.push(endDate)}` : ''}
            GROUP BY vpi.nombre_producto
        `;

        if (channel === 'pedidos') {
            queryParts.push(pedidosQuery);
        } else if (channel === 'presencial') {
            queryParts.push(presencialesQuery);
        } else { // 'todos'
            queryParts.push(pedidosQuery, presencialesQuery);
        }

        const fullQuery = `
            SELECT 
                nombre,
                SUM(cantidad) as total_cantidad,
                SUM(monto) as total_monto
            FROM (
                ${queryParts.join(' UNION ALL ')}
            ) as ventas_combinadas
            GROUP BY nombre
            ORDER BY total_monto DESC
        `;
        
        // Re-ajustamos los parámetros para el UNION ALL si es necesario
        let finalParams = [...queryParams];
        if(channel === 'todos') {
            finalParams = [queryParams[0], ...queryParams.slice(1), queryParams[0], ...queryParams.slice(1)];
        }
        
        const { rows } = await client.query(fullQuery, finalParams);
        
        // Calculamos los totales generales
        const grandTotalMonto = rows.reduce((acc, row) => acc + parseFloat(row.total_monto), 0);
        const grandTotalCantidad = rows.reduce((acc, row) => acc + parseFloat(row.total_cantidad), 0);

        res.status(200).json({
            kpis: rows,
            summary: {
                totalMonto: grandTotalMonto,
                totalCantidad: grandTotalCantidad,
                totalProductos: rows.length
            },
            filters: { category, channel, startDate, endDate }
        });

    } catch (error) {
        console.error('Error al obtener KPIs de categoría:', error);
        next(error);
    } finally {
        client.release();
    }
};

module.exports = {
    getCategoryKpis,
};
