const express = require('express');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const User = require('../models/User');
const OTP = require('../models/OTP');
const { protect, generateToken } = require('../middleware/auth');
const { sendOTPEmail } = require('../controllers/emailService');

const router = express.Router();

const registerValidation = [
  body('name').trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
];

// ─── POST /api/auth/send-register-otp ────────────────────────────────────────
// Step 1: Validate details + send OTP before creating account
router.post('/send-register-otp', registerValidation, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { name, email } = req.body;

    // Check if email already registered
    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });

    // Delete any old OTPs for this email
    await OTP.deleteMany({ email });

    // Generate and save OTP
    const otp = crypto.randomInt(100000, 999999).toString();
    await OTP.create({ email, otp });

    // Send OTP email
    await sendOTPEmail(email, otp, name);
    console.log('📧 Registration OTP sent to:', email);

    res.json({
      message: 'OTP sent to your email. Please verify to complete registration.',
      
    });
  } catch (err) {
    console.error('❌ Send register OTP error:', err.message);
    if (err.code === 'EAUTH' || err.responseCode === 535) {
      return res.status(503).json({ error: 'Email service not configured. Check EMAIL_USER and EMAIL_PASS in backend/.env' });
    }
    next(err);
  }
});

// ─── POST /api/auth/verify-register-otp ──────────────────────────────────────
// Step 2: Verify OTP then create account
router.post('/verify-register-otp', [
  body('name').trim().isLength({ min: 2 }),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('otp').isLength({ min: 6, max: 6 }),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { name, email, password, otp } = req.body;

    // Check again if user already exists (race condition guard)
    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });

    // Find OTP record
    const otpRecord = await OTP.findOne({ email, isUsed: false });
    if (!otpRecord) return res.status(400).json({ error: 'OTP not found or expired. Please request a new one.' });

    // Check attempts
    if (otpRecord.attempts >= 5) {
      await OTP.deleteOne({ _id: otpRecord._id });
      return res.status(400).json({ error: 'Too many failed attempts. Please request a new OTP.' });
    }

    // Check expiry
    if (otpRecord.expiresAt < new Date()) {
      await OTP.deleteOne({ _id: otpRecord._id });
      return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
    }

    // Check OTP match
    if (otpRecord.otp !== otp) {
      await OTP.findByIdAndUpdate(otpRecord._id, { $inc: { attempts: 1 } });
      const remaining = 4 - otpRecord.attempts;
      return res.status(400).json({ error: `Incorrect OTP. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.` });
    }

    // OTP valid — create user
    await OTP.deleteMany({ email });
    const user = await User.create({ name, email, password, isEmailVerified: true });
    const token = generateToken(user._id);

    console.log('✅ New user registered:', email);

    res.status(201).json({
      message: 'Account created successfully!',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        plan: user.plan,
        generationsUsed: user.generationsUsed,
        generationsLimit: user.generationsLimit,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/resend-register-otp ──────────────────────────────────────
router.post('/resend-register-otp', [body('email').isEmail().normalizeEmail()], async (req, res, next) => {
  try {
    const { email, name } = req.body;

    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ error: 'This email is already registered.' });

    // Rate limit: 60 seconds between resends
    const recentOTP = await OTP.findOne({ email, isUsed: false });
    if (recentOTP) {
      const secondsSinceSent = (Date.now() - (recentOTP.expiresAt.getTime() - 10 * 60 * 1000)) / 1000;
      if (secondsSinceSent < 60) {
        const wait = Math.ceil(60 - secondsSinceSent);
        return res.status(429).json({ error: `Please wait ${wait} seconds before requesting a new OTP.` });
      }
    }

    await OTP.deleteMany({ email });
    const otp = crypto.randomInt(100000, 999999).toString();
    await OTP.create({ email, otp });
    await sendOTPEmail(email, otp, name || 'User');

    res.json({
      message: 'New OTP sent to your email.',
      
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/register (legacy direct register — kept for compatibility) 
router.post('/register', registerValidation, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { name, email, password } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(409).json({ error: 'An account with this email already exists.' });
    const user = await User.create({ name, email, password });
    const token = generateToken(user._id);
    res.status(201).json({
      message: 'Account created successfully!', token,
      user: { id: user._id, name: user.name, email: user.email, plan: user.plan, generationsUsed: user.generationsUsed, generationsLimit: user.generationsLimit },
    });
  } catch (err) { next(err); }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+password');
    if (!user) return res.status(401).json({ error: 'Invalid email or password.' });
    const isMatch = await user.comparePassword(password);
    if (!isMatch) return res.status(401).json({ error: 'Invalid email or password.' });
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });
    const token = generateToken(user._id);
    res.json({
      message: 'Logged in successfully!', token,
      user: { id: user._id, name: user.name, email: user.email, plan: user.plan, generationsUsed: user.generationsUsed, generationsLimit: user.generationsLimit },
    });
  } catch (err) { next(err); }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', protect, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    res.json({ user: { id: user._id, name: user.name, email: user.email, plan: user.plan, generationsUsed: user.generationsUsed, generationsLimit: user.generationsLimit, generationsRemaining: user.generationsRemaining, createdAt: user.createdAt } });
  } catch (err) { next(err); }
});

// ─── PUT /api/auth/profile ────────────────────────────────────────────────────
router.put('/profile', protect, async (req, res, next) => {
  try {
    const { name } = req.body;
    const user = await User.findByIdAndUpdate(req.user.id, { name }, { new: true, runValidators: true });
    res.json({ message: 'Profile updated!', user: { id: user._id, name: user.name, email: user.email, plan: user.plan } });
  } catch (err) { next(err); }
});

module.exports = router;
