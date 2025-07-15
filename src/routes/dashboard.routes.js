const { Router } = require('express');
const { getDashboardStats } = require('../controllers/dashboard.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = Router();

// Ruta segura, solo para administradores y personal de depósito
router.get('/dashboard/stats', protect, authorize('admin', 'deposito'), getDashboardStats);

module.exports = router;
