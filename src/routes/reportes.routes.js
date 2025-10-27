const express = require('express');
const router = express.Router();
const { getReporteFaltantes } = require('../controllers/reportes.controller');
// --- INICIO DE LA CORRECCIÓN ---
// 1. Ruta corregida a 'middleware' (singular).
// 2. Importamos las funciones 'protect' y 'authorize' directamente.
const { protect, authorize } = require('../middleware/auth.middleware');
// --- FIN DE LA CORRECCIÓN ---

// Definimos la ruta para obtener el reporte de faltantes.
// --- INICIO DE LA CORRECCIÓN: Usamos las funciones correctas ---
// Primero 'protect' para asegurar que hay un token válido.
// Luego 'authorize('admin')' para asegurar que el rol sea administrador.
router.get('/reportes/faltantes-diario', protect, authorize('admin'), getReporteFaltantes);
// --- FIN DE LA CORRECCIÓN ---

module.exports = router;
