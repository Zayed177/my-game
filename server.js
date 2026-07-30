/**
 * server.js
 * ----------------------------------------------------------------------------
 * Proxy for your chatbot — now uses Groq Cloud API (free tier).
 * No more localhost issues on Render.
 * 
 * Setup:
 *   1. Get a free API key at https://console.groq.com
 *   2. Add GROQ_API_KEY to Render's environment variables
 *   3. Deploy
 * ----------------------------------------------------------------------------
 */

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();

// ---------- Configuration ----------
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// ---------- Middleware ----------
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Request logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// ---------- Validation ----------
function validateChatRequest(body) {
  if (!body || typeof body !== 'object') return 'Request body must be JSON.';
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return 'Request must include a non-empty "messages" array.';
  }
  for (const m of body.messages) {
    if (!m || typeof m.content !== 'string' || typeof m.role !== 'string') {
      return 'Each message needs a string "role" and string "content".';
    }
    if (m.content.length > 8000) {
      return 'A message exceeds the 8000 character limit.';
    }
  }
  if (body.temperature !== undefined && (typeof body.temperature !== 'number' || body.temperature < 0 || body.temperature > 2)) {
    return 'temperature must be a number between 0 and 2.';
  }
  if (body.max_tokens !== undefined && (typeof body.max_tokens !== 'number' || body.max_tokens < 1 || body.max_tokens > 8000)) {
    return 'max_tokens must be a number between 1 and 8000.';
  }
  return null;
}

// ---------- Helper: call Groq ----------
async function callGroq(payload, stream = false) {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY environment variable is not set.');
  }

  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: 'llama3-8b-8192',   // fast, free, good quality
      ...payload,
      stream
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const message = errorData.error?.message || `HTTP ${response.status}`;
    throw new Error(message);
  }

  return response;
}

// ---------- Non‑streaming chat ----------
app.post('/api/chat', async (req, res) => {
  const validationError = validateChatRequest(req.body);
  if (validationError) {
    return res.status(400).json({ error: { message: validationError } });
  }

  try {
    const upstream = await callGroq(req.body, false);
    const data = await upstream.json();
    res.json(data);
  } catch (err) {
    console.error('Error (non-streaming):', err.message);
    res.status(502).json({
      error: { message: err.message || 'Groq API request failed.' }
    });
  }
});

// ---------- Streaming chat (SSE) ----------
app.post('/api/chat/stream', async (req, res) => {
  const validationError = validateChatRequest(req.body);
  if (validationError) {
    return res.status(400).json({ error: { message: validationError } });
  }

  try {
    const upstream = await callGroq(req.body, true);

    if (!upstream.body) {
      throw new Error('No response body from Groq.');
    }

    // Forward SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Pipe the stream directly to the client
    upstream.body.on('data', chunk => res.write(chunk));
    upstream.body.on('end', () => res.end());
    upstream.body.on('error', () => res.end());
  } catch (err) {
    console.error('Error (streaming):', err.message);
    res.status(502).json({
      error: { message: err.message || 'Groq API stream request failed.' }
    });
  }
});

// ---------- Health check ----------
app.get('/', (req, res) => {
  if (!GROQ_API_KEY) {
    res.status(500).send('⚠️ GROQ_API_KEY is missing. Set it in Render environment variables.');
  } else {
    res.send('✅ Proxy is running with Groq. POST to /api/chat or /api/chat/stream.');
  }
});

// ---------- Start server ----------
app.listen(PORT, () => {
  console.log(`✅ Proxy listening on http://localhost:${PORT}`);
  console.log(`   Using Groq API (model: llama3-8b-8192)`);
  if (!GROQ_API_KEY) {
    console.warn('⚠️  GROQ_API_KEY is not set! Add it to your environment variables.');
  }
});