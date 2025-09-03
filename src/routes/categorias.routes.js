const { Router } = require('express');
const { 
    getCategorias, 
    renameCategoria, 
    assignProductosToCategoria,
    deleteCategoria 
} = require('../controllers/categorias.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = Router();

// Todas las rutas de gestión de categorías son solo para administradores.
// Usamos protect para asegurar que el usuario esté logueado y authorize('admin') para verificar su rol.

/**
 * @route GET /api/categorias
 * @desc Obtener una lista de todas las categorías únicas.
 * @access Private (Admin)
 */
router.get('/categorias', protect, authorize('admin'), getCategorias);

/**
 * @route PUT /api/categorias/rename
 * @desc Renombrar una categoría existente.
 * @access Private (Admin)
 */
router.put('/categorias/rename', protect, authorize('admin'), renameCategoria);

/**
 * @route PUT /api/categorias/assign
 * @desc Asignar un lote de productos a una categoría.
 * @access Private (Admin)
 */
router.put('/categorias/assign', protect, authorize('admin'), assignProductosToCategoria);

/**
 * @route DELETE /api/categorias/:name
 * @desc Eliminar una categoría (desasigna los productos).
 * @access Private (Admin)
 */
router.delete('/categorias/:name', protect, authorize('admin'), deleteCategoria);


module.exports = router;
