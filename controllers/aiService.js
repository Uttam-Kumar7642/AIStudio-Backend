require('dotenv').config();

const GEMINI_MODELS = [
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-flash-lite-latest',
  'gemini-flash-latest',
  'gemini-2.5-pro',
];

const buildResumePrompt = (data) => {
  const { name, jobTitle, experience, skills, education, industry, experienceLevel, achievements, language = 'English' } = data;
  return `You are a senior resume writer with 20+ years of experience.

Create a professional ATS-optimized resume in ${language} for:
- Name: ${name || 'Professional'}
- Target Role: ${jobTitle || 'Software Engineer'}
- Industry: ${industry || 'Technology'}
- Level: ${experienceLevel || 'Mid-level'}
- Experience: ${experience}
- Skills: ${skills}
- Education: ${education}
- Achievements: ${achievements}

STRICT RULES:
1. QUANTIFY EVERY BULLET: Each bullet MUST have a number/metric/percentage.
2. ZERO REPEATED ACTION VERBS: Every bullet must start with a unique verb.
   Use: Architected, Automated, Boosted, Built, Championed, Delivered, Designed,
   Drove, Engineered, Established, Executed, Expanded, Improved, Integrated,
   Launched, Led, Mentored, Modernized, Optimized, Orchestrated, Pioneered,
   Reduced, Refactored, Scaled, Shipped, Spearheaded, Streamlined, Transformed.
3. SPELL CHECK: Every word must be spelled correctly.
4. PROFESSIONAL SUMMARY: 3-4 sentences with years of experience, top skills, one quantified achievement.
5. HTML FORMAT ONLY:
   <h1> candidate name, <h2> section headers, <h3> job title/company,
   <p> paragraphs, <ul><li> bullets, <strong> emphasis.
   NO <html><head><body><style> tags.

Output ONLY the HTML. No commentary, no markdown, no backticks.`;
};

const buildBlogPrompt = (data) => {
  const { topic, tone = 'professional', audience = 'general', wordCount = 800, keywords = '', language = 'English', outline = '' } = data;
  return `You are an expert content writer. Write a blog post in ${language}.
Topic: ${topic} | Tone: ${tone} | Audience: ${audience} | Length: ~${wordCount} words
Keywords: ${keywords || 'relevant terms'} | Outline: ${outline || 'create logical structure'}
RULES: Hook first sentence. <h1> title, <h2> sections, <h3> subsections.
Short paragraphs. Specific data points. Strong CTA. Zero spelling mistakes.
NO <html><head><body><style> tags. Output ONLY HTML content.`;
};

// ─── Check if error should trigger fallback ───────────────────────────────────
const shouldFallback = (err) => {
  const msg = err?.message || '';
  return (
    msg.includes('429') ||
    msg.includes('quota') ||
    msg.includes('Too Many') ||
    msg.includes('404') ||
    msg.includes('not found') ||
    msg.includes('503') ||
    msg.includes('Service Unavailable') ||
    msg.includes('high demand') ||
    msg.includes('overloaded') ||
    msg.includes('temporarily')
  );
};

// ─── Gemini with automatic model fallback + retry ─────────────────────────────
const generateWithGemini = async (prompt) => {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your-gemini-key-here') throw new Error('GEMINI_API_KEY is not set in backend/.env');
  const genAI = new GoogleGenerativeAI(apiKey);

  for (const modelName of GEMINI_MODELS) {
    // Try each model up to 2 times (handles brief 503 spikes)
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`🤖 Trying Gemini model: ${modelName} (attempt ${attempt})`);
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        console.log(`✅ Success with model: ${modelName}`);
        return result.response.text();
      } catch (err) {
        if (shouldFallback(err)) {
          const is503 = err?.message?.includes('503') || err?.message?.includes('high demand');
          const is429 = err?.message?.includes('429') || err?.message?.includes('quota');
          const is404 = err?.message?.includes('404') || err?.message?.includes('not found');

          if (is503 && attempt === 1) {
            // 503: wait 3 seconds then retry same model once
            console.warn(`⚠️  Model ${modelName} overloaded, retrying in 3s...`);
            await new Promise(r => setTimeout(r, 3000));
            continue;
          }
          // quota/404/second 503 failure: move to next model
          console.warn(`⚠️  Model ${modelName} unavailable (${is429 ? 'quota' : is404 ? 'not found' : 'overloaded'}), trying next...`);
          break;
        }
        throw err; // non-recoverable error
      }
    }
  }

  throw new Error('All Gemini models are currently unavailable. Please try again in a few minutes or create a new API key at aistudio.google.com');
};

// ─── OpenAI ───────────────────────────────────────────────────────────────────
const generateWithOpenAI = async (prompt, type) => {
  const OpenAI = require('openai');
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.startsWith('sk-your')) throw new Error('OPENAI_API_KEY is not set in backend/.env');
  const openai = new OpenAI({ apiKey });
  console.log('🤖 Calling OpenAI gpt-3.5-turbo for:', type);
  const completion = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      { role: 'system', content: 'You are an expert professional writer. Never repeat action verbs. Always quantify achievements. Return only clean HTML.' },
      { role: 'user', content: prompt },
    ],
    max_tokens: 2500,
    temperature: 0.6,
  });
  console.log('✅ OpenAI response received');
  return completion.choices[0].message.content;
};

// ─── Main ─────────────────────────────────────────────────────────────────────
const generateContent = async (type, data) => {
  const prompt = type === 'resume' ? buildResumePrompt(data) : buildBlogPrompt(data);
  const provider = (process.env.AI_PROVIDER || 'openai').toLowerCase().trim();
  console.log('📡 AI Provider:', provider);
  const content = provider === 'gemini'
    ? await generateWithGemini(prompt)
    : await generateWithOpenAI(prompt, type);
  return { content, prompt };
};

const generateSuggestions = async (content, type) => {
  const prompt = `You are a professional editor. Review this ${type} and return exactly 5 improvement suggestions as a JSON array of strings. Focus on: missing metrics, repeated words, weak verbs, clarity. Return ONLY the JSON array.\n\nContent:\n${content.replace(/<[^>]*>/g, ' ').substring(0, 1500)}`;
  const provider = (process.env.AI_PROVIDER || 'openai').toLowerCase().trim();
  const response = provider === 'gemini'
    ? await generateWithGemini(prompt)
    : await generateWithOpenAI(prompt, 'suggestions');
  try {
    const jsonMatch = response.match(/\[[\s\S]*?\]/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  } catch { return []; }
};

module.exports = { generateContent, generateSuggestions };
