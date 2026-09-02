const { Router } = require('express');
const { getCronograma, updateDiaCronograma, repeatCronogramaPattern } = require('../controllers/config.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = Router();

// El cronograma puede ser leído por cualquier usuario autenticado (vendedores, admin, depósito)
router.get('/config/cronograma', protect, getCronograma);
// ALIAS para la app de ventas para sortear WAF o proxys que bloqueen la palabra /config/
router.get('/cronograma', protect, getCronograma);

// Solo el admin puede modificar el cronograma
router.put('/config/cronograma', protect, authorize('admin'), updateDiaCronograma);
router.post('/config/cronograma/repetir', protect, authorize('admin'), repeatCronogramaPattern);

module.exports = router;
