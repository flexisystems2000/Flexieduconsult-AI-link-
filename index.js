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
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY_5
].filter(Boolean);

let keyIndex = 0;

const getNextKey = () => {
    if (API_KEYS.length === 0) throw new Error("No Gemini API keys");

    const key = API_KEYS[keyIndex];
    keyIndex = (keyIndex + 1) % API_KEYS.length;
    return key;
};

// ---------------- GEMINI CALL ----------------
async function callGemini(contents, isJson = false) {
    let lastError;

    for (let i = 0; i < API_KEYS.length; i++) {
        const key = getNextKey();

        try {
            const payload = { contents };
            if (isJson) {
                payload.generationConfig = { responseMimeType: "application/json" };
            }

            const res = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
                payload,
                { timeout: 45000 }
            );

            return res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        } catch (err) {
            lastError = err;
            console.log(`Key ${i + 1} encountered an issue, rotating keys...`);
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

// =====================================================
// 4. MANUAL TRIGGER QUIZ ENDPOINT
// =====================================================
app.post("/generate-quiz", async (req, res) => {
    try {
        const targetSubject = await runQuizGenerationPipeline();
        res.json({ success: true, message: `Manual trigger successfully deployed for ${targetSubject}.` });
    } catch (err) {
        console.log("Quiz Generation Endpoint Failure:", err.message);
        res.status(500).json({ success: false, error: "Quiz compilation framework failed" });
    }
});

// =====================================================
// core QUIZ COMPILATION & WHATSAPP PUSH LOGIC
// =====================================================
async function runQuizGenerationPipeline() {
    const subjects = ["Mathematics", "Physics", "Chemistry", "Biology", "English Language"];
    const randomSubject = subjects[Math.floor(Math.random() * subjects.length)];

    const prompt = `You are JARVIS, the master examiner for Flexi Digital Academy. 
Generate exactly 5 challenging multiple-choice questions for Post-UTME preparation in the subject: ${randomSubject}.
You must return the response strictly as a JSON object with this exact schema structure:
{
  "subject": "${randomSubject}",
  "quizText": "📚 *WEEKLY MOCK QUIZ: ${randomSubject.toUpperCase()}* 📚\\n\\n1. [Question text here]\\nA) [Option]\\nB) [Option]\\nC) [Option]\\nD) [Option]\\n\\n2. ...",
  "answers": ["A", "C", "B", "D", "A"]
}
Rules:
- quizText must display the complete test block numbered 1 through 5.
- DO NOT reveal the correct options inside the quizText block text string itself.
- answers must contain exactly 5 elements corresponding to the correct option string character (A, B, C, or D) for each question sequentially.
- NO LATEX. Formulate variables, signs, math expressions using Unicode fallback mappings like √, π, ±, ², ³.`;

    const resultJson = await callGemini([{ parts: [{ text: prompt }] }], true);
    const quizData = JSON.parse(resultJson);

    // 🚀 PUSH PAYLOAD STREAM DIRECTLY DOWN TO WHATSAPP RECIPIENT WEBHOOK
    // ⚠️ Replace 'YOUR-BOT-LIVE-URL.onrender.com' with your actual running WhatsApp Bot domain
    await axios.post('https://YOUR-BOT-LIVE-URL.onrender.com/webhook/trigger-quiz', {
        subject: quizData.subject,
        quizText: quizData.quizText,
        answers: quizData.answers
    }, { timeout: 30000 });

    return randomSubject;
}

// =====================================================
// INTERNAL 24/7 NIGERIA WAT TIME BACKGROUND TRACKER
// =====================================================
let quizFiredThisWeek = false;

setInterval(async () => {
    try {
        const currentDate = new Date();

        // 1. Resolve Current Weekday Number (6 = Saturday)
        const currentDay = new Intl.DateTimeFormat("en-GB", {
            timeZone: "Africa/Lagos",
            weekday: "numeric"
        }).format(currentDate);

        // 2. Resolve Current Hour (Military 24h format index, e.g. "20" = 8PM)
        const currentHour = new Intl.DateTimeFormat("en-GB", {
            timeZone: "Africa/Lagos",
            hour: "2-digit",
            hour12: false
        }).format(currentDate);

        // Match Saturday @ 8:00 PM West Africa Time
        if (currentDay === "6" && currentHour === "20") {
            if (!quizFiredThisWeek) {
                quizFiredThisWeek = true; // Lock execution tracking flag state
                console.log("⏰ Target Match (Saturday 8:00 PM WAT). Running quiz generation engine...");
                
                const handledSubject = await runQuizGenerationPipeline();
                console.log(`✅ Broadcast pipeline completed for subject: ${handledSubject}`);
            }
        } else {
            // Once the 8 PM hour passes completely, reset tracking lock for next week
            if (quizFiredThisWeek) {
                quizFiredThisWeek = false;
                console.log("🔄 Time window cleared. Quiz sequence tracking module reset.");
            }
        }
    } catch (err) {
        console.log("⚠️ Background Quiz Clock Loop Exception:", err.message);
    }
}, 60000); // Polling ticks down accurately every 60 seconds

// ---------------- SERVER ----------------
app.listen(PORT, () => {
    console.log(`🚀 JARVIS RUNNING ON PORT ${PORT}`);
});
