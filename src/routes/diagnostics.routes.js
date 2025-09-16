const { Router } = require('express');
const { analyzeAndPreviewOrphanedItems, executeFixOrphanedItems } = require('../controllers/diagnostics.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = Router();

/**
 * @route GET /api/diagnostics/orphaned-items
 * @desc Analiza y clasifica los items de pedidos huérfanos para una posible corrección.
 * @access Private (Solo para Admins)
 */
router.get('/diagnostics/orphaned-items', protect, authorize('admin'), analyzeAndPreviewOrphanedItems);

/**
 * @route POST /api/diagnostics/fix-orphans
 * @desc Ejecuta la corrección para una lista de candidatos de items huérfanos.
 * @access Private (Solo para Admins)
 */
router.post('/diagnostics/fix-orphans', protect, authorize('admin'), executeFixOrphanedItems);


// Nueva ruta para corrección individual
router.post('/diagnostics/fix-single-orphan', protect, authorize('admin'), fixSingleOrphanedItem);

module.exports = router;
