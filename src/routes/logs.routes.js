const { Router } = require('express');
const { getLogs } = require('../controllers/logs.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = Router();

/**
 * @route GET /api/logs
 * @desc Obtener el registro de actividad del sistema.
 * @access Private (Solo para Admins)
 */
router.get('/logs', protect, authorize('admin'), getLogs);

module.exports = router;
