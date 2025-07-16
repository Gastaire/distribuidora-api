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

// ** SOLUCIÓN DEFINITIVA PARA CORS **
// 1. Manejar las solicitudes pre-vuelo (OPTIONS) de forma explícita
app.options('*', cors()); // Habilita cors para todas las rutas en las peticiones OPTIONS

// 2. Usar la configuración de CORS para todas las demás peticiones
const whitelist = ['https://distrimaxi.onzacore.site', 'https://vendedor.onzacore.site'];
const corsOptions = {
  origin: function (origin, callback) {
    if (whitelist.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(new Error('No permitido por CORS'));
    }
  },
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  allowedHeaders: 'Content-Type,Authorization'
};
app.use(cors(corsOptions));

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
