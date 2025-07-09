const { Router } = require('express');
const { updatePedidoItems } = require('../controllers/pedidos.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = Router();

// Solo un admin puede modificar los items de un pedido existente
router.put('/pedidos/:id/items', protect, authorize('admin'), updatePedidoItems);

module.exports = router;
