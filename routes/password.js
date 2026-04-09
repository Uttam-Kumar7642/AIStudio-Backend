const express = require('express');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const OTP = require('../models/OTP');
const { sendOTPEmail } = require('../controllers/emailService');

const router = express.Router();
const generateOTP = () => crypto.randomInt(100000, 999999).toString();

// POST /api/password/forgot
router.post('/forgot', [body('email').isEmail().normalizeEmail()], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.json({ message: 'If an account exists with this email, you will receive an OTP shortly.' });

    await OTP.deleteMany({ email });
    const otp = generateOTP();
    await OTP.create({ email, otp });
    await sendOTPEmail(email, otp, user.name);

    console.log('📧 OTP sent to:', email);
    res.json({
      message: 'OTP sent to your email.',
      
    });
  } catch (err) {
    console.error('❌ Forgot password error:', err.message);
    if (err.code === 'EAUTH' || err.responseCode === 535) {
      return res.status(503).json({ error: 'Email service not configured. Check EMAIL_USER and EMAIL_PASS in backend/.env' });
    }
    next(err);
  }
});

// POST /api/password/verify-otp
router.post('/verify-otp', [body('email').isEmail().normalizeEmail(), body('otp').isLength({ min: 6, max: 6 })], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { email, otp } = req.body;
    const otpRecord = await OTP.findOne({ email, isUsed: false });

    if (!otpRecord) return res.status(400).json({ error: 'OTP not found or already used. Please request a new one.' });
    if (otpRecord.attempts >= 5) {
      await OTP.deleteOne({ _id: otpRecord._id });
      return res.status(400).json({ error: 'Too many failed attempts. Please request a new OTP.' });
    }
    if (otpRecord.expiresAt < new Date()) {
      await OTP.deleteOne({ _id: otpRecord._id });
      return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
    }
    if (otpRecord.otp !== otp) {
      await OTP.findByIdAndUpdate(otpRecord._id, { $inc: { attempts: 1 } });
      const remaining = 4 - otpRecord.attempts;
      return res.status(400).json({ error: `Incorrect OTP. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.` });
    }

    await OTP.findByIdAndUpdate(otpRecord._id, { isUsed: true });
    const resetToken = crypto.randomBytes(32).toString('hex');
    await OTP.create({ email, otp: resetToken, expiresAt: new Date(Date.now() + 15 * 60 * 1000), isUsed: false });

    res.json({ message: 'OTP verified successfully.', resetToken });
  } catch (err) { next(err); }
});

// POST /api/password/reset
router.post('/reset', [
  body('email').isEmail().normalizeEmail(),
  body('resetToken').notEmpty(),
  body('password').isLength({ min: 6 }),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { email, resetToken, password } = req.body;
    const tokenRecord = await OTP.findOne({ email, otp: resetToken, isUsed: false });

    if (!tokenRecord) return res.status(400).json({ error: 'Invalid or expired reset token. Please start over.' });
    if (tokenRecord.expiresAt < new Date()) {
      await OTP.deleteOne({ _id: tokenRecord._id });
      return res.status(400).json({ error: 'Reset session expired. Please request a new OTP.' });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'User not found.' });

    user.password = password;
    await user.save();
    await OTP.deleteMany({ email });

    console.log('✅ Password reset for:', email);
    res.json({ message: 'Password reset successfully! You can now log in.' });
  } catch (err) { next(err); }
});

// POST /api/password/resend-otp
router.post('/resend-otp', [body('email').isEmail().normalizeEmail()], async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.json({ message: 'If an account exists, a new OTP has been sent.' });

    const recentOTP = await OTP.findOne({ email, isUsed: false });
    if (recentOTP) {
      const secondsSinceSent = (Date.now() - (recentOTP.expiresAt.getTime() - 10 * 60 * 1000)) / 1000;
      if (secondsSinceSent < 60) {
        const wait = Math.ceil(60 - secondsSinceSent);
        return res.status(429).json({ error: `Please wait ${wait} seconds before requesting a new OTP.` });
      }
    }

    await OTP.deleteMany({ email });
    const otp = generateOTP();
    await OTP.create({ email, otp });
    await sendOTPEmail(email, otp, user.name);

    res.json({
      message: 'New OTP sent to your email.',
      
    });
  } catch (err) { next(err); }
});

module.exports = router;
