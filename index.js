const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Rutas que sí existen y se van a utilizar
const productoRoutes = require('./src/routes/productos.routes');
const clienteRoutes = require('./src/routes/clientes.routes');
const authRoutes = require('./src/routes/auth.routes');
const pedidoRoutes = require('./src/routes/pedidos.routes');
const usuariosRoutes = require('./src/routes/usuarios.routes');
const dashboardRoutes = require('./src/routes/dashboard.routes');
const logRoutes = require('./src/routes/logs.routes');
const importRoutes = require('./src/routes/import.routes');
const categoriaRoutes = require('./src/routes/categorias.routes');
const borradoresRoutes = require('./src/routes/borradores.routes');
const kpiRoutes = require('./src/routes/kpi.routes.js');
const diagnosticsRoutes = require('./src/routes/diagnostics.routes');
const listasPreciosRoutes = require('./src/routes/listas-precios.routes');


const app = express();
const PORT = process.env.API_PORT || 4000;

// --- Middlewares ---
// Se deja la configuración de CORS más simple, ya que Traefik se encarga del resto.
app.use(cors()); 
app.use(express.json({ limit: '10mb' }));


// Ruta principal para verificar que la API está funcionando
app.get('/', (req, res) => {
  res.json({ message: "API de Distribuidora funcionando correctamente." });
});


// Usar todas las rutas de la API
app.use('/api', authRoutes);
app.use('/api', pedidoRoutes);
app.use('/api', productoRoutes);
app.use('/api', clienteRoutes);
app.use('/api', usuariosRoutes);
app.use('/api', dashboardRoutes);
app.use('/api', logRoutes);
app.use('/api', importRoutes);
app.use('/api', categoriaRoutes);
app.use('/api', borradoresRoutes);
app.use('/api', kpiRoutes);
app.use('/api', diagnosticsRoutes);
app.use('/api', listasPreciosRoutes);


// Iniciar el servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
