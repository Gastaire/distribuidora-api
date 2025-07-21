const { Router } = require('express');
const multer = require('multer');
const { importVentasPresenciales } = require('../controllers/import.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Esta es la ruta que usará el panel para subir el archivo CSV
router.post('/import/ventas-presenciales', protect, authorize('admin'), upload.single('file'), importVentasPresenciales);

module.exports = router;
