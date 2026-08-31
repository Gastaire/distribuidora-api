const { Router } = require('express');
const { getUsuarios, createUsuario, updateUsuario, deleteUsuario, restoreUsuario } = require('../controllers/usuarios.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = Router();

// Todas las rutas de gestión de usuarios son solo para administradores
router.get('/usuarios', protect, authorize('admin'), getUsuarios);
router.post('/usuarios', protect, authorize('admin'), createUsuario);
router.put('/usuarios/:id', protect, authorize('admin'), updateUsuario);
router.delete('/usuarios/:id', protect, authorize('admin'), deleteUsuario);
router.put('/usuarios/:id/restore', protect, authorize('admin'), restoreUsuario);

module.exports = router;
