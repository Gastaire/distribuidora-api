const multer = require('multer');
const { importProductos } = require('../controllers/productos.controller');
const upload = multer({ storage: multer.memoryStorage() }); // Guardará el archivo en memoria
const { Router } = require('express');
const {
  getProductos,
  getProductoById,
  createProducto,
  updateProducto,
  deleteProducto,
  restoreProducto, // --- INICIO DE LA MODIFICACIÓN: Importar la nueva función
} = require('../controllers/productos.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = Router();

// Todos los usuarios logueados pueden ver la lista de productos
router.get('/productos', protect, getProductos);
router.get('/productos/:id', protect, getProductoById);

// Solo los administradores pueden crear, actualizar o borrar productos
router.post('/productos', protect, authorize('admin'), createProducto);
router.put('/productos/:id', protect, authorize('admin'), updateProducto);
router.delete('/productos/:id', protect, authorize('admin'), deleteProducto);

// --- INICIO DE LA MODIFICACIÓN: Añadir la nueva ruta para restaurar ---
router.put('/productos/:id/restore', protect, authorize('admin'), restoreProducto);
// --- FIN DE LA MODIFICACIÓN ---

router.post('/productos/import', protect, authorize('admin'), upload.single('file'), importProductos);

module.exports = router;
