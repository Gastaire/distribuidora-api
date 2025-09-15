const { Router } = require('express');
const { getOrphanedOrderItems } = require('../controllers/diagnostics.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = Router();

/**
 * @route GET /api/diagnostics/orphaned-items
 * @desc Obtiene una lista de todos los items de pedidos que apuntan a un producto que ya no existe.
 * @access Private (Solo para Admins)
 */
router.get('/diagnostics/orphaned-items', protect, authorize('admin'), getOrphanedOrderItems);

module.exports = router;
