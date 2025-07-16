const { Router } = require('express');
const {
    createPedido,
    getPedidos,
    getPedidoById,
    updatePedidoEstado,
    updatePedidoItems,
    archivePedido,
    cleanupArchivedPedidos 
} = require('../controllers/pedidos.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = Router();

router.post('/pedidos', protect, authorize('vendedor', 'admin'), createPedido);
router.get('/pedidos', protect, getPedidos);
router.get('/pedidos/:id', protect, getPedidoById);
router.put('/pedidos/:id/estado', protect, authorize('admin', 'deposito'), updatePedidoEstado);
router.put('/pedidos/:id/items', protect, authorize('admin'), updatePedidoItems);
router.put('/pedidos/:id/archive', protect, authorize('admin'), archivePedido);
router.delete('/pedidos/cleanup-archived', protect, authorize('admin'), cleanupArchivedPedidos);

module.exports = router;
