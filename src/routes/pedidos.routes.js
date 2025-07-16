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

// --- CORRECCIÓN: Configuración de CORS con Lista Blanca (Más Seguro) ---
const whitelist = ['https://distrimaxi.onzacore.site', 'https://vendedor.onzacore.site']; // Tus dominios permitidos
const corsOptions = {
  origin: function (origin, callback) {
    // Permite peticiones si el origen está en la lista blanca o si no hay origen (ej: Postman, apps móviles)
    if (whitelist.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(new Error('No permitido por CORS'));
    }
  },
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  allowedHeaders: 'Content-Type,Authorization'
};

// Middlewares
app.use(cors(corsOptions)); // Usamos la nueva configuración segura
app.use(express.json());


// Ruta principal para debug
app.get('/', (req, res) => {
    // ... (el resto de la función de debug queda igual)
});

// Usar las rutas de la API
app.use('/api', authRoutes);
app.use('/api', pedidoRoutes);
app.use('/api', productoRoutes);
app.use('/api', clienteRoutes);
// app.use('/api', logRoutes); // Se quita si no existe el archivo
app.use('/api', usuariosRoutes);
app.use('/api', dashboardRoutes);


// Iniciar el servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
