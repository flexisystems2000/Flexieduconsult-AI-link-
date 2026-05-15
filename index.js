require("dotenv").config();
const express = require("express");
const axios = require("axios");
const pdfParse = require("pdf-parse");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

// ---------------- API KEYS ----------------
const API_KEYS = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3
].filter(Boolean);

let keyIndex = 0;

const getNextKey = () => {
    if (API_KEYS.length === 0) throw new Error("No Gemini API keys");

    const key = API_KEYS[keyIndex];
    keyIndex = (keyIndex + 1) % API_KEYS.length;
    return key;
};

// ---------------- GEMINI CALL ----------------
async function callGemini(contents) {
    let lastError;

    for (let i = 0; i < API_KEYS.length; i++) {
        const key = getNextKey();

        try {
            const res = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
                { contents },
                { timeout: 45000 }
            );

            return res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        } catch (err) {
            lastError = err;
        }
    }

    throw new Error(lastError?.message || "Gemini failed");
}

// ---------------- OCR ----------------
async function ocrSpace(fileBase64) {
    try {
        const clean = fileBase64.replace(/^data:.*?;base64,/, "");

        const formData = new URLSearchParams();
        formData.append("base64Image", clean);
        formData.append("language", "eng");
        formData.append("OCREngine", "2");

        const res = await axios.post(
            "https://api.ocr.space/parse/image",
            formData,
            {
                headers: {
                    apikey: process.env.OCR_API_KEY,
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                timeout: 30000
            }
        );

        return res.data?.ParsedResults?.map(r => r.ParsedText).join("\n")?.trim() || "";
    } catch (err) {
        return "";
    }
}

// ---------------- TIME ----------------
const getNigeriaTime = () => {
    return new Intl.DateTimeFormat("en-GB", {
        timeZone: "Africa/Lagos",
        day: "2-digit",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
    }).format(new Date());
};

// ---------------- HOME ----------------
app.get("/", (req, res) => {
    res.send(`<h1>🤖 JARVIS CORE</h1><p>ONLINE</p><p>${getNigeriaTime()}</p>`);
});

// =====================================================
// 1. AI ROUTE
// =====================================================
app.post("/ai", async (req, res) => {
    try {
        const { prompt, image } = req.body;

        const parts = [
            {
                text:
                    `You are JARVIS for Flexi Digital Academy. ` +
                    `Be educational. NO LATEX. Use √ π ± ² ³.\n\nUser: ${prompt || "Analyze this"}`
            }
        ];

        if (image) {
            parts.push({
                inline_data: {
                    mime_type: "image/jpeg",
                    data: image.replace(/^data:.*?;base64,/, "")
                }
            });
        }

        const result = await callGemini([{ parts }]);

        res.json({ success: true, result: result || "No response" });

    } catch (err) {
        res.status(500).json({ success: false, error: "AI failed" });
    }
});

// =====================================================
// 2. IMAGE ROUTE
// =====================================================
app.get("/image", (req, res) => {
    const prompt = req.query.prompt;

    if (!prompt) {
        return res.status(400).json({
            success: false,
            error: "Prompt required"
        });
    }

    res.json({
        success: true,
        image: `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`
    });
});

// =====================================================
// 3. PDF ROUTE (SMART + OCR)
// =====================================================
app.post("/pdf", async (req, res) => {
    try {
        const { fileBase64, prompt } = req.body;

        if (!fileBase64) {
            return res.status(400).json({
                success: false,
                error: "No PDF provided"
            });
        }

        const buffer = Buffer.from(
            fileBase64.replace(/^data:application\/pdf;base64,/, ""),
            "base64"
        );

        let text = "";

        try {
            const pdfData = await pdfParse(buffer);
            text = pdfData.text || "";
        } catch {}

        if (text.trim().length < 50) {
            text = await ocrSpace(fileBase64);
        }

        if (!text || text.trim().length < 5) {
            return res.json({
                success: false,
                error: "Unreadable document"
            });
        }

        const result = await callGemini([
            {
                parts: [
                    {
                        text:
                            `Analyze this document:\n\n${text}\n\nUser request: ${prompt || "Summarize"}`
                    }
                ]
            }
        ]);

        res.json({ success: true, result });

    } catch (err) {
        res.status(500).json({ success: false, error: "PDF failed" });
    }
});

// ---------------- SERVER ----------------
app.listen(PORT, () => {
    console.log(`🚀 JARVIS RUNNING ON PORT ${PORT}`);
});
