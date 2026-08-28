const { Router } = require('express');
const { getCronograma, updateDiaCronograma, repeatCronogramaPattern } = require('../controllers/config.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = Router();

// El cronograma puede ser leído por vendedores (para mostrar en la app) y por administradores.
router.get('/config/cronograma', protect, authorize('admin', 'vendedor', 'deposito'), getCronograma);

// Solo el admin puede modificar el cronograma
router.put('/config/cronograma', protect, authorize('admin'), updateDiaCronograma);
router.post('/config/cronograma/repetir', protect, authorize('admin'), repeatCronogramaPattern);

module.exports = router;
