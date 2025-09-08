const { Router } = require('express');
const { getCategoryKpis } = require('../controllers/kpi.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = Router();

/**
 * @route GET /api/kpi/category-kpis
 * @desc Obtiene los KPIs de ventas para una categoría, con filtros opcionales.
 * @access Private (Admin)
 * @query category (string, required): La categoría a analizar.
 * @query channel (string, optional): 'pedidos', 'presencial', o 'todos' (defecto).
 * @query startDate (string, optional): Fecha de inicio (YYYY-MM-DD).
 * @query endDate (string, optional): Fecha de fin (YYYY-MM-DD).
 */
router.get('/kpi/category-kpis', protect, authorize('admin'), getCategoryKpis);

module.exports = router;
