const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  try {
    // 1. Extract token from header
    let token;
    if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ error: 'Not authorized. No token provided.' });
    }

    // 2. Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 3. Find user
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({ error: 'User no longer exists.' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token.' });
    }
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired. Please log in again.' });
    }
    next(err);
  }
};

// Check if user has remaining AI generations
const checkGenerationLimit = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (user.generationsUsed >= user.generationsLimit) {
      return res.status(403).json({
        error: 'Generation limit reached.',
        message: `You've used all ${user.generationsLimit} generations for your ${user.plan} plan. Please upgrade to continue.`,
        plan: user.plan,
        used: user.generationsUsed,
        limit: user.generationsLimit,
      });
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d',
  });
};

module.exports = { protect, checkGenerationLimit, generateToken };
