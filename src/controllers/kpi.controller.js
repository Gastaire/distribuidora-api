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
        const finalParams = [];
        let paramIndex = 1;

        // --- Lógica para la consulta de Pedidos ---
        if (channel === 'pedidos' || channel === 'todos') {
            const paramsForPedidos = [category];
            let pedidosQuery = `
                SELECT 
                    pr.nombre,
                    SUM(pi.cantidad) as cantidad,
                    SUM(pi.cantidad * pi.precio_congelado) as monto
                FROM pedido_items pi
                JOIN pedidos p ON pi.pedido_id = p.id
                JOIN productos pr ON pi.producto_id = pr.id
                WHERE pr.categoria = $${paramIndex++}
                  AND p.estado NOT IN ('cancelado', 'archivado', 'combinado')
            `;
            if (startDate) {
                pedidosQuery += ` AND p.fecha_creacion >= $${paramIndex++}`;
                paramsForPedidos.push(startDate);
            }
            if (endDate) {
                pedidosQuery += ` AND p.fecha_creacion <= $${paramIndex++}`;
                paramsForPedidos.push(endDate);
            }
            pedidosQuery += ' GROUP BY pr.nombre';
            queryParts.push(pedidosQuery);
            finalParams.push(...paramsForPedidos);
        }

        // --- Lógica para la consulta de Ventas Presenciales ---
        if (channel === 'presencial' || channel === 'todos') {
            const paramsForPresencial = [category];
            let presencialesQuery = `
                SELECT 
                    vpi.nombre_producto as nombre,
                    SUM(vpi.cantidad) as cantidad,
                    SUM(vpi.cantidad * vpi.precio_final_unitario) as monto
                FROM ventas_presenciales_items vpi
                JOIN ventas_presenciales_comprobantes vpc ON vpi.comprobante_id = vpc.id
                JOIN productos pr ON vpi.codigo_sku = pr.codigo_sku
                WHERE pr.categoria = $${paramIndex++}
            `;
            if (startDate) {
                presencialesQuery += ` AND vpc.fecha_venta >= $${paramIndex++}`;
                paramsForPresencial.push(startDate);
            }
            if (endDate) {
                presencialesQuery += ` AND vpc.fecha_venta <= $${paramIndex++}`;
                paramsForPresencial.push(endDate);
            }
            presencialesQuery += ' GROUP BY vpi.nombre_producto';
            queryParts.push(presencialesQuery);
            finalParams.push(...paramsForPresencial);
        }
        
        // Si no hay partes de consulta, no hay nada que hacer
        if(queryParts.length === 0) {
            return res.status(200).json({ kpis: [], summary: { totalMonto: 0, totalCantidad: 0, totalProductos: 0 }, filters: req.query });
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
