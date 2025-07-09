const { Router } = require('express');
const { getLogs } = require('../controllers/logs.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = Router();

// Solo los administradores pueden ver el registro de actividad
router.get('/logs', protect, authorize('admin'), getLogs);

module.exports = router;
