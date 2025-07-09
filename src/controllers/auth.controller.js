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

// INICIAR SESIÓN
const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    // Buscar usuario por email
    const { rows } = await db.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    const user = rows[0];

    if (!user) {
      return res.status(401).json({ message: 'Credenciales inválidas' }); // Mensaje genérico por seguridad
    }

    // Comparar contraseña
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    // Crear el token JWT
    const payload = {
      user: {
        id: user.id,
        rol: user.rol,
      },
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: '7d', // El token expirará en 7 días
    });

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

module.exports = {
  register,
  login,
};
