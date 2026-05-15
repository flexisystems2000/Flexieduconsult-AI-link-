require('dotenv').config();
const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// 1. INCREASE LIMITS: Required for high-res Base64 images
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

app.get("/", (req, res) => {
    res.send(`🤖 JARVIS AI Core Online | WAT: ${getNigeriaTime()} | Active Keys: ${API_KEYS.length}`);
});

// --- NEW: BROWSER TEST ROUTE ---
// Test this by visiting: https://your-link.onrender.com/test/hello
app.get("/test/:query", async (req, res) => {
    const userQuery = req.params.query;
    try {
        const apiKey = API_KEYS[0];
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent?key=${apiKey}`,
            { contents: [{ parts: [{ text: userQuery }] }] }
        );
        const result = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        res.send(`<h1>JARVIS Test Mode</h1><p><b>Query:</b> ${userQuery}</p><p><b>AI Response:</b> ${result}</p>`);
    } catch (err) {
        res.status(500).send(`<h1>Test Failed</h1><p>${err.message}</p><p>Check if your API Key is valid!</p>`);
    }
});

// --- ENDPOINT: TEXT, IMAGE & FILE ANALYSIS ---
app.post("/ai", async (req, res) => {
    const { prompt, image, audio } = req.body;

    if (!prompt && !image && !audio) {
        return res.status(400).json({ success: false, error: "No input provided." });
    }

    const systemInstruction = 
        `CRITICAL: Use Unicode symbols. Represent fractions as 'a/b'. NO LaTeX. ` +
        `Current Nigeria Time: ${getNigeriaTime()}. Respond as JARVIS AI for Flexi Digital Academy.`;

    const finalPrompt = `${systemInstruction}\n\nUser: ${prompt || "Analyze the provided media."}`;

    async function fetchWithRotation(index) {
        if (index >= API_KEYS.length) throw new Error("All API keys exhausted or invalid.");

        try {
            const apiKey = API_KEYS[index];
            const parts = [{ text: finalPrompt }];
            
            if (image) {
                // Check if it's a PDF or Image based on Base64 header
                const mime = image.startsWith("JVBERi0") ? "application/pdf" : "image/jpeg";
                parts.push({ inline_data: { mime_type: mime, data: image } });
            }

            if (audio) {
                parts.push({ inline_data: { mime_type: "audio/ogg", data: audio } });
            }

            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
                { contents: [{ parts: parts }] },
                { timeout: 30000 }
            );

            const result = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!result) throw new Error("Empty AI response");
            return result;

        } catch (err) {
            const status = err.response?.status;
            if ((status === 429 || status === 400) && index < API_KEYS.length - 1) {
                console.log(`⚠️ Key ${index} failed (${status}). Rotating...`);
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
        console.error("AI ERROR:", err.response?.data || err.message);
        return res.status(500).json({ success: false, error: "AI service currently unavailable." });
    }
});

// --- ENDPOINT: IMAGE GENERATION ---
app.post("/generate-image", async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ success: false, error: "Missing prompt." });

    async function generateWithRotation(index) {
        if (index >= API_KEYS.length) throw new Error("Keys exhausted.");
        try {
            const apiKey = API_KEYS[index];
            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-images:predict?key=${apiKey}`,
                { instances: [{ prompt: prompt }], parameters: { sampleCount: 1 } },
                { timeout: 45000 }
            );
            const base64 = response.data?.predictions?.[0]?.bytesBase64Encoded;
            if (!base64) throw new Error("No image generated.");
            return base64;
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

app.listen(PORT, () => {
    console.log(`🚀 JARVIS Server Online on port ${PORT}`);
});
                
