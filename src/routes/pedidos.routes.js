const { Router } = require('express');
const {
    createPedido,
    getPedidos,
    getMisPedidos,
    getMisPedidosHistoricos,
    getPedidosStatus, // <-- IMPORTAMOS LA NUEVA FUNCIÓN
    getPedidoById,
    updatePedidoEstado,
    updatePedidoItems,
    updatePedidoNotas,
    updatePedido,
    archivePedido,
    cleanupArchivedPedidos,
    unarchivePedido,
    combinarPedidos
} = require('../controllers/pedidos.controller');
const { protect, authorize } = require('../middleware/auth.middleware');



const router = Router();


router.post('/pedidos', protect, authorize('vendedor', 'admin'), createPedido);
router.get('/pedidos', protect, getPedidos);

router.get('/pedidos/mis-pedidos', protect, authorize('vendedor', 'admin'), getMisPedidos);

router.get('/pedidos/mis-pedidos-historicos', protect, authorize('vendedor', 'admin'), getMisPedidosHistoricos);

// --- INICIO DE NUEVA RUTA ---
// Ruta para que la app de ventas consulte el estado de varios pedidos a la vez.
router.get('/pedidos/status', protect, authorize('vendedor', 'admin'), getPedidosStatus);
// --- FIN DE NUEVA RUTA ---

router.get('/pedidos/:id', protect, getPedidoById);
router.put('/pedidos/:id/estado', protect, authorize('admin', 'deposito'), updatePedidoEstado);
router.put('/pedidos/:id/items', protect, authorize('admin'), updatePedidoItems);
router.put('/pedidos/:id', protect, authorize('vendedor', 'admin'), updatePedido);
router.put('/pedidos/:id/archive', protect, authorize('admin'), archivePedido);
router.delete('/pedidos/cleanup-archived', protect, authorize('admin'), cleanupArchivedPedidos);
router.put('/pedidos/:id/unarchive', protect, authorize('admin'), unarchivePedido);
router.put('/pedidos/:id/notas', protect, authorize('admin', 'deposito'), updatePedidoNotas);
router.post('/pedidos/combinar', protect, authorize('admin'), combinarPedidos);


module.exports = router;
