const express = require('express');
const router = express.Router();
const { getReporteFaltantes } = require('../controllers/reportes.controller');
const authMiddleware = require('../middlewares/auth.middleware'); // Usamos el middleware para proteger la ruta

// Definimos la ruta para obtener el reporte de faltantes.
// Solo los admins podrán acceder a este endpoint.
router.get('/reportes/faltantes-diario', authMiddleware.verifyToken, authMiddleware.isAdmin, getReporteFaltantes);

module.exports = router;
