const { Router } = require('express');
const { analyzeAndPreviewOrphanedItems, executeFixOrphanedItems, fixSingleOrphanedItem } = require('../controllers/diagnostics.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = Router();

// Rutas existentes
router.get('/diagnostics/orphaned-items', protect, authorize('admin'), analyzeAndPreviewOrphanedItems);
router.post('/diagnostics/fix-orphans', protect, authorize('admin'), executeFixOrphanedItems);

// Nueva ruta para corrección individual
router.post('/diagnostics/fix-single-orphan', protect, authorize('admin'), fixSingleOrphanedItem);

module.exports = router;
