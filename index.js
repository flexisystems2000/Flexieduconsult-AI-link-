require("dotenv").config();

const express = require("express");
const axios = require("axios");
const pdfParse = require("pdf-parse");

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

    keyIndex =
        (keyIndex + 1) % API_KEYS.length;

    return key;
};

// =====================================================
// GEMINI REQUEST ENGINE
// =====================================================

async function callGemini(
    contents,
    isJson = false
) {

    let lastError;

    for (let i = 0; i < API_KEYS.length; i++) {

        const key = getNextKey();

        try {

            const payload = {
                contents
            };

            // Force JSON response if needed
            if (isJson) {

                payload.generationConfig = {

                    responseMimeType:
                        "application/json"
                };
            }

            const response =
                await axios.post(

                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,

                    payload,

                    {
                        timeout: 45000,

                        headers: {
                            "Content-Type":
                                "application/json"
                        }
                    }
                );

            const text =
                response.data
                    ?.candidates?.[0]
                    ?.content?.parts?.[0]
                    ?.text;

            if (text) {
                return text;
            }

        } catch (err) {

            lastError = err;

            console.log(
                `⚠️ Gemini key ${i + 1} failed. Rotating...`
            );
        }
    }

    throw new Error(
        lastError?.message ||
        "Gemini request failed"
    );
}

// =====================================================
// OCR SPACE
// =====================================================

async function ocrSpace(fileBase64) {

    try {

        const clean =
            fileBase64.replace(
                /^data:.*?;base64,/,
                ""
            );

        const formData =
            new URLSearchParams();

        formData.append(
            "base64Image",
            clean
        );

        formData.append(
            "language",
            "eng"
        );

        formData.append(
            "OCREngine",
            "2"
        );

        const response =
            await axios.post(

                "https://api.ocr.space/parse/image",

                formData,

                {
                    headers: {

                        apikey:
                            process.env.OCR_API_KEY,

                        "Content-Type":
                            "application/x-www-form-urlencoded"
                    },

                    timeout: 30000
                }
            );

        return response.data
            ?.ParsedResults
            ?.map(r => r.ParsedText)
            .join("\n")
            ?.trim() || "";

    } catch {

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
        message: "AI Server Online"
    });
});

// =====================================================
// AI ROUTE
// =====================================================

app.post("/ai", async (req, res) => {

    try {

        const {
            prompt,
            image
        } = req.body;

        const parts = [

            {
                text:
`You are JARVIS for Flexi Digital Academy.

Be educational.
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

                    data:
                        image.replace(
                            /^data:.*?;base64,/,
                            ""
                        )
                }
            });
        }

        const result =
            await callGemini([
                { parts }
            ]);

        return res.json({

            success: true,

            result:
                result || "No response"
        });

    } catch (err) {

        console.log(
            "❌ AI Route Error:",
            err.message
        );

        return res.status(500).json({

            success: false,

            error: "AI failed"
        });
    }
});

// =====================================================
// SMART GRAMMAR ROUTE
// =====================================================

app.post("/grammar", async (req, res) => {

    try {

        const { text } = req.body;

        if (
            !text ||
            text.trim().length < 2
        ) {

            return res.status(400).json({

                success: false,

                error: "Text required"
            });
        }

        // =================================================
        // STAGE 1:
        // SEVERITY DETECTION
        // =================================================

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

        const judgeResult =
            await callGemini(

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

            judgeParsed =
                JSON.parse(judgeResult);

        } catch {

            return res.json({

                success: true,

                ignored: true
            });
        }

        // =================================================
        // IGNORE CASUAL MESSAGE
        // =================================================

        if (
            judgeParsed.action === "IGNORE"
        ) {

            return res.json({

                success: true,

                ignored: true
            });
        }

        // =================================================
        // STAGE 2:
        // FULL CORRECTION
        // =================================================

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

        const correctionResult =
            await callGemini(

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

            parsed =
                JSON.parse(correctionResult);

        } catch {

            console.log(
                "❌ Invalid Correction JSON:",
                correctionResult
            );

            return res.json({

                success: true,

                ignored: true
            });
        }

        // =================================================
        // VALIDATION
        // =================================================

        if (
            !parsed.reply ||
            parsed.reply
                .trim()
                .toLowerCase() ===
            text
                .trim()
                .toLowerCase()
        ) {

            return res.json({

                success: true,

                ignored: true
            });
        }

        // =================================================
        // SUCCESS
        // =================================================

        return res.json({

            success: true,

            type:
                parsed.type || "grammar",

            reply:
                parsed.reply
        });

    } catch (err) {

        console.log(
            "❌ Grammar Route Error:",
            err.message
        );

        return res.status(500).json({

            success: false,

            error:
                "Grammar engine failed"
        });
    }
});

// =====================================================
// IMAGE ROUTE
// =====================================================

app.get("/image", (req, res) => {

    const prompt =
        req.query.prompt;

    if (!prompt) {

        return res.status(400).json({

            success: false,

            error:
                "Prompt required"
        });
    }

    return res.json({

        success: true,

        image:
`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`
    });
});

// =====================================================
// PDF ROUTE
// =====================================================

app.post("/pdf", async (req, res) => {

    try {

        const {
            fileBase64,
            prompt
        } = req.body;

        if (!fileBase64) {

            return res.status(400).json({

                success: false,

                error:
                    "No PDF provided"
            });
        }

        const buffer =
            Buffer.from(

                fileBase64.replace(
                    /^data:application\/pdf;base64,/,
                    ""
                ),

                "base64"
            );

        let text = "";

        try {

            const pdfData =
                await pdfParse(buffer);

            text =
                pdfData.text || "";

        } catch {}

        if (
            text.trim().length < 50
        ) {

            text =
                await ocrSpace(fileBase64);
        }

        if (
            !text ||
            text.trim().length < 5
        ) {

            return res.json({

                success: false,

                error:
                    "Unreadable document"
            });
        }

        const result =
            await callGemini([

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

        console.log(
            "❌ PDF Route Error:",
            err.message
        );

        return res.status(500).json({

            success: false,

            error:
                "PDF failed"
        });
    }
});

// =====================================================
// QUIZ GENERATION ROUTE
// =====================================================

app.post(
    "/generate-quiz",

    async (req, res) => {

        try {

            const subject =
                await runQuizGenerationPipeline();

            return res.json({

                success: true,

                message:
`Quiz deployed for ${subject}`
            });

        } catch (err) {

            console.log(
                "❌ Quiz Route Error:",
                err.message
            );

            return res.status(500).json({

                success: false,

                error:
                    "Quiz generation failed"
            });
        }
    }
);

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
        subjects[
            Math.floor(
                Math.random() *
                subjects.length
            )
        ];

    const prompt =
`Generate exactly 5 Post-UTME multiple choice questions for ${randomSubject}.

Return ONLY JSON:

{
  "subject": "${randomSubject}",
  "quizText": "formatted quiz",
  "answers": ["A","B","C","D","A"]
}`;

    const resultJson =
        await callGemini(

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

    const quizData =
        JSON.parse(resultJson);

    await axios.post(

        "https://jarvisaiserver.onrender.com/webhook/trigger-quiz",

        {
            subject:
                quizData.subject,

            quizText:
                quizData.quizText,

            answers:
                quizData.answers
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

        const currentDate =
            new Date();

        const currentHour =
            new Intl.DateTimeFormat(
                "en-GB",
                {
                    timeZone:
                        "Africa/Lagos",

                    hour:
                        "2-digit",

                    hour12: false
                }
            ).format(currentDate);

        const currentMinute =
            new Intl.DateTimeFormat(
                "en-GB",
                {
                    timeZone:
                        "Africa/Lagos",

                    minute:
                        "2-digit"
                }
            ).format(currentDate);

        // =================================================
        // FIRE QUIZ EVERYDAY BY 7PM
        // =================================================

        if (
            currentHour === "19" &&
            currentMinute === "00"
        ) {

            if (!quizFiredToday) {

                quizFiredToday = true;

                console.log(
                    "⏰ Running DAILY scheduled quiz..."
                );

                const subject =
                    await runQuizGenerationPipeline();

                console.log(
                    `✅ Quiz completed for ${subject}`
                );
            }

        } else {

            // RESET AFTER 7PM WINDOW PASSES
            if (quizFiredToday) {

                quizFiredToday = false;

                console.log(
                    "🔄 Daily quiz lock reset"
                );
            }
        }

    } catch (err) {

        console.log(
            "⚠️ Quiz Clock Error:",
            err.message
        );

    }

}, 60000);

// =====================================================
// START SERVER
// =====================================================

app.listen(PORT, () => {

    console.log(
        `🚀 JARVIS RUNNING ON PORT ${PORT}`
    );
});
