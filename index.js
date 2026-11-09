require("dotenv").config();

const express = require("express");
const axios = require("axios");
const { init: initPuter } = require("@heyputer/puter.js/src/init.cjs");
const { DEFAULT_MAX_PROMPT_CHARS, DEFAULT_MAX_REQUEST_BYTES, correlationId, requestMetrics, classifyProviderError } = require("./gateway-utils");

// Puter AI image-generation client
const puter = initPuter(process.env.PUTER_AUTH_TOKEN);
const app = express();
const PORT = process.env.PORT || 3000;
const MAX_PROMPT_CHARS = Math.max(1000, Math.min(Number(process.env.AI_MAX_PROMPT_CHARS) || DEFAULT_MAX_PROMPT_CHARS, DEFAULT_MAX_PROMPT_CHARS));
const MAX_REQUEST_BYTES = Math.max(1024 * 1024, Math.min(Number(process.env.AI_MAX_REQUEST_BYTES) || DEFAULT_MAX_REQUEST_BYTES, DEFAULT_MAX_REQUEST_BYTES));
app.use((req, res, next) => {
    req.correlationId = correlationId(req.get("x-correlation-id"));
    res.setHeader("x-correlation-id", req.correlationId);
    next();
});

// =====================================================
// MIDDLEWARE
// =====================================================

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({
    extended: true,
    limit: "15mb"
}));

// Private service-to-service authentication. Keep / and /test public for health checks.
function requireJarvisAuth(req, res, next) {
    const expected = String(process.env.JARVIS_API_KEY || "").trim();
    if (!expected) {
        console.error("[AI Link] Authentication pre-rejection", { correlationId: req.correlationId, reason: "missing_server_secret", path: req.path });
        return res.status(503).json({ success: false, code: "AUTH_NOT_CONFIGURED", error: "AI service authentication is not configured", correlationId: req.correlationId });
    }
    const supplied = String(req.get("x-api-key") || req.get("authorization")?.replace(/^Bearer\s+/i, "") || "").trim();
    const a = Buffer.from(supplied);
    const b = Buffer.from(expected);
    const valid = a.length === b.length && require("crypto").timingSafeEqual(a, b);
    if (!valid) {
        console.warn("[AI Link] Authentication pre-rejection", { correlationId: req.correlationId, reason: "invalid_client_secret", path: req.path });
        return res.status(401).json({ success: false, code: "AUTH_INVALID", error: "Unauthorized service client", correlationId: req.correlationId });
    }
    next();
}
app.use(["/ai", "/grammar", "/image"], requireJarvisAuth);

const requestWindows = new Map();
function limitServiceRequests(req, res, next) {
    const key = String(req.ip || req.socket?.remoteAddress || "unknown");
    const now = Date.now();
    const window = requestWindows.get(key) || { start: now, count: 0 };
    if (now - window.start >= 60_000) {
        window.start = now;
        window.count = 0;
    }
    window.count += 1;
    requestWindows.set(key, window);
    if (requestWindows.size > 5000) {
        for (const [ip, value] of requestWindows) {
            if (now - value.start > 120_000) requestWindows.delete(ip);
        }
    }
    if (window.count > 90) {
        console.warn("[AI Link] Service rate limit pre-rejection", { correlationId: req.correlationId, path: req.path });
        return res.status(429).json({ success: false, code: "SERVICE_RATE_LIMIT", error: "AI service rate limit exceeded", correlationId: req.correlationId });
    }
    next();
}
app.use(["/ai", "/grammar", "/image"], limitServiceRequests);

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
        authenticated: Boolean(process.env.JARVIS_API_KEY),
        time: getNigeriaTime()
    });
});

// =====================================================
// AI ROUTE (DYNAMIC PERSONALITY)
// =====================================================

app.post("/ai", async (req, res) => {
    const metrics = requestMetrics(req.body);
    const { promptChars, requestBytes, responseFormat, model } = metrics;
    const diagnostic = { correlationId: req.correlationId, promptChars, requestBytes, responseFormat, model };
    try {
        const { prompt, image, botName, responseFormat: requestedFormat } = req.body || {};
        const promptText = String(prompt || "Analyze this");
        const wantsJson = String(requestedFormat || "").toLowerCase() === "json";
        if (requestedFormat && !["json", "text"].includes(String(requestedFormat).toLowerCase())) {
            console.warn("[AI Link] Pre-provider rejection", { ...diagnostic, reason: "invalid_response_format" });
            return res.status(400).json({ success: false, code: "INVALID_RESPONSE_FORMAT", error: "responseFormat must be json or text", ...diagnostic });
        }
        if (promptChars > MAX_PROMPT_CHARS) {
            console.warn("[AI Link] Pre-provider rejection", { ...diagnostic, reason: "prompt_character_budget", maxPromptChars: MAX_PROMPT_CHARS });
            return res.status(413).json({ success: false, code: "PROMPT_TOO_LARGE", error: "Prompt exceeds the configured gateway prompt limit", maxPromptChars: MAX_PROMPT_CHARS, ...diagnostic });
        }
        if (requestBytes > MAX_REQUEST_BYTES) {
            console.warn("[AI Link] Pre-provider rejection", { ...diagnostic, reason: "serialized_request_budget", maxRequestBytes: MAX_REQUEST_BYTES });
            return res.status(413).json({ success: false, code: "REQUEST_TOO_LARGE", error: "Serialized AI request exceeds the configured request-size limit", maxRequestBytes: MAX_REQUEST_BYTES, ...diagnostic });
        }
        if (image && String(image).length > 12 * 1024 * 1024) {
            console.warn("[AI Link] Pre-provider rejection", { ...diagnostic, reason: "image_payload_budget" });
            return res.status(413).json({ success: false, code: "IMAGE_TOO_LARGE", error: "Image payload exceeds the 12 MB limit", ...diagnostic });
        }
        const personalities = {
            "Alexa": "You are Alexa, the official AI assistant for Flexi Digital Academy. Be professional, concise, and helpful.",
            "Jarvis": "You are JARVIS for Flexi Digital Academy. Be educational and technical."
        };
        const identity = personalities[botName] || personalities["Jarvis"];
        const parts = [{
            text: `${identity}

NO LATEX.
Use Unicode symbols like:
√ π ± ² ³

User:
${promptText}`
        }];
        if (image) parts.push({ inline_data: { mime_type: "image/jpeg", data: image.replace(/^data:.*?;base64,/, "") } });
        console.info("[AI Link] Provider request", diagnostic);
        const result = await callGemini([{ parts }], wantsJson);
        if (wantsJson) {
            let parsed;
            try { parsed = JSON.parse(String(result || "")); }
            catch (_) {
                console.error("[AI Link] Structured response rejected", { ...diagnostic, reason: "invalid_json" });
                return res.status(502).json({ success: false, code: "INVALID_STRUCTURED_RESPONSE", error: "AI provider returned invalid JSON", ...diagnostic });
            }
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                console.error("[AI Link] Structured response rejected", { ...diagnostic, reason: "not_json_object" });
                return res.status(502).json({ success: false, code: "INVALID_STRUCTURED_RESPONSE", error: "AI provider returned an invalid JSON object", ...diagnostic });
            }
            return res.json({ success: true, result: JSON.stringify(parsed), ...diagnostic });
        }
        return res.json({ success: true, result: result || "No response received from the AI.", ...diagnostic });
    } catch (err) {
        const classified = classifyProviderError(err);
        console.error("[AI Link] Provider failure", {
            ...diagnostic, errorCode: classified.code,
            providerStatus: err.status || err.response?.status || null,
            providerCode: err.code || null,
            providerMessage: String(err.message || "Provider request failed").slice(0, 500)
        });
        return res.status(classified.status).json({
            success: false, code: classified.code,
            error: classified.category === "provider_rate_limit" ? "AI provider rate limit reached" :
                classified.category === "provider_timeout" ? "AI provider request timed out" : "AI processing failed",
            providerStatus: err.status || err.response?.status || null, ...diagnostic
        });
    }
});

// =====================================================
// SMART GRAMMAR ROUTE
// =====================================================

app.post("/grammar", async (req, res) => {
    try {
        const { text } = req.body;

        if (!text || typeof text !== "string" || text.trim().length < 2) {
            return res.status(400).json({
                success: false,
                error: "Text required"
            });
        }

        if (text.length > 20000) {
            return res.status(413).json({ success: false, error: "Text exceeds the 20,000-character limit" });
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
    if (prompt.length > 4000) {
        return res.status(413).json({ success: false, error: "Image prompt exceeds the 4,000-character limit" });
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

// Normalize body-parser failures into a structured diagnostic response.
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err?.type === "entity.too.large" || err?.status === 413) {
        console.warn("[AI Link] Request parser pre-rejection", { correlationId: req.correlationId, reason: "request_body_too_large", contentLength: req.get("content-length") || null });
        return res.status(413).json({ success: false, code: "REQUEST_BODY_TOO_LARGE", error: "HTTP request body exceeds the 15 MB parser limit", correlationId: req.correlationId, requestBytes: Number(req.get("content-length")) || null });
    }
    if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
        return res.status(400).json({ success: false, code: "INVALID_REQUEST_JSON", error: "Request body must contain valid JSON", correlationId: req.correlationId });
    }
    console.error("[AI Link] Unhandled route error", { correlationId: req.correlationId, message: String(err?.message || "Unknown error").slice(0, 300) });
    return res.status(500).json({ success: false, code: "INTERNAL_ERROR", error: "AI service request failed", correlationId: req.correlationId });
});

// =====================================================
// START SERVER
// =====================================================

app.listen(PORT, () => {
    console.log(`🚀 JARVIS RUNNING ON PORT ${PORT}`);
    console.log(`[Gemini] Configured API keys: ${API_KEYS.length}`);
    console.log(`[Gemini] Model: ${process.env.GEMINI_MODEL || "gemini-2.5-flash"}`);
});
