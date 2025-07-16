// Archivo: index.js

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
const logRoutes = require('./src/routes/logs.routes');

const app = express();
const PORT = process.env.API_PORT || 4000;

// --- Middlewares ---

// --- CONFIGURACIÓN DE CORS CORREGIDA ---
// Definimos las opciones para CORS de forma más segura
const corsOptions = {
  origin: 'https://distrimaxi.onzacore.site', // Solo permite peticiones desde tu frontend
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Métodos HTTP permitidos
  allowedHeaders: ['Content-Type', 'Authorization'], // Headers permitidos en las peticiones
  optionsSuccessStatus: 200 // Para compatibilidad con navegadores antiguos
};

// Habilitamos CORS con nuestra configuración
app.use(cors(corsOptions));

// Habilitamos el "pre-flight" para todas las rutas. El navegador envía una
// petición OPTIONS antes de peticiones complejas (como POST o PUT) para
// verificar los permisos de CORS. Esta línea es crucial.
app.options('*', cors(corsOptions));

app.use(express.json());

// Ruta principal para debug
app.get('/', (req, res) => {
  res.json({ message: "API de Distribuidora funcionando correctamente." });
});

// Usar las rutas de la API
app.use('/api', authRoutes);
app.use('/api', pedidoRoutes);
app.use('/api', productoRoutes);
app.use('/api', clienteRoutes);
app.use('/api', usuariosRoutes);
app.use('/api', dashboardRoutes);
app.use('/api', logRoutes);

// Iniciar el servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
