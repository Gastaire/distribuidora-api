const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth.middleware');

const {
    getReporteFaltantes,
    getReporteDiarioPedidos,
    getReportePedidosPorVendedor,
    getReportePedidosEntregados,
    getReporteClientesInactivos,
    getReporteProductosMasPedidos,
    getReporteFaltantesHistorico,
} = require('../controllers/reportes.controller');

// Todos los reportes son admin-only
router.use(protect, authorize('admin'));

// ─── Endpoint original ────────────────────────────────────────────────────────
// GET /api/reportes/faltantes-diario
// Faltantes de las últimas 24 horas
router.get('/reportes/faltantes-diario', getReporteFaltantes);

// ─── Nuevos endpoints ─────────────────────────────────────────────────────────

// GET /api/reportes/diario-pedidos?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
// Resumen de pedidos del día/período: totales, por estado, clientes únicos.
// Sin params = hoy.
router.get('/reportes/diario-pedidos', getReporteDiarioPedidos);

// GET /api/reportes/pedidos-por-vendedor?startDate=&endDate=
// Rendimiento de cada vendedor: pedidos, monto, clientes únicos, ticket promedio.
router.get('/reportes/pedidos-por-vendedor', getReportePedidosPorVendedor);

// GET /api/reportes/pedidos-entregados?startDate=&endDate=&vendedor_id=
// Lista de pedidos entregados con cliente, vendedor y montos.
router.get('/reportes/pedidos-entregados', getReportePedidosEntregados);

// GET /api/reportes/clientes-inactivos?dias=30
// Clientes sin pedidos en los últimos N días. Útil para seguimiento comercial.
router.get('/reportes/clientes-inactivos', getReporteClientesInactivos);

// GET /api/reportes/productos-mas-pedidos?startDate=&endDate=&orderBy=cantidad|monto&limit=20
// Top productos por unidades vendidas o monto generado.
router.get('/reportes/productos-mas-pedidos', getReporteProductosMasPedidos);

// GET /api/reportes/faltantes-historico?startDate=&endDate=&limit=100
// Historial completo de ítems removidos de pedidos, agrupado y en detalle.
router.get('/reportes/faltantes-historico', getReporteFaltantesHistorico);

module.exports = router;
