const { Router } = require('express');
const { register, login, reauthenticate } = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth.middleware');

const router = Router();

router.post('/auth/register', register);
router.post('/auth/login', login);
router.post('/auth/reauthenticate', protect, reauthenticate);

module.exports = router;
