require('dotenv').config();
const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// 1. INCREASE LIMITS: Required for high-res Base64 images from JARVIS
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
    res.send(`🤖 JARVIS AI Core Online | WAT: ${getNigeriaTime()}`);
});

// --- ENDPOINT: TEXT & IMAGE ANALYSIS ---
app.post("/ai", async (req, res) => {
    const { prompt, image } = req.body;

    if (!prompt && !image) {
        return res.status(400).json({ success: false, error: "No prompt or image provided." });
    }

    // Force Nigerian context and time into every request
    const systemInstruction = 
        `CRITICAL: Use Unicode symbols (√, ±, ², ³, ≈, ÷). Represent fractions as 'a/b'. ` +
        `NO LaTeX. The current time in Nigeria is ${getNigeriaTime()}. ` +
        `Respond as JARVIS AI for Flexi Digital Academy.`;

    const finalPrompt = `${systemInstruction}\n\nUser: ${prompt || "Analyze this image."}`;

    async function fetchWithRotation(index) {
        if (index >= API_KEYS.length) throw new Error("All API keys exhausted.");

        try {
            const apiKey = API_KEYS[index];
            const parts = [{ text: finalPrompt }];
            
            if (image) {
                parts.push({
                    inline_data: {
                        mime_type: "image/jpeg",
                        data: image 
                    }
                });
            }

            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
                { contents: [{ parts: parts }] },
                { timeout: 30000 }
            );

            return response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        } catch (err) {
            if (err.response?.status === 429 && index < API_KEYS.length - 1) {
                console.log(`⚠️ Key ${index} limited. Rotating...`);
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
        console.error("AI ERROR:", err.message);
        return res.status(500).json({ success: false, error: "Service busy. Try again." });
    }
});

// --- ENDPOINT: IMAGE GENERATION (Nano Banana 2) ---
app.post("/generate-image", async (req, res) => {
    const { prompt } = req.body;

    if (!prompt) return res.status(400).json({ success: false, error: "Missing prompt." });

    async function generateWithRotation(index) {
        if (index >= API_KEYS.length) throw new Error("Keys exhausted.");

        try {
            const apiKey = API_KEYS[index];
            
            // Nano Banana 2 implementation (Imagen 3 via Gemini API)
            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-images:predict?key=${apiKey}`,
                {
                    instances: [{ prompt: prompt }],
                    parameters: { sampleCount: 1 }
                },
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
        return res.json({ 
            success: true, 
            imageUrl: `data:image/png;base64,${imageBytes}` 
        });
    } catch (err) {
        console.error("GEN ERROR:", err.message);
        return res.status(500).json({ success: false, error: "Generation failed." });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Flexi-AI Server Online (WAT) on port ${PORT}`);
});
