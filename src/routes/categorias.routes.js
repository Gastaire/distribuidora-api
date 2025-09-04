const { Router } = require('express');
const { 
    renameCategoria,
    manageProducts
} = require('../controllers/categorias.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = Router();

// Todas las rutas de gestión de categorías son solo para administradores.
// Usamos protect para asegurar que el usuario esté logueado y authorize('admin') para verificar su rol.

/**
 * @route PUT /api/categorias/rename
 * @desc Renombrar una categoría existente.
 * @access Private (Admin)
 */
router.put('/categorias/rename', protect, authorize('admin'), renameCategoria);

/**
 * @route PUT /api/categorias/manage-products
 * @desc Gestiona masivamente los productos asignados a una categoría.
 * @access Private (Admin)
 */
router.put('/categorias/manage-products', protect, authorize('admin'), manageProducts);


module.exports = router;
