const { Router } = require('express');
const {
    getListasDePrecios,
    getListaDePreciosById,
    createListaDePrecios,
    setListaActiva,
    // --- AÑADIR ESTA LÍNEA ---
    getAllDataForSync
} = require('../controllers/listas-precios.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = Router();

// --- INICIO DE LA NUEVA RUTA PARA VENDEDORES ---

/**
 * @route GET /api/listas-precios/sync-data
 * @desc Obtiene todas las listas de precios y sus items para la sincronización.
 * @access Private (Vendedor/Admin) - Esencial para que la app del vendedor funcione.
 */
router.get('/listas-precios/sync-data', protect, authorize('vendedor', 'admin'), getAllDataForSync);

// --- FIN DE LA NUEVA RUTA ---


// Todas las rutas de gestión de listas de precios son solo para administradores.
// Usamos protect para asegurar que el usuario esté logueado y authorize('admin') para verificar su rol.

/**
 * @route GET /api/listas-precios
 * @desc Obtiene un resumen de todas las listas de precios.
 * @access Private (Admin)
 */
router.get('/listas-precios', protect, authorize('admin'), getListasDePrecios);

/**
 * @route GET /api/listas-precios/:id
 * @desc Obtiene una lista de precios específica con todos sus productos y precios.
 * @access Private (Admin)
 */
router.get('/listas-precios/:id', protect, authorize('admin'), getListaDePreciosById);

/**
 * @route POST /api/listas-precios
 * @desc Crea una nueva lista de precios, opcionalmente duplicando una existente.
 * @access Private (Admin)
 */
router.post('/listas-precios', protect, authorize('admin'), createListaDePrecios);

/**
 * @route PUT /api/listas-precios/:id/activar
 * @desc Marca una lista de precios como la activa, desactivando las demás.
 * @access Private (Admin)
 */
router.put('/listas-precios/:id/activar', protect, authorize('admin'), setListaActiva);

module.exports = router;
