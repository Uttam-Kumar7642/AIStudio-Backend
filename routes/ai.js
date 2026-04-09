const express = require('express');
const { body, validationResult } = require('express-validator');
const { protect, checkGenerationLimit } = require('../middleware/auth');
const { generateContent, generateSuggestions } = require('../controllers/aiService');
const Document = require('../models/Document');
const User = require('../models/User');

const router = express.Router();
router.use(protect);

router.post('/generate', checkGenerationLimit,
  [body('type').isIn(['resume', 'blog']), body('data').isObject()],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { type, data, title } = req.body;
      const { content, prompt } = await generateContent(type, data);

      const document = await Document.create({
        userId: req.user._id,
        title: title || (type === 'resume' ? `${data.name || 'My'} Resume` : data.topic || 'New Blog Post'),
        type, content, prompt,
        metadata: { ...data, language: data.language || 'English' },
      });

      await User.findByIdAndUpdate(req.user._id, { $inc: { generationsUsed: 1 } });

      res.status(201).json({
        message: 'Generated successfully!',
        document: { id: document._id, title: document.title, type: document.type, content: document.content, createdAt: document.createdAt },
      });
    } catch (err) {
      console.error('❌ AI Error:', err?.message || err);
      if (err?.status === 401) return res.status(503).json({ error: 'Invalid API key. Check OPENAI_API_KEY in backend/.env' });
      if (err?.status === 429 || err?.code === 'insufficient_quota') return res.status(503).json({ error: 'OpenAI quota exceeded. Add credits at platform.openai.com or switch to Gemini.' });
      if (err?.message?.includes('not set')) return res.status(503).json({ error: err.message });
      next(err);
    }
  }
);

router.post('/suggestions', async (req, res, next) => {
  try {
    const { content, type } = req.body;
    if (!content) return res.status(400).json({ error: 'Content is required' });
    const suggestions = await generateSuggestions(content, type || 'document');
    res.json({ suggestions });
  } catch (err) {
    console.error('❌ Suggestions Error:', err?.message);
    next(err);
  }
});

module.exports = router;
