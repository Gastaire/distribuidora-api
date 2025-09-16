const { Router } = require('express');
const { analyzeAndPreviewOrphanedItems, executeFixOrphanedItems, } = require('../controllers/diagnostics.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = Router();

// Rutas existentes
router.get('/diagnostics/orphaned-items', protect, authorize('admin'), analyzeAndPreviewOrphanedItems);
router.post('/diagnostics/fix-orphans', protect, authorize('admin'), executeFixOrphanedItems);


module.exports = router;
