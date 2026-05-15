require('dotenv').config();
const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// 1. ADD MIDDLEWARE: Required to read the JSON body from JARVIS
app.use(express.json({ limit: '10mb' })); 

const API_KEYS = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3
].filter(key => key);

let currentKeyIndex = 0;

app.get("/", (req, res) => {
    res.send("🤖 Flexi-AI Multimodal Core is online!");
});

// 2. CHANGE TO POST: To accept both 'prompt' and 'image' data
app.post("/ai", async (req, res) => {
    const { prompt, image } = req.body; // Extract from JARVIS POST request

    if (!prompt && !image) {
        return res.status(400).json({ success: false, error: "No prompt or image provided." });
    }

    const systemInstruction = 
        "CRITICAL: Use Unicode symbols (√, ±, ², ³, ≈, ÷). " +
        "Represent fractions as 'a/b'. NO LaTeX. JARVIS AI Response.";

    const finalPrompt = `${systemInstruction}\n\nUser Question: ${prompt || "Analyze this image."}`;

    // 3. RESTRUCTURE FOR MULTIMODAL DATA
    async function fetchWithRotation(index) {
        if (index >= API_KEYS.length) {
            throw new Error("All API keys exhausted.");
        }

        try {
            const apiKey = API_KEYS[index];
            
            // Build the parts array
            const parts = [{ text: finalPrompt }];
            
            // If an image was sent, add it to the parts array
            if (image) {
                parts.push({
                    inline_data: {
                        mime_type: "image/jpeg",
                        data: image // Base64 string from JARVIS
                    }
                });
            }

            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
                { contents: [{ parts: parts }] },
                { timeout: 30000 }
            );

            return response.data?.candidates?.[0]?.content?.parts?.[0]?.text;

        } catch (err) {
            const isRateLimit = err.response?.status === 429;
            if (isRateLimit && index < API_KEYS.length - 1) {
                console.log(`⚠️ Rotating Key...`);
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
        console.error("FINAL ERROR:", err.message);
        return res.status(500).json({ success: false, error: "AI service error." });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Flexi-AI Multimodal is running on port ${PORT}`);
});
