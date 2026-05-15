require('dotenv').config();
const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// 1. MIDDLEWARE: Support for large student files and high-res images
app.use(express.json({ limit: '30mb' })); 
app.use(express.urlencoded({ extended: true, limit: '30mb' }));

// 2. API KEY ROTATION: Keeps JARVIS running even if one key hits a limit
const API_KEYS = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3
].filter(key => key);

let currentKeyIndex = 0;

const getApiKey = () => {
    if (API_KEYS.length === 0) throw new Error("No API keys found in Render Environment.");
    const key = API_KEYS[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
    return key;
};

// 3. NIGERIA TIME HELPER
const getNigeriaTime = () => {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Lagos',
        day: '2-digit', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    }).format(new Date());
};

// 4. MIME-TYPE DETECTOR: Smart detection for WhatsApp media
const getMimeType = (base64String) => {
    if (base64String.startsWith("JVBERi0")) return "application/pdf";
    if (base64String.startsWith("iVBORw0KGgo")) return "image/png";
    return "image/jpeg"; 
};

// --- ROUTES ---

app.get("/", (req, res) => {
    res.send(`<h1>🤖 JARVIS AI Core Online</h1><p><b>WAT:</b> ${getNigeriaTime()}</p><p>Status: All Systems Functional</p>`);
});

// MAIN API: Handles Text, Math (No LaTeX), Docs, and Vision
app.post("/ai", async (req, res) => {
    const { prompt, image } = req.body;
    try {
        const system = `Respond as JARVIS for Flexi Digital Academy. Nigeria Time: ${getNigeriaTime()}. ` +
                       `CRITICAL: NO LATEX code. Use Unicode (√, ±, ², ³, ≈, ÷, π, Δ, θ). Fractions as 'a/b'. ` +
                       `Explain like a friendly, professional tutor.`;
        
        const key = getApiKey();
        const parts = [{ text: `${system}\n\nUser: ${prompt || "Check this for me."}` }];
        
        if (image) {
            const cleanBase64 = image.replace(/^data:.*?;base64,/, "");
            parts.push({
                inline_data: {
                    mime_type: getMimeType(cleanBase64),
                    data: cleanBase64
                }
            });
        }

        // FIXED: The full corrected Google API URL for 2026
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
            { contents: [{ parts: parts }] }
        );

        const resultText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!resultText) throw new Error("Empty response from AI.");

        res.json({ success: true, result: resultText });
    } catch (err) {
        console.error("AI Error Details:", err.response?.data || err.message);
        res.status(500).json({ success: false, error: "JARVIS is slightly overwhelmed. Try again in 5 seconds." });
    }
});

// BROWSER TEST: Quickly verify math translation without WhatsApp
// Visit: your-link.com/test/Solve (x+2)(x-2)
app.get("/test/:query", async (req, res) => {
    try {
        const query = req.params.query;
        const key = getApiKey();
        const sys = "NO LATEX. Use Unicode symbols like ², √, π. Solve clearly.";
        
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
            { contents: [{ parts: [{ text: `${sys}\n\n${query}` }] }] }
        );
        
        const text = response.data.candidates[0].content.parts[0].text;
        res.send(`
            <body style="font-family:sans-serif; padding:30px; background:#f4f7f6;">
                <div style="background:white; padding:20px; border-radius:15px; box-shadow:0 4px 10px rgba(0,0,0,0.1);">
                    <h2 style="color:#002b5c;">🤖 JARVIS Math Test</h2>
                    <p><b>Question:</b> ${query}</p><hr>
                    <p style="white-space: pre-wrap;">${text}</p>
                </div>
            </body>
        `);
    } catch (err) {
        res.status(500).send(`Test Failed: ${err.message}`);
    }
});

app.post("/generate-image", (req, res) => {
    res.status(501).json({ success: false, error: "Image generation requires Vertex AI setup." });
});

app.listen(PORT, () => console.log(`🚀 JARVIS Server Live on Port ${PORT}`));
