const cors = require('cors');
require('dotenv').config();

// Rutas
const productoRoutes = require('./src/routes/productos.routes');
const clienteRoutes = require('./src/routes/clientes.routes');
const authRoutes = require('./src/routes/auth.routes');
const pedidoItemsRoutes = require('./src/routes/pedido_items.routes');
const pedidoRoutes = require('./src/routes/pedidos.routes');
const logRoutes = require('./src/routes/logs.routes');
const usuariosRoutes = require('./src/routes/usuarios.routes');
const dashboardRoutes = require('./src/routes/dashboard.routes');
const usuariosRoutes = require('./src/routes/usuarios.routes'); // <-- AÑADIR


const app = express();
const PORT = process.env.API_PORT || 4000;
@@ -35,16 +36,15 @@ app.get('/', (req, res) => {
  res.json(debugEnv);
});

// Usar las rutas de la API
// ** CORRECCIÓN: Usar TODAS las rutas de la API **
app.use('/api', authRoutes);
app.use('/api', pedidoRoutes);
app.use('/api', pedidoItemsRoutes);
app.use('/api', productoRoutes);
app.use('/api', clienteRoutes);
app.use('/api', logRoutes);
app.use('/api', usuariosRoutes);
app.use('/api', dashboardRoutes);
app.use('/api', usuariosRoutes); // <-- AÑADIR
app.use('/api', authRoutes); // <-- ESTA LÍNEA ES LA CLAVE
