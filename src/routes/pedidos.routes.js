const { Router } = require('express');
const {
    createPedido,
    getPedidos,
    getPedidoById,
    updatePedidoEstado
} = require('../controllers/pedidos.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = Router();

// Un vendedor puede crear un pedido
router.post('/pedidos', protect, authorize('vendedor'), createPedido);

// Todos los roles pueden ver pedidos (la lógica está en el controlador)
router.get('/pedidos', protect, getPedidos);
router.get('/pedidos/:id', protect, getPedidoById);

// Solo un admin puede cambiar el estado de un pedido
router.put('/pedidos/:id/estado', protect, authorize('admin'), updatePedidoEstado);

module.exports = router;
