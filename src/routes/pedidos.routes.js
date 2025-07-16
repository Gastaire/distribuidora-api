const { Router } = require('express');

// CORRECCIÓN: Importamos las funciones que faltaban
const {
    createPedido,
    getPedidos,
    getPedidoById,
    updatePedidoEstado,
    updatePedidoItems, // Asegurarse de que esta también esté
    archivePedido,
    cleanupArchivedPedidos 
} = require('../controllers/pedidos.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = Router();

// --- Rutas existentes ---
router.post('/pedidos', protect, authorize('vendedor', 'admin'), createPedido);
router.get('/pedidos', protect, getPedidos);
router.get('/pedidos/:id', protect, getPedidoById);

// CORRECCIÓN: La ruta de estado ahora la pueden usar admin y deposito
router.put('/pedidos/:id/estado', protect, authorize('admin', 'deposito'), updatePedidoEstado);

// --- Rutas que estaban en pedido_items.routes.js y ahora se integran aquí ---
router.put('/pedidos/:id/items', protect, authorize('admin'), updatePedidoItems);

// --- NUEVAS RUTAS AÑADIDAS ---
// Solo un admin puede archivar un pedido
router.put('/pedidos/:id/archive', protect, authorize('admin'), archivePedido);

// Ruta para limpieza de archivados, solo para admin
router.delete('/pedidos/cleanup-archived', protect, authorize('admin'), cleanupArchivedPedidos);


module.exports = router;
