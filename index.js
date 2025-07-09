const express = require('express');
const cors = require('cors');
require('dotenv').config();

const productoRoutes = require('./src/routes/productos.routes');
const clienteRoutes = require('./src/routes/clientes.routes');
const authRoutes = require('./src/routes/auth.routes');
const pedidoItemsRoutes = require('./src/routes/pedido_items.routes');
const pedidoRoutes = require('./src/routes/pedidos.routes');
const logRoutes = require('./src/routes/logs.routes');

const app = express();
const PORT = process.env.API_PORT || 4000;

// Middlewares
app.use(cors());
app.use(express.json());

// Ruta principal MODIFICADA PARA DEBUG
app.get('/', (req, res) => {
  // Creamos un objeto con las variables que nos interesan
  const debugEnv = {
    MESSAGE: "Variables de entorno leídas por la API:",
    DB_USER: process.env.DB_USER || "No definida",
    DB_HOST: process.env.DB_HOST || "No definida",
    DB_DATABASE: process.env.DB_DATABASE || "No definida",
    DB_PASSWORD_IS_SET: !!process.env.DB_PASSWORD, // Mostramos si está definida, no el valor
    DB_PASSWORD_LENGTH: process.env.DB_PASSWORD ? process.env.DB_PASSWORD.length : 0, // Mostramos la longitud
    DB_PORT: process.env.DB_PORT || "No definida",
    API_PORT: process.env.API_PORT || "No definida",
    JWT_SECRET_IS_SET: !!process.env.JWT_SECRET
  };

  // Devolvemos las variables como un JSON para poder verlas en el navegador
  res.json(debugEnv);
});

// Rutas de la API
app.use('/api', authRoutes);
app.use('/api', pedidoRoutes);
app.use('/api', pedidoItemsRoutes); // <-- AÑADIDO
app.use('/api', productoRoutes);
app.use('/api', clienteRoutes);

// Iniciar el servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
