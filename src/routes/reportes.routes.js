const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth.middleware');

const {
    getReporteFaltantes,
    getReporteDiarioPedidos,
    getReporteResumenEjecutivo,
    getReportePedidosPorVendedor,
    getReportePedidosEntregados,
    getReporteClientesInactivos,
    getReporteProductosMasPedidos,
    getReporteFaltantesHistorico,
    getReporteCategoriasComparativa,
} = require('../controllers/reportes.controller');

// Todos los reportes son admin-only
router.use(protect, authorize('admin'));

// ─── Endpoint original ────────────────────────────────────────────────────────
router.get('/reportes/faltantes-diario', getReporteFaltantes);

// ─── Resumen ejecutivo (nuevo — reemplaza diario-pedidos como vista principal) ─
router.get('/reportes/resumen-ejecutivo', getReporteResumenEjecutivo);

// ─── Endpoints existentes ─────────────────────────────────────────────────────
router.get('/reportes/diario-pedidos', getReporteDiarioPedidos);
router.get('/reportes/pedidos-por-vendedor', getReportePedidosPorVendedor);
router.get('/reportes/pedidos-entregados', getReportePedidosEntregados);
router.get('/reportes/clientes-inactivos', getReporteClientesInactivos);
router.get('/reportes/productos-mas-pedidos', getReporteProductosMasPedidos);
router.get('/reportes/faltantes-historico', getReporteFaltantesHistorico);

// ─── Comparativa de categorías (nuevo — reemplaza AnalyticsView) ──────────────
router.get('/reportes/categorias-comparativa', getReporteCategoriasComparativa);

module.exports = router;
