require('dotenv').config(); // Essential for local testing
const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// Simple health check to see if the server is alive
app.get("/", (req, res) => {
    res.send("🤖 Gemini Link API is online and ready!");
});

/**
 * MAIN AI ENDPOINT
 * Usage: /ai?q=your question here
 */
app.get("/ai", async (req, res) => {
    const prompt = req.query.q;

    // 1. Check if user actually sent a prompt
    if (!prompt) {
        return res.status(400).json({
            success: false,
            error: "Missing query parameter 'q'. Usage: /ai?q=hello"
        });
    }

    try {
        const apiKey = process.env.GEMINI_API_KEY;

        // 2. Ensure API Key exists in Render/Environment
        if (!apiKey) {
            return res.status(500).json({
                success: false,
                error: "Gemini API key not found in server settings."
            });
        }

        // 3. Call the Gemini API
        // Updated to v1 and gemini-2.5-flash for 2026 compatibility
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
            {
                contents: [{
                    parts: [{ text: prompt }]
                }]
            },
            { timeout: 30000 } // Don't let the request hang forever
        );

        // 4. Extract the text response
        const result = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!result) {
            return res.json({
                success: false,
                error: "Gemini returned an empty response. This is usually due to safety filters."
            });
        }

        // 5. Send the successful result back
        return res.json({
            success: true,
            result: result
        });

    } catch (err) {
        // Log error for you (the dev) but keep it clean for the user
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
    console.log(`🚀 Gemini Link API is running on port ${PORT}`);
});
            
