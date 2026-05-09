require('dotenv').config(); // Load environment variables
const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
    res.send("🤖 Gemini Link API is running...");
});

/**
 * MAIN AI ENDPOINT
 * Usage: /ai?q=your question here
 */
app.get("/ai", async (req, res) => {
    const prompt = req.query.q;

    if (!prompt) {
        return res.status(400).json({
            success: false,
            error: "Missing query parameter 'q'"
        });
    }

    try {
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            return res.status(500).json({
                success: false,
                error: "Gemini API key not set in environment variables"
            });
        }

        const response = await axios.post(
            // FIXED: Added {apiKey} inside the template literal
            `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
            {
                contents: [{
                    parts: [{ text: prompt }]
                }]
            },
            { timeout: 30000 } 
        );

        const result = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!result) {
            return res.json({
                success: false,
                error: "No response from Gemini (this may be due to safety filters)"
            });
        }

        return res.json({
            success: true,
            result: result
        });

    } catch (err) {
        console.error("AI ERROR:", err.response?.data || err.message);
        const statusCode = err.response?.status || 500;
        const errorMessage = err.response?.data?.error?.message || "AI request failed";

        return res.status(statusCode).json({
            success: false,
            error: errorMessage
        });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Gemini Link API running on port ${PORT}`);
});
