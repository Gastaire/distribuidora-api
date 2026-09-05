const { Router } = require('express');
const {
  getClientes,
  getClienteById,
  createCliente,
  updateCliente,
  deleteCliente,
  updateZonaManual,
} = require('../controllers/clientes.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = Router();

// Todos los usuarios logueados pueden ver la lista de clientes y detalles
router.get('/clientes', protect, getClientes);
router.get('/clientes/:id', protect, getClienteById);

// Los administradores Y vendedores pueden crear y actualizar clientes
router.post('/clientes', protect, authorize('admin', 'vendedor'), createCliente);
router.put('/clientes/:id', protect, authorize('admin', 'vendedor'), updateCliente);

// Solo los administradores pueden eliminar clientes o sobreescribir zonas manualmente
router.delete('/clientes/:id', protect, authorize('admin'), deleteCliente);
router.patch('/clientes/:id/zona', protect, authorize('admin'), updateZonaManual);

module.exports = router;
