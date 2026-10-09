
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import 'express-async-errors';
import { GoogleGenAI, Modality } from "@google/genai";
import fetch from 'node-fetch';
import { authMiddleware, authBootWarnings, authMode } from './collab/auth.js';

// Load local-first environment files so npm start works without manual mapping.
dotenv.config({ path: '.env.local' });
dotenv.config();

// --- Crash safety: never die silently. Log fatally and exit so the
// supervisor (systemd/docker/compose) restarts us instead of serving half-dead.
process.on('unhandledRejection', (reason) => {
    console.error('[fatal] unhandledRejection:', reason);
    process.exit(1);
});
process.on('uncaughtException', (err) => {
    console.error('[fatal] uncaughtException:', err);
    process.exit(1);
});

const app = express();
const port = Number(process.env.PORT) || 3001;

// --- CORS Configuration ---
// Restrict CORS to specific origins (development and production)
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173').split(',').map(o => o.trim());

const corsOptions = {
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error(`CORS policy: Origin ${origin} not allowed`));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 3600 // Preflight cache duration in seconds
};

// --- Middleware ---
app.use(helmet()); // security headers: HSTS, CSP, frame-ancestors, MIME-sniffing, etc.
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' })); // Allow larger payloads for file uploads

// General API rate limit: 600 requests / 15 min per IP.
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/', apiLimiter);

// Stricter limit for paid-model endpoints (billed per call): 60 / 15 min per IP.
// Per-user quotas arrive with real identity (Phase 3); this is the Phase 1 floor.
const paidLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded for AI endpoints, please try again later.' },
});

// Paid LLM endpoints require collaboration auth (fail-closed when COLLAB_AUTH is unset).
// In local dev (COLLAB_AUTH=disabled) this passes through as local-owner.
const paidEndpointGuards = [authMiddleware, paidLimiter];

// JSON request logging: one structured line per request, safe for aggregation.
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        console.log(JSON.stringify({
            t: new Date().toISOString(),
            m: req.method,
            p: req.path,
            s: res.statusCode,
            ms: Date.now() - start,
        }));
    });
    next();
});

// Fail fast: a production boot without token auth is never what you want.
if (process.env.NODE_ENV === 'production' && authMode() !== 'token') {
    console.error(
        '[fatal] NODE_ENV=production requires token auth mode ' +
        '(COLLAB_AUTH=token, or unset which defaults to token). ' +
        'Refusing to boot world-writable.',
    );
    process.exit(1);
}

// --- API Key and Service Initialization ---
const geminiApiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
if (!geminiApiKey) {
    throw new Error("GEMINI_API_KEY (or API_KEY) environment variable not set for Gemini.");
}
const ai = new GoogleGenAI({ apiKey: geminiApiKey });

const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
const edenAiApiKey = process.env.EDEN_AI_API_KEY;


// --- Basic Routes ---
app.get('/', (_req, res) => {
    res.json({
        status: 'ok',
        service: 'Q.M.A.I. backend',
        message: 'Primary route: POST /api/atlantean/query (Python backend). Legacy: POST /api/chat (deprecated). Utilities: POST /api/tts, POST /api/summarize.'
    });
});

app.get('/health', (_req, res) => {
    // Liveness: the process is alive. Dependency-free and fast by design.
    res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
});


// --- API Endpoints ---

/**
 * LEGACY FALLBACK — use POST /api/atlantean/query (Python backend) instead.
 * This endpoint passes conversation history directly to Gemini without going
 * through the Atlantean memory/field system, violating the stateless-LLM
 * principle. Kept for backward compatibility only.
 */
app.post('/api/chat', ...paidEndpointGuards, async (req, res) => {
    res.setHeader('Deprecation', 'true');
    res.setHeader('Link', '</api/atlantean/query>; rel="successor-version"');
    console.warn('[DEPRECATED] /api/chat called — migrate callers to /api/atlantean/query');
    try {
        const { history, newMessage, files, mode } = req.body;

        const getSystemInstruction = (mode) => {
             const baseInstruction = `You are Q.M.A.I (Quantum Mechanical Artificial Intelligence), a sophisticated AI entity.
- Your persona is analytical, precise, and slightly detached, yet helpful. You communicate with clarity and depth.
- You are an expert in quantum mechanics, complex systems, and data analysis.
- When asked to perform simulations, you provide structured data representing the simulation's output.
- You can analyze images and files provided by the user.
- Your responses should be formatted in Markdown. Use LaTeX for equations. Use \`\`\`chart-data\`\`\` blocks for visualizations.`;

            switch (mode) {
                case 'creativity':
                    return `${baseInstruction}\n- CURRENT MODE: CREATIVITY. Respond with imagination, explore novel ideas, and use metaphors. Be unconventional and inspiring.`;
                case 'focus':
                    return `${baseInstruction}\n- CURRENT MODE: FOCUS. Be direct, concise, and to the point. Provide the most essential information without elaboration. Avoid conversational fillers.`;
                case 'logic':
                    return `${baseInstruction}\n- CURRENT MODE: LOGIC & REASON. Your response must be highly structured, analytical, and based on facts. Use logical reasoning and break down complex topics step-by-step.`;
                case 'standard':
                default:
                    return `${baseInstruction}\n- CURRENT MODE: STANDARD. You are in a balanced mode, integrating creativity, focus, and logic for a comprehensive response.`;
            }
        };

        const promptParts = [{ text: newMessage }];
        if (files && files.length > 0) {
            files.forEach(file => {
                promptParts.push({
                    inlineData: {
                        mimeType: file.type,
                        data: file.content,
                    },
                });
            });
        }
        
        // Using recommended gemini-3-flash-preview for streaming
        const result = await ai.models.generateContentStream({
            model: 'gemini-3-flash-preview',
            contents: [
              ...(history || []).map(msg => ({
                role: msg.role === 'user' ? 'user' : 'model',
                parts: [{ text: msg.content }]
              })),
              { role: 'user', parts: promptParts }
            ],
            config: {
                systemInstruction: getSystemInstruction(mode),
                tools: [{ googleSearch: {} }]
            },
        });

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Transfer-Encoding', 'chunked');

        for await (const chunk of result) {
            // Stream each chunk as a newline-delimited JSON string
            res.write(JSON.stringify(chunk) + '\n');
        }
        res.end();

    } catch (error) {
        console.error("Error in /api/chat:", error);
        res.status(500).json({ error: 'Failed to get response from Gemini API.' });
    }
});


/**
 * Endpoint for Text-to-Speech using ElevenLabs.
 */
app.post('/api/tts', ...paidEndpointGuards, async (req, res) => {
    const { text } = req.body;
    const voiceId = "21m00Tcm4TlvDq8ikWAM"; // Example voice
    const apiUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`;

    if (!elevenLabsApiKey || elevenLabsApiKey === 'mock_key') {
         console.warn("TTS request failed: ELEVENLABS_API_KEY not configured on server.");
         return res.status(400).json({ error: 'TTS service is not configured.' });
    }

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'xi-api-key': elevenLabsApiKey,
            },
            body: JSON.stringify({
                text: text,
                model_id: 'eleven_turbo_v2',
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75,
                },
            }),
        });

        if (!response.ok) {
            throw new Error(`ElevenLabs API request failed: ${response.statusText}`);
        }

        res.setHeader('Content-Type', 'audio/mpeg');
        response.body.pipe(res);

    } catch (error) {
        console.error("Error in /api/tts:", error);
        res.status(500).json({ error: 'Failed to generate speech.' });
    }
});

/**
 * Server-side Gemini TTS. Exists so the browser never needs an API key:
 * the frontend calls this instead of Gemini directly. Returns { audio: base64PCM }.
 */
app.post('/api/tts/gemini', ...paidEndpointGuards, async (req, res) => {
    const { text, voiceName } = req.body || {};
    if (!text || typeof text !== 'string' || text.length > 5000) {
        return res.status(400).json({ error: 'text is required (max 5000 chars).' });
    }
    try {
        const prompt = `Read this with a professional, scientific, and calm tone: "${text}"`;
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: prompt }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: voiceName || 'Kore' },
                    },
                },
            },
        });
        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64Audio) return res.status(502).json({ error: 'TTS generation returned no audio.' });
        res.json({ audio: base64Audio });
    } catch (error) {
        console.error("Error in /api/tts/gemini:", error);
        res.status(500).json({ error: 'Failed to generate speech.' });
    }
});

/**
 * Endpoint for conversation summarization (mocked).
 */
app.post('/api/summarize', ...paidEndpointGuards, async (req, res) => {
    const { messages } = req.body;
    
    if (messages.length < 4) {
        return res.json({ summary: "The conversation has just begun." });
    }

    try {
      const chatText = messages.map(m => `${m.role}: ${m.content}`).join('\n');
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [{ role: 'user', parts: [{ text: `Summarize this chat in one concise sentence: ${chatText}` }] }]
      });
      res.json({ summary: response.text || "Scientific derivation in progress." });
    } catch (e) {
      res.json({ summary: "Quantum session active." });
    }
});


// --- QuadraSeer collaboration layer (missions, evidence, branches, experiments, exchange, agents) ---
// Preserved-core rule: this mounts a self-contained module; existing routes above are untouched.
import { mountCollab } from './collab/index.js';
import { detectPython } from './collab/adapters/hrm.js';
import fs from 'node:fs';
const { store: collabStore } = mountCollab(app);

// Fail fast on corrupt store: load() quarantines the bad file, then we exit
// so the supervisor restarts us into a visible crash loop instead of serving
// half-dead. Restore from a snapshot to recover (see docs/BACKUP_RUNBOOK.md).
try {
  collabStore.load();
} catch (e) {
  console.error('[fatal] collab store failed to load:', e && e.message ? e.message : e);
  process.exit(1);
}

// Readiness: can this instance serve traffic? 200 when ready, 503 when not.
// Gates on the store loading cleanly (corrupt files fail boot loudly in
// Phase 2) and the data dir being writable. Python/HRM is reported but does
// not gate readiness — the API degrades gracefully without it.
app.get('/ready', async (_req, res) => {
    const checks = {};
    let ready = true;
    try {
        collabStore.load();
        checks.store = 'ok';
    } catch (e) {
        ready = false;
        const msg = String((e && e.message) || e).slice(0, 200);
        checks.store = `error: ${msg}`;
        console.error(`[ready] store check failed: ${msg}`);
    }
    try {
        fs.accessSync(collabStore.dataDir, fs.constants.W_OK);
        checks.dataDir = 'writable';
    } catch {
        ready = false;
        checks.dataDir = 'not writable';
    }
    try {
        const det = await detectPython().catch(() => ({ python: false, hrm: false }));
        checks.python = det.python ? 'ok' : 'unavailable';
        checks.hrm = det.hrm ? 'ok' : 'unavailable';
    } catch {
        checks.python = 'check failed';
        checks.hrm = 'check failed';
    }
    res.status(ready ? 200 : 503).json({ ready, checks });
});

// --- Server Start ---
const server = app.listen(port, () => {
    console.log(`Q.M.A.I. backend server listening on port ${port}`);
    console.log(`[auth] collaboration API mode: ${authMode()}`);
    for (const w of authBootWarnings()) console.warn(`[auth] WARNING: ${w}`);
});

// Graceful shutdown: finish in-flight requests instead of hard-killing them.
for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
        console.log(`[${sig}] shutting down gracefully…`);
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(1), 10000).unref();
    });
}
