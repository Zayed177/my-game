/**
 * server.js
 * ----------------------------------------------------------------------------
 * Optional local proxy between index.html and Ollama.
 *
 * Why use it if everything is already local?
 *   - Adds request validation (rejects malformed/oversized payloads)
 *   - Adds simple logging so you can see what's being asked/answered
 *   - Adds CORS headers, useful if you ever serve index.html from a different
 *     port/origin instead of opening it as a file
 *   - Gives you one place to add rate limiting, auth, or logging to a file
 *     later, without touching the frontend
 *
 * It is NOT required — index.html can talk to Ollama directly on
 * http://localhost:11434. Use whichever you prefer in the Settings panel.
 *
 * Setup:
 *   npm install express cors node-fetch@2
 *   node server.js
 *   -> listens on http://localhost:3000, forwards to http://localhost:11434
 * ----------------------------------------------------------------------------
 */

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ---- simple request logging ----
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// ---- basic input validation ----
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

// ---- non-streaming chat endpoint ----
app.post('/api/chat', async (req, res) => {
  const validationError = validateChatRequest(req.body);
  if (validationError) {
    return res.status(400).json({ error: { message: validationError } });
  }

  try {
    const upstream = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...req.body, stream: false })
    });
    const data = await upstream.json();
    if (!upstream.ok) return res.status(upstream.status).json(data);
    res.json(data);
  } catch (err) {
    console.error('Proxy error (non-streaming):', err.message);
    res.status(502).json({
      error: { message: 'Could not reach Ollama at ' + OLLAMA_URL + '. Is "ollama serve" running?' }
    });
  }
});

// ---- streaming chat endpoint (forwards Ollama's SSE stream as-is) ----
app.post('/api/chat/stream', async (req, res) => {
  const validationError = validateChatRequest(req.body);
  if (validationError) {
    return res.status(400).json({ error: { message: validationError } });
  }

  try {
    const upstream = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...req.body, stream: true })
    });

    if (!upstream.ok || !upstream.body) {
      const data = await upstream.json().catch(() => ({}));
      return res.status(upstream.status || 502).json(data);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    upstream.body.on('data', chunk => res.write(chunk));
    upstream.body.on('end', () => res.end());
    upstream.body.on('error', () => res.end());
  } catch (err) {
    console.error('Proxy error (streaming):', err.message);
    res.status(502).json({
      error: { message: 'Could not reach Ollama at ' + OLLAMA_URL + '. Is "ollama serve" running?' }
    });
  }
});

app.get('/', (req, res) => {
  res.send('Local chatbot proxy is running. POST to /api/chat or /api/chat/stream.');
});

app.listen(PORT, () => {
  console.log(`✅ Proxy listening on http://localhost:${PORT}`);
  console.log(`   Forwarding to Ollama at ${OLLAMA_URL}`);
  console.log('   Make sure "ollama serve" is running (setup.ps1 / start-chatbot.ps1 handle this).');
});
