const express = require('express');
const PDFDocument = require('pdfkit');
const { protect } = require('../middleware/auth');
const Document = require('../models/Document');

const router = express.Router();
router.use(protect);

// ─── GET /api/documents ───────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { type, page = 1, limit = 10, search, favorite } = req.query;
    const query = { userId: req.user._id };

    if (type && ['resume', 'blog'].includes(type)) query.type = type;
    if (favorite === 'true') query.isFavorite = true;
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { content: { $regex: search, $options: 'i' } },
      ];
    }

    const total = await Document.countDocuments(query);
    const documents = await Document.find(query)
      .select('-content') // Don't return full content in list
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({
      documents,
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
        limit: Number(limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/documents/:id ───────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!document) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    res.json({ document });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/documents ──────────────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const { title, type, content, metadata, tags } = req.body;

    const document = await Document.create({
      userId: req.user._id,
      title: title || 'Untitled Document',
      type,
      content,
      metadata,
      tags,
    });

    res.status(201).json({ message: 'Document created!', document });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/documents/:id ───────────────────────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const { title, content, metadata, tags, isFavorite } = req.body;

    const document = await Document.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      {
        title,
        content,
        metadata,
        tags,
        isFavorite,
        $inc: { version: 1 },
      },
      { new: true, runValidators: true }
    );

    if (!document) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    res.json({ message: 'Document saved!', document });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/documents/:id ────────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const document = await Document.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { isDeleted: true },
      { new: true }
    );

    if (!document) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    res.json({ message: 'Document deleted successfully.' });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/documents/:id/export/pdf ───────────────────────────────────────
router.get('/:id/export/pdf', async (req, res, next) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!document) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    // Strip HTML tags for PDF text
    const plainText = document.content
      .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n\n$1\n' + '='.repeat(50) + '\n')
      .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n\n$1\n' + '-'.repeat(30) + '\n')
      .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n\n$1\n')
      .replace(/<li[^>]*>(.*?)<\/li>/gi, '\n  • $1')
      .replace(/<p[^>]*>(.*?)<\/p>/gi, '\n$1\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '$1')
      .replace(/<em[^>]*>(.*?)<\/em>/gi, '$1')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Create PDF
    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${document.title.replace(/[^a-z0-9]/gi, '_')}.pdf"`
    );

    doc.pipe(res);

    // PDF Header
    doc
      .fillColor('#1a1a2e')
      .fontSize(20)
      .font('Helvetica-Bold')
      .text(document.title, { align: 'center' });

    doc
      .fillColor('#666')
      .fontSize(10)
      .font('Helvetica')
      .text(
        `${document.type.toUpperCase()} | Generated on ${new Date(document.createdAt).toLocaleDateString()}`,
        { align: 'center' }
      );

    doc.moveDown(1);
    doc
      .moveTo(50, doc.y)
      .lineTo(545, doc.y)
      .strokeColor('#e2e8f0')
      .stroke();
    doc.moveDown(1);

    // PDF Content
    doc.fillColor('#333').fontSize(11).font('Helvetica').text(plainText, {
      lineGap: 4,
      paragraphGap: 6,
    });

    // Footer
    doc
      .fillColor('#999')
      .fontSize(8)
      .text(
        `Generated by AI SaaS Platform | Page 1`,
        50,
        doc.page.height - 50,
        { align: 'center' }
      );

    doc.end();
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/documents/stats ─────────────────────────────────────────────────
router.get('/user/stats', async (req, res, next) => {
  try {
    const stats = await Document.aggregate([
      { $match: { userId: req.user._id, isDeleted: false } },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          lastCreated: { $max: '$createdAt' },
        },
      },
    ]);

    const totalDocs = await Document.countDocuments({
      userId: req.user._id,
      isDeleted: false,
    });
    const favDocs = await Document.countDocuments({
      userId: req.user._id,
      isFavorite: true,
      isDeleted: false,
    });

    res.json({
      stats,
      total: totalDocs,
      favorites: favDocs,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
