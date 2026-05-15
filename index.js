require('dotenv').config();
const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURATION ---
// Add your multiple API keys here
const API_KEYS = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3
].filter(key => key); // Removes any empty/undefined keys

let currentKeyIndex = 0;

app.get("/", (req, res) => {
    res.send("🤖 Flexi-AI Core is online with Multi-Key Rotation!");
});

app.get("/ai", async (req, res) => {
    const userPrompt = req.query.q;

    if (!userPrompt) {
        return res.status(400).json({ success: false, error: "Missing query parameter 'q'." });
    }

    // 1. MATH & OUTPUT INSTRUCTION
    // This forces Gemini to avoid LaTeX and use WhatsApp-friendly symbols
    const systemInstruction = 
        "CRITICAL: Use Unicode symbols (√, ±, ², ³, ≈, ÷). " +
        "Represent fractions as 'a/b' or using horizontal lines. " +
        "NO LaTeX ($ or \\frac). Response for WhatsApp bot JARVIS AI.";

    const finalPrompt = `${systemInstruction}\n\nUser Question: ${userPrompt}`;

    // 2. RECURSIVE FUNCTION TO HANDLE ROTATION
    async function fetchWithRotation(index) {
        if (index >= API_KEYS.length) {
            throw new Error("All API keys exhausted or rate-limited.");
        }

        try {
            const apiKey = API_KEYS[index];
            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
                { contents: [{ parts: [{ text: finalPrompt }] }] },
                { timeout: 25000 }
            );

            return response.data?.candidates?.[0]?.content?.parts?.[0]?.text;

        } catch (err) {
            const isRateLimit = err.response?.status === 429;
            
            if (isRateLimit && index < API_KEYS.length - 1) {
                console.log(`⚠️ Key ${index} Limited. Rotating to Key ${index + 1}...`);
                currentKeyIndex = index + 1; // Update global index for next global request
                return fetchWithRotation(index + 1);
            }
            throw err; // Pass error up if no more keys or different error
        }
    }

    try {
        const result = await fetchWithRotation(currentKeyIndex);

        if (!result) {
            return res.json({ success: false, error: "Empty response from AI." });
        }

        return res.json({ success: true, result: result });

    } catch (err) {
        console.error("FINAL ERROR:", err.message);
        return res.status(500).json({
            success: false,
            error: "Service temporarily unavailable. Please try again."
        });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Flexi-AI is running on port ${PORT} with ${API_KEYS.length} keys.`);
});
