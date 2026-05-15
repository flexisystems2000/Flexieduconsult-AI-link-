require('dotenv').config();
const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware for JSON and large Base64 payloads
app.use(express.json({ limit: '15mb' })); 

const API_KEYS = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3
].filter(key => key);

let currentKeyIndex = 0;

app.get("/", (req, res) => {
    res.send("🤖 Flexi-AI Multimodal & Imaging Core is online!");
});

// --- ENDPOINT 1: TEXT & IMAGE ANALYSIS (Multimodal) ---
app.post("/ai", async (req, res) => {
    const { prompt, image } = req.body;

    if (!prompt && !image) {
        return res.status(400).json({ success: false, error: "No prompt or image provided." });
    }

    const systemInstruction = 
        "CRITICAL: Use Unicode symbols (√, ±, ², ³, ≈, ÷). " +
        "Represent fractions as 'a/b'. NO LaTeX. JARVIS AI Response.";

    const finalPrompt = `${systemInstruction}\n\nUser Question: ${prompt || "Analyze this image."}`;

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
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent?key=${apiKey}`,
                { contents: [{ parts: parts }] },
                { timeout: 30000 }
            );

            return response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        } catch (err) {
            if (err.response?.status === 429 && index < API_KEYS.length - 1) {
                console.log(`⚠️ Rotating Key for Analysis...`);
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
        console.error("ANALYSIS ERROR:", err.message);
        return res.status(500).json({ success: false, error: "AI analysis unavailable." });
    }
});

// --- ENDPOINT 2: IMAGE GENERATION (Nano Banana 2) ---
app.post("/generate-image", async (req, res) => {
    const { prompt } = req.body;

    if (!prompt) {
        return res.status(400).json({ success: false, error: "Missing prompt for image generation." });
    }

    async function generateWithRotation(index) {
        if (index >= API_KEYS.length) throw new Error("All API keys exhausted.");

        try {
            const apiKey = API_KEYS[index];
            
            // Using Nano Banana 2 (Gemini 3 Flash Image) for generation
            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-image:predict?key=${apiKey}`,
                {
                    instances: [{ prompt: prompt }],
                    parameters: { sampleCount: 1 }
                },
                { timeout: 40000 }
            );

            const base64Image = response.data?.predictions?.[0]?.bytesBase64Encoded;
            if (!base64Image) throw new Error("Empty image data received.");

            return base64Image;
        } catch (err) {
            if (err.response?.status === 429 && index < API_KEYS.length - 1) {
                console.log(`⚠️ Rotating Key for Generation...`);
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
        console.error("GENERATION ERROR:", err.message);
        return res.status(500).json({ success: false, error: "Image generation currently unavailable." });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 JARVIS AI Server Online with Analysis & Imaging features.`);
});
