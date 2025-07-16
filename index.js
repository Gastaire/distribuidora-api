const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Rutas
const productoRoutes = require('./src/routes/productos.routes');
const clienteRoutes = require('./src/routes/clientes.routes');
const authRoutes = require('./src/routes/auth.routes');
const pedidoRoutes = require('./src/routes/pedidos.routes');
const usuariosRoutes = require('./src/routes/usuarios.routes');
const dashboardRoutes = require('./src/routes/dashboard.routes');


const app = express();
const PORT = process.env.API_PORT || 4000;

// --- Middlewares ---
// Dejamos solo la configuración básica, ya que Traefik hace el trabajo pesado
app.use(cors()); 
app.use(express.json());


// Ruta principal para debug
app.get('/', (req, res) => {
    // ... (función de debug sin cambios)
});

// Usar las rutas de la API
app.use('/api', authRoutes);
app.use('/api', pedidoRoutes);
app.use('/api', productoRoutes);
app.use('/api', clienteRoutes);
app.use('/api', usuariosRoutes);
app.use('/api', dashboardRoutes);

// Eliminamos la referencia a logRoutes si el archivo no se va a usar
// app.use('/api', logRoutes); 


// Iniciar el servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
