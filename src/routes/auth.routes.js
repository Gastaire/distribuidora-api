const { Router } = require('express');
// CORRECCIÓN: Importamos la función que faltaba y el middleware
const { register, login, reauthenticate } = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth.middleware');

const router = Router();

router.post('/auth/register', register);
router.post('/auth/login', login);

// LÍNEA AÑADIDA: Esta es la ruta que resuelve el error 404
router.post('/auth/reauthenticate', protect, reauthenticate);

module.exports = router;
