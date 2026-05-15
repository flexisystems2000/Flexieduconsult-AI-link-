require('dotenv').config();
const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// 1. INCREASE LIMITS: Required for high-res images and PDF data
app.use(express.json({ limit: '20mb' })); 
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// 2. API KEY CONFIGURATION
const API_KEYS = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3
].filter(key => key);

let currentKeyIndex = 0;

// Helper to get current Nigeria Time string
const getNigeriaTime = () => {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Lagos',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    }).format(new Date());
};

// Base Route
app.get("/", (req, res) => {
    res.send(`🤖 JARVIS AI Core Online | WAT: ${getNigeriaTime()} | Keys Active: ${API_KEYS.length}`);
});

// --- NEW: BROWSER TEST ROUTE ---
// Visit: https://flexieduconsult-ai-link.onrender.com/test/what is an ai
app.get("/test/:query", async (req, res) => {
    const userQuery = req.params.query;
    try {
        const apiKey = API_KEYS[0];
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
            { contents: [{ parts: [{ text: userQuery }] }] }
        );
        const result = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        res.send(`
            <body style="font-family:sans-serif; padding:20px; background:#f0f2f5;">
                <div style="background:white; padding:20px; border-radius:15px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                    <h2 style="color:#002b5c;">🤖 JARVIS Test Mode</h2>
                    <p><b>Your Question:</b> ${userQuery}</p>
                    <hr>
                    <p><b>AI Response:</b><br>${result}</p>
                </div>
            </body>
        `);
    } catch (err) {
        res.status(500).send(`<h1>Test Failed</h1><p>${err.message}</p>`);
    }
});

// --- MAIN AI ENDPOINT (Used by WhatsApp Bot) ---
app.post("/ai", async (req, res) => {
    const { prompt, image, audio } = req.body;

    if (!prompt && !image && !audio) {
        return res.status(400).json({ success: false, error: "No input provided." });
    }

    const systemInstruction = 
        `CRITICAL: Use Unicode symbols (√, ±, ², ³, ≈, ÷). Represent fractions as 'a/b'. NO LaTeX. ` +
        `Current Nigeria Time: ${getNigeriaTime()}. Respond as JARVIS AI for Flexi Digital Academy.`;

    const finalPrompt = `${systemInstruction}\n\nUser: ${prompt || "Analyze the provided media."}`;

    async function fetchWithRotation(index) {
        if (index >= API_KEYS.length) throw new Error("All API keys exhausted.");

        try {
            const apiKey = API_KEYS[index];
            const parts = [{ text: finalPrompt }];
            
            if (image) {
                const mime = image.startsWith("JVBERi0") ? "application/pdf" : "image/jpeg";
                parts.push({ inline_data: { mime_type: mime, data: image } });
            }

            if (audio) {
                parts.push({ inline_data: { mime_type: "audio/ogg", data: audio } });
            }

            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
                { contents: [{ parts: parts }] },
                { timeout: 30000 }
            );

            return response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        } catch (err) {
            if (err.response?.status === 429 && index < API_KEYS.length - 1) {
                currentKeyIndex = index + 1;
                return fetchWithRotation(index + 1);
            }
            throw err;
        }
    }

    try {
        const result = await fetchWithRotation(currentKeyIndex);
        return res.json({ success: true, result: result });
    } catch (err) {
        return res.status(500).json({ success: false, error: "AI Service Busy." });
    }
});

// --- IMAGE GENERATION ---
app.post("/generate-image", async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ success: false, error: "Missing prompt." });

    async function generateWithRotation(index) {
        if (index >= API_KEYS.length) throw new Error("Keys exhausted.");
        try {
            const apiKey = API_KEYS[index];
            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-images:predict?key=${apiKey}`,
                { instances: [{ prompt: prompt }], parameters: { sampleCount: 1 } }
            );
            return response.data?.predictions?.[0]?.bytesBase64Encoded;
        } catch (err) {
            if (err.response?.status === 429 && index < API_KEYS.length - 1) {
                currentKeyIndex = index + 1;
                return generateWithRotation(index + 1);
            }
            throw err;
        }
    }

    try {
        const imageBytes = await generateWithRotation(currentKeyIndex);
        return res.json({ success: true, imageUrl: `data:image/png;base64,${imageBytes}` });
    } catch (err) {
        return res.status(500).json({ success: false, error: "Generation failed." });
    }
});

app.listen(PORT, () => console.log(`🚀 Flexi-AI Server Online on port ${PORT}`));
    
