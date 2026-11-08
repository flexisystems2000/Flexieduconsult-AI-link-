# Flexieduconsult AI Link — v1.4.0

Authenticated AI gateway for JARVIS. It provides Gemini reasoning, image understanding, grammar assistance, and Puter image generation.

## Responsibilities
- `POST /ai` — Gemini text and image understanding. Set `responseFormat: "json"` for structured planner responses; the gateway verifies that the provider returned a JSON object before responding successfully.
- `POST /grammar` — grammar detection and correction.
- `GET /image?prompt=...` — Puter image generation.
- `GET /` and `GET /test` — public health/status endpoints.

PDF creation/extraction belongs to the Python document service. ALOC retrieval, WhatsApp polls, voting windows, explanations and quiz progression belong to JARVIS.

## Setup
Run `npm install && npm start` with Node.js 18+. Set `JARVIS_API_KEY` to a long random secret and set the exact same value as `AI_API_KEY` in JARVIS. `/ai`, `/grammar`, and `/image` require `x-api-key` or Bearer authentication. Health routes remain public.

## Environment
- `PORT` — HTTP port, default 3000.
- `JARVIS_API_KEY` — required shared secret for JARVIS service calls.
- `GEMINI_API_KEY_1` — primary Gemini key; keys 2–5 are optional rotation keys.
- `GEMINI_MODEL` — defaults to `gemini-2.5-flash`.
- `PUTER_AUTH_TOKEN` — Puter image-generation credential.

Example:
```bash
curl -X POST "$AI_API_URL/ai" -H 'Content-Type: application/json' -H "x-api-key: $JARVIS_API_KEY" -d '{"prompt":"Explain photosynthesis","botName":"Jarvis"}'
```
Never expose `JARVIS_API_KEY` to WhatsApp users or client-side applications.
