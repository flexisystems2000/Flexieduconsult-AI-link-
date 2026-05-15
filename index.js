require('dotenv').config();
const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '20mb' })); 

const API_KEYS = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3
].filter(key => key);

const getNigeriaTime = () => {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Lagos',
        day: '2-digit', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    }).format(new Date());
};

// --- ROUTES ---

app.get("/", (req, res) => {
    res.send(`<h1>🤖 JARVIS AI Online</h1><p>WAT: ${getNigeriaTime()}</p>`);
});

// BROWSER IMAGE TEST (e.g., /draw/a Nigerian student studying)
app.get("/draw/:prompt", async (req, res) => {
    const prompt = req.params.prompt;
    try {
        const apiKey = API_KEYS[0];
        // Using the most stable Imagen 3 endpoint
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-images:predict?key=${apiKey}`,
            {
                instances: [{ prompt: prompt }],
                parameters: { sampleCount: 1 }
            }
        );

        const base64 = response.data?.predictions?.[0]?.bytesBase64Encoded;
        if (!base64) throw new Error("Google returned no image data.");

        res.send(`
            <body style="text-align:center; background:#f0f2f5; font-family:sans-serif; padding:50px;">
                <h2>🎨 Image Test Successful</h2>
                <p>Prompt: ${prompt}</p>
                <img src="data:image/png;base64,${base64}" style="width:500px; border-radius:15px; box-shadow: 0 10px 20px rgba(0,0,0,0.2);">
            </body>
        `);
    } catch (err) {
        console.error("DEBUG:", err.response?.data || err.message);
        res.status(500).send(`<h1>Image Failed</h1><p>${err.message}</p><p>Check Render logs for details.</p>`);
    }
});

// MAIN API FOR WHATSAPP BOT
app.post("/ai", async (req, res) => {
    const { prompt, image } = req.body;
    try {
        const system = `Respond as JARVIS. Nigeria Time: ${getNigeriaTime()}.`;
        const parts = [{ text: `${system}\n\nUser: ${prompt || "Analyze this."}` }];
        
        if (image) {
            const mime = image.startsWith("JVBERi0") ? "application/pdf" : "image/jpeg";
            parts.push({ inline_data: { mime_type: mime, data: image } });
        }

        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEYS[0]}`,
            { contents: [{ parts: parts }] }
        );
        res.json({ success: true, result: response.data.candidates[0].content.parts[0].text });
    } catch (err) {
        res.status(500).json({ success: false, error: "AI Error" });
    }
});

// BOT IMAGE GENERATION ENDPOINT
app.post("/generate-image", async (req, res) => {
    const { prompt } = req.body;
    try {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-images:predict?key=${API_KEYS[0]}`,
            { instances: [{ prompt: prompt }], parameters: { sampleCount: 1 } }
        );
        const base64 = response.data?.predictions?.[0]?.bytesBase64Encoded;
        res.json({ success: true, imageUrl: `data:image/png;base64,${base64}` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.listen(PORT, () => console.log(`🚀 JARVIS Server Running on ${PORT}`));
        
