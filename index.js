require("dotenv").config();

const express = require("express");
const axios = require("axios");
const pdfParse = require("pdf-parse");
const { init: initPuter } = require("@heyputer/puter.js/src/init.cjs");

// Puter AI image-generation client
const puter = initPuter(process.env.PUTER_AUTH_TOKEN);
const app = express();
const PORT = process.env.PORT || 3000;

// =====================================================
// MIDDLEWARE
// =====================================================

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({
    extended: true,
    limit: "15mb"
}));

// =====================================================
// GEMINI API KEYS
// =====================================================

const API_KEYS = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY_5
].filter(Boolean);

let keyIndex = 0;

// =====================================================
// API KEY ROTATOR
// =====================================================

const getNextKey = () => {
    if (!API_KEYS.length) {
        throw new Error("No Gemini API Keys Found");
    }

    const key = API_KEYS[keyIndex];
    keyIndex = (keyIndex + 1) % API_KEYS.length;

    return key;
};

// =====================================================
// GEMINI REQUEST ENGINE — RETRIES + DIAGNOSTICS
// =====================================================

const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

async function callGemini(contents, isJson = false) {
    if (!API_KEYS.length) {
        throw new Error("No Gemini API Keys Found");
    }

    let lastError;
    const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

    for (let i = 0; i < API_KEYS.length; i++) {
        const keySlot = keyIndex;
        const key = getNextKey();

        // Three attempts per key for temporary failures.
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const payload = { contents };

                if (isJson) {
                    payload.generationConfig = {
                        responseMimeType: "application/json"
                    };
                }

                console.log(
                    `[Gemini] Request | Model=${MODEL} | Key=${keySlot + 1}/${API_KEYS.length} | Attempt=${attempt}/3`
                );

                const response = await axios.post(
                    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
                    payload,
                    {
                        timeout: 45000,
                        headers: {
                            "Content-Type": "application/json"
                        }
                    }
                );

                const candidate = response.data?.candidates?.[0];

                const resultText = candidate?.content?.parts
                    ?.map(part => part.text || "")
                    .filter(Boolean)
                    .join("\n");

                if (resultText && resultText.trim()) {
                    console.log(
                        `[Gemini] Success | Model=${MODEL} | Key=${keySlot + 1}`
                    );
                    return resultText.trim();
                }

                const blockReason =
                    response.data?.promptFeedback?.blockReason;

                throw new Error(
                    blockReason
                        ? `Gemini blocked the prompt: ${blockReason}`
                        : `Gemini returned no text. Finish reason: ${
                            candidate?.finishReason || "Unknown"
                        }.`
                );

            } catch (err) {
                lastError = err;

                const status = err.response?.status;
                const code = err.code || "UNKNOWN";
                const providerDetails = err.response?.data
                    ? JSON.stringify(err.response.data).slice(0, 2500)
                    : err.message;

                console.error(
                    `[Gemini] FAILED | Key=${keySlot + 1}/${API_KEYS.length} | Attempt=${attempt}/3 | Status=${status || "N/A"} | Code=${code}`
                );
                console.error(`[Gemini] Provider details: ${providerDetails}`);

                // Retry temporary capacity, rate-limit and network failures.
                const retryable =
                    !status ||
                    [408, 429, 500, 502, 503, 504].includes(status);

                if (!retryable) {
                    break;
                }

                if (attempt < 3) {
                    const delay = 1500 * Math.pow(2, attempt - 1);
                    console.log(`[Gemini] Retrying in ${delay}ms...`);
                    await sleep(delay);
                }
            }
        }

        console.log("[Gemini] Moving to the next API key...");
    }

    const finalError = new Error(
        lastError?.message || "All Gemini API keys failed"
    );

    finalError.status = lastError?.response?.status;
    finalError.providerResponse = lastError?.response?.data;
    finalError.code = lastError?.code;

    throw finalError;
}

// Return a suitable HTTP status to callers when Gemini fails.
function getUpstreamStatus(err) {
    const status = Number(err?.status || err?.response?.status);

    if ([429, 503, 504].includes(status)) return status;
    if ([400, 401, 403].includes(status)) return status;
    if ([408].includes(status)) return 504;

    return 502;
}

// =====================================================
// OCR SPACE
// =====================================================

async function ocrSpace(fileBase64) {
    try {
        const clean = fileBase64.replace(/^data:.*?;base64,/, "");
        const formData = new URLSearchParams();

        formData.append("base64Image", clean);
        formData.append("language", "eng");
        formData.append("OCREngine", "2");

        const response = await axios.post(
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

        return response.data
            ?.ParsedResults
            ?.map(r => r.ParsedText)
            .join("\n")
            ?.trim() || "";

    } catch (err) {
        console.error(
            "[OCR] Request failed:",
            err.response?.data || err.message
        );
        return "";
    }
}

// =====================================================
// NIGERIA TIME
// =====================================================

const getNigeriaTime = () => {
    return new Intl.DateTimeFormat(
        "en-GB",
        {
            timeZone: "Africa/Lagos",
            day: "2-digit",
            month: "long",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true
        }
    ).format(new Date());
};

// =====================================================
// HOME ROUTE
// =====================================================

app.get("/", (req, res) => {
    res.send(`
        <h1>🤖 JARVIS CORE</h1>
        <p>ONLINE</p>
        <p>${getNigeriaTime()}</p>
    `);
});

// =====================================================
// TEST ROUTE
// =====================================================

app.get("/test", (req, res) => {
    res.json({
        success: true,
        message: "AI Server Online",
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        configuredGeminiKeys: API_KEYS.length,
        time: getNigeriaTime()
    });
});

// =====================================================
// AI ROUTE (DYNAMIC PERSONALITY)
// =====================================================

app.post("/ai", async (req, res) => {
    try {
        const { prompt, image, botName } = req.body;

        const personalities = {
            "Alexa": "You are Alexa, the official AI assistant for Flexi Digital Academy. Be professional, concise, and helpful.",
            "Jarvis": "You are JARVIS for Flexi Digital Academy. Be educational and technical."
        };

        const identity = personalities[botName] || personalities["Jarvis"];

        const parts = [
            {
                text: `${identity}

NO LATEX.
Use Unicode symbols like:
√ π ± ² ³

User:
${prompt || "Analyze this"}`
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

        return res.json({
            success: true,
            result: result || "No response received from the AI."
        });

    } catch (err) {
        console.error("❌ AI Route Error:", {
            message: err.message,
            status: err.status || err.response?.status || null,
            code: err.code || null,
            providerResponse: err.providerResponse || err.response?.data || null
        });

        return res.status(getUpstreamStatus(err)).json({
            success: false,
            error: "AI processing failed",
            details: err.message,
            providerStatus: err.status || err.response?.status || null
        });
    }
});

// =====================================================
// SMART GRAMMAR ROUTE
// =====================================================

app.post("/grammar", async (req, res) => {
    try {
        const { text } = req.body;

        if (!text || text.trim().length < 2) {
            return res.status(400).json({
                success: false,
                error: "Text required"
            });
        }

        // STAGE 1: SEVERITY DETECTION

        const judgePrompt =
`You are a smart Nigerian English and Pidgin detector.

Your task:
Determine whether a message truly needs grammar correction.

IMPORTANT:
Do NOT correct:
- Nigerian Pidgin
- Mixed Pidgin + English
- WhatsApp slang
- Internet slang
- Casual abbreviations
- Informal African English
- Understandable street expressions

Only correct:
- Serious grammatical mistakes
- Broken English that harms understanding
- Severe spelling issues
- Academic or formal sentence errors

RETURN ONLY JSON.

EITHER:

{
  "action": "IGNORE"
}

OR

{
  "action": "CORRECT"
}

EXAMPLES:

"omo this assignment hard"
→ IGNORE

"abeg who get answer"
→ IGNORE

"I no understand this question"
→ IGNORE

"Shey you dey come today?"
→ IGNORE

"pls can u help me"
→ IGNORE

"He go school yesterday"
→ CORRECT

"Does people knows the answer?"
→ CORRECT

"I am goinged to school"
→ CORRECT

USER:
${text}`;

        const judgeResult = await callGemini(
            [
                {
                    parts: [
                        {
                            text: judgePrompt
                        }
                    ]
                }
            ],
            true
        );

        let judgeParsed;

        try {
            judgeParsed = JSON.parse(judgeResult);
        } catch {
            return res.json({
                success: true,
                ignored: true
            });
        }

        if (judgeParsed.action === "IGNORE") {
            return res.json({
                success: true,
                ignored: true
            });
        }

        // STAGE 2: FULL CORRECTION

        const correctionPrompt =
`You are an advanced grammar correction engine.

Your task:
- Correct serious grammar mistakes
- Correct spelling mistakes
- Fix broken English naturally
- Preserve original meaning

RULES:
- Return ONLY JSON
- No markdown
- No explanations
- No extra text

RESPONSE FORMAT:

{
  "type": "grammar",
  "reply": "Corrected sentence"
}

OR

{
  "type": "spelling",
  "reply": "Corrected sentence"
}

USER:
${text}`;

        const correctionResult = await callGemini(
            [
                {
                    parts: [
                        {
                            text: correctionPrompt
                        }
                    ]
                }
            ],
            true
        );

        let parsed;

        try {
            parsed = JSON.parse(correctionResult);
        } catch {
            console.log("❌ Invalid Correction JSON:", correctionResult);

            return res.json({
                success: true,
                ignored: true
            });
        }

        if (
            !parsed.reply ||
            parsed.reply.trim().toLowerCase() === text.trim().toLowerCase()
        ) {
            return res.json({
                success: true,
                ignored: true
            });
        }

        return res.json({
            success: true,
            type: parsed.type || "grammar",
            reply: parsed.reply
        });

    } catch (err) {
        console.error("❌ Grammar Route Error:", {
            message: err.message,
            status: err.status || err.response?.status || null,
            providerResponse: err.providerResponse || err.response?.data || null
        });

        return res.status(getUpstreamStatus(err)).json({
            success: false,
            error: "Grammar engine failed",
            details: err.message,
            providerStatus: err.status || err.response?.status || null
        });
    }
});

// =====================================================
// IMAGE ROUTE — PUTER AI
// =====================================================

app.get("/image", async (req, res) => {
    const prompt = String(req.query.prompt || "").trim();

    if (!prompt) {
        return res.status(400).json({
            success: false,
            error: "Prompt required"
        });
    }

    if (!process.env.PUTER_AUTH_TOKEN) {
        console.error(
            "Puter image error: PUTER_AUTH_TOKEN is not configured."
        );

        return res.status(503).json({
            success: false,
            error: "Image generation is not configured"
        });
    }

    try {
        const imageElement = await puter.ai.txt2img(prompt);
        const imageUrl = imageElement?.src || imageElement?.url;

        if (!imageUrl || typeof imageUrl !== "string") {
            throw new Error("Puter did not return an image URL.");
        }

        return res.json({
            success: true,
            image: imageUrl
        });

    } catch (err) {
        console.error(
            "Puter image-generation error:",
            err?.message || err
        );

        return res.status(502).json({
            success: false,
            error: "Image generation failed. Please try again."
        });
    }
});

// =====================================================
// PDF ROUTE
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
            fileBase64.replace(
                /^data:application\/pdf;base64,/,
                ""
            ),
            "base64"
        );

        let text = "";

        try {
            const pdfData = await pdfParse(buffer);
            text = pdfData.text || "";
        } catch (err) {
            console.error("[PDF] Text extraction failed:", err.message);
        }

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
`Analyze this document:

${text}

User Request:
${prompt || "Summarize"}`
                    }
                ]
            }
        ]);

        return res.json({
            success: true,
            result
        });

    } catch (err) {
        console.error("❌ PDF Route Error:", {
            message: err.message,
            status: err.status || err.response?.status || null,
            providerResponse: err.providerResponse || err.response?.data || null
        });

        return res.status(getUpstreamStatus(err)).json({
            success: false,
            error: "PDF failed",
            details: err.message,
            providerStatus: err.status || err.response?.status || null
        });
    }
});

// =====================================================
// QUIZ GENERATION ROUTE
// =====================================================

app.post("/generate-quiz", async (req, res) => {
    try {
        const subject = await runQuizGenerationPipeline();

        return res.json({
            success: true,
            message: `Quiz deployed for ${subject}`
        });

    } catch (err) {
        console.error("❌ Quiz Route Error:", {
            message: err.message,
            status: err.status || err.response?.status || null,
            providerResponse: err.providerResponse || err.response?.data || null
        });

        return res.status(getUpstreamStatus(err)).json({
            success: false,
            error: "Quiz generation failed",
            details: err.message,
            providerStatus: err.status || err.response?.status || null
        });
    }
});

// =====================================================
// QUIZ ENGINE
// =====================================================

async function runQuizGenerationPipeline() {
    const subjects = [
        "Mathematics",
        "Physics",
        "Chemistry",
        "Biology",
        "English Language"
    ];

    const randomSubject =
        subjects[Math.floor(Math.random() * subjects.length)];

    const prompt =
`Generate exactly 5 Post-UTME multiple choice questions for ${randomSubject}.

Return ONLY JSON:

{
  "subject": "${randomSubject}",
  "quizText": "formatted quiz",
  "answers": ["A","B","C","D","A"]
}`;

    const resultJson = await callGemini(
        [
            {
                parts: [
                    {
                        text: prompt
                    }
                ]
            }
        ],
        true
    );

    const quizData = JSON.parse(resultJson);

    if (
        !quizData.subject ||
        !quizData.quizText ||
        !Array.isArray(quizData.answers)
    ) {
        throw new Error("Gemini returned invalid quiz JSON");
    }

    await axios.post(
        "https://jarvisaiserver.onrender.com/webhook/trigger-quiz",
        {
            subject: quizData.subject,
            quizText: quizData.quizText,
            answers: quizData.answers
        },
        {
            timeout: 30000
        }
    );

    return randomSubject;
}

// =====================================================
// AUTO QUIZ CLOCK (DAILY 7PM WAT)
// =====================================================

let quizFiredToday = false;

setInterval(async () => {
    try {
        const currentDate = new Date();

        const currentHour = new Intl.DateTimeFormat(
            "en-GB",
            {
                timeZone: "Africa/Lagos",
                hour: "2-digit",
                hour12: false
            }
        ).format(currentDate);

        const currentMinute = new Intl.DateTimeFormat(
            "en-GB",
            {
                timeZone: "Africa/Lagos",
                minute: "2-digit"
            }
        ).format(currentDate);

        if (currentHour === "19" && currentMinute === "00") {
            if (!quizFiredToday) {
                quizFiredToday = true;

                console.log("⏰ Running DAILY scheduled quiz...");

                const subject = await runQuizGenerationPipeline();

                console.log(`✅ Quiz completed for ${subject}`);
            }
        } else if (quizFiredToday) {
            quizFiredToday = false;
            console.log("🔄 Daily quiz lock reset");
        }

    } catch (err) {
        console.error("⚠️ Quiz Clock Error:", {
            message: err.message,
            status: err.status || err.response?.status || null,
            providerResponse: err.providerResponse || err.response?.data || null
        });
    }
}, 60000);

// =====================================================
// START SERVER
// =====================================================

app.listen(PORT, () => {
    console.log(`🚀 JARVIS RUNNING ON PORT ${PORT}`);
    console.log(`[Gemini] Configured API keys: ${API_KEYS.length}`);
    console.log(`[Gemini] Model: ${process.env.GEMINI_MODEL || "gemini-2.5-flash"}`);
});
