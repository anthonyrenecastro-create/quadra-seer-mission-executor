
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from "@google/genai";
import fetch from 'node-fetch';

// Load local-first environment files so npm start works without manual mapping.
dotenv.config({ path: '.env.local' });
dotenv.config();

const app = express();
const port = 3001;

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
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' })); // Allow larger payloads for file uploads

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
    res.json({ status: 'ok' });
});


// --- API Endpoints ---

/**
 * LEGACY FALLBACK — use POST /api/atlantean/query (Python backend) instead.
 * This endpoint passes conversation history directly to Gemini without going
 * through the Atlantean memory/field system, violating the stateless-LLM
 * principle. Kept for backward compatibility only.
 */
app.post('/api/chat', async (req, res) => {
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
app.post('/api/tts', async (req, res) => {
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
 * Endpoint for conversation summarization (mocked).
 */
app.post('/api/summarize', async (req, res) => {
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
mountCollab(app);

// --- Server Start ---
app.listen(port, () => {
    console.log(`Q.M.A.I. backend server listening on port ${port}`);
});
