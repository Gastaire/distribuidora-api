const { Router } = require('express');
const { saveBorrador, getBorradores } = require('../controllers/borradores.controller');
const { protect } = require('../middleware/auth.middleware');

const router = Router();

// Ambas rutas están protegidas, solo un usuario logueado puede acceder a sus borradores.
// Usamos protect, pero no authorize, porque cada usuario (vendedor) maneja sus propios datos.

// Ruta para guardar/actualizar un borrador
router.post('/borradores', protect, saveBorrador);

// Ruta para obtener todos los borradores del usuario logueado
router.get('/borradores', protect, getBorradores);

module.exports = router;
