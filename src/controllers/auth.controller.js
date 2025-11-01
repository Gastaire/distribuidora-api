const db = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// REGISTRAR un nuevo usuario
const register = async (req, res) => {
  const { nombre, email, password, rol } = req.body;

  try {
    // Encriptar la contraseña
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    // Guardar usuario en la base de datos
    const { rows } = await db.query(
      'INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ($1, $2, $3, $4) RETURNING id, nombre, email, rol',
      [nombre, email, password_hash, rol]
    );

    res.status(201).json({
      message: 'Usuario registrado exitosamente',
      user: rows[0],
    });
  } catch (error) {
    console.error('Error en el registro:', error);
    // Manejar error de email duplicado
    if (error.code === '23505') {
        return res.status(400).json({ message: 'El correo electrónico ya está registrado.' });
    }
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// INICIAR SESIÓN (CORREGIDO)
const login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const { rows } = await db.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    // CORRECCIÓN: Añadimos el nombre del usuario al "pasaporte" (token)
    const payload = {
      user: {
        id: user.id,
        rol: user.rol,
        nombre: user.nombre // <-- AÑADIDO
      },
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '365d' });

    res.json({
      message: 'Inicio de sesión exitoso',
      token,
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        rol: user.rol
      }
    });
  } catch (error) {
    console.error('Error en el login:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

const reauthenticate = async (req, res) => {
  const { password } = req.body;
  const userId = req.user.id; // Obtenemos el ID del usuario ya logueado

  if (!password) {
      return res.status(400).json({ message: 'Se requiere contraseña.' });
  }

  try {
    const { rows } = await db.query('SELECT password_hash FROM usuarios WHERE id = $1', [userId]);
    const user = rows[0];

    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: 'La contraseña es incorrecta.' });
    }

    res.status(200).json({ success: true, message: 'Autenticación correcta.' });

  } catch (error) {
    console.error('Error en la re-autenticación:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};


module.exports = {
  register,
  login,
  reauthenticate // <-- Añadir la nueva función aquí
};
