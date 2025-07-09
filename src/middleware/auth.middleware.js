const jwt = require('jsonwebtoken');

const protect = (req, res, next) => {
    let token;
    // El token se enviará en el header 'Authorization' como 'Bearer <token>'
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            // Obtener token del header
            token = req.headers.authorization.split(' ')[1];

            // Verificar token
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            // Adjuntar los datos del usuario (payload del token) al objeto request
            req.user = decoded.user;

            next(); // Si todo está bien, continuamos a la siguiente función (el controlador)
        } catch (error) {
            console.error(error);
            return res.status(401).json({ message: 'No autorizado, el token falló' });
        }
    }

    if (!token) {
        return res.status(401).json({ message: 'No autorizado, no se encontró un token' });
    }
};

const authorize = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.rol)) {
            return res.status(403).json({ 
                message: `El rol '${req.user.rol}' no tiene permiso para realizar esta acción` 
            });
        }
        next();
    };
};

module.exports = { protect, authorize };
