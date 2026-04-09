const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
      default: 'Untitled Document',
    },
    type: {
      type: String,
      enum: ['resume', 'blog'],
      required: [true, 'Document type is required'],
    },
    content: {
      type: String,
      default: '',
    },
    prompt: {
      type: String, // The prompt used to generate this document
      default: '',
    },
    metadata: {
      // Resume specific
      jobTitle: String,
      industry: String,
      experienceLevel: String,
      // Blog specific
      topic: String,
      tone: String,
      wordCount: Number,
      // Common
      language: { type: String, default: 'English' },
      template: { type: String, default: 'default' },
    },
    isFavorite: {
      type: Boolean,
      default: false,
    },
    tags: [{ type: String, trim: true }],
    version: {
      type: Number,
      default: 1,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Virtual: Word Count ──────────────────────────────────────────────────────
documentSchema.virtual('wordCount').get(function () {
  if (!this.content) return 0;
  // Strip HTML tags for word count
  const text = this.content.replace(/<[^>]*>/g, ' ');
  return text.trim().split(/\s+/).filter(Boolean).length;
});

// ─── Indexes ──────────────────────────────────────────────────────────────────
documentSchema.index({ userId: 1, createdAt: -1 });
documentSchema.index({ userId: 1, type: 1 });
documentSchema.index({ userId: 1, isDeleted: 1 });

// ─── Query Middleware: Exclude Soft Deleted ────────────────────────────────────
documentSchema.pre(/^find/, function (next) {
  if (!this.getOptions().includeDeleted) {
    this.where({ isDeleted: false });
  }
  next();
});

module.exports = mongoose.model('Document', documentSchema);
