# Flexieduconsult AI Link — v1.6.0

Authenticated AI gateway for JARVIS. It provides Gemini reasoning, image understanding, real-time Gemini Live voice sessions, grammar assistance, and Puter image generation.

## Responsibilities
- `POST /ai` — Gemini text and image understanding. Set `responseFormat: "json"` for structured planner responses; the gateway verifies that the provider returned a JSON object before responding successfully.
- `POST /grammar` — grammar detection and correction.
- `WS /voice` — authenticated, bidirectional Gemini Live audio streaming for WhatsApp voice calls. JARVIS sends 16 kHz PCM audio frames and receives 24 kHz PCM audio frames, transcripts, and session events. The Gemini credentials stay on this server.
- `GET /image?prompt=...` — Puter image generation.
- `GET /` and `GET /test` — public health/status endpoints.

PDF creation/extraction belongs to the Python document service. ALOC retrieval, WhatsApp polls, voting windows, explanations and quiz progression belong to JARVIS.

## Setup
Run `npm install && npm start` with Node.js 18+. Set `JARVIS_API_KEY` to a long random secret and set the exact same value as `AI_API_KEY` in JARVIS. `/ai`, `/grammar`, `/image`, and the `/voice` WebSocket upgrade require `x-api-key` or Bearer authentication. Health routes remain public. The `npm start` entry point attaches the voice gateway to the existing HTTP server without changing the existing Express routes.

## Request budgets and diagnostics

`POST /ai` keeps a hard 50,000-character prompt ceiling by default. The gateway measures both prompt characters and the serialized JSON request size before calling Gemini. Pre-provider rejections return structured JSON with a stable `code`, `correlationId`, `promptChars`, `requestBytes`, `responseFormat`, and `model`; logs record the same diagnostics without logging API credentials. The response includes an `x-correlation-id` header.

- `AI_MAX_PROMPT_CHARS` — optional lower prompt ceiling; defaults to 50,000 and cannot raise the hard ceiling.
- `AI_MAX_REQUEST_BYTES` — optional serialized JSON request limit; defaults to 12 MB and cannot raise that limit.
- Error codes distinguish `PROMPT_TOO_LARGE`, `REQUEST_TOO_LARGE`, `GEMINI_RATE_LIMIT`, `GEMINI_AUTH_ERROR`, `GEMINI_TIMEOUT`, `GEMINI_PROVIDER_ERROR`, and `INVALID_STRUCTURED_RESPONSE`.

## Environment
- `PORT` — HTTP port, default 3000.
- `JARVIS_API_KEY` — required shared secret for JARVIS service calls.
- `GEMINI_API_KEY_1` — primary Gemini key; keys 2–5 are optional rotation keys.
- `GEMINI_MODEL` — defaults to `gemini-2.5-flash` for HTTP text requests.
- `GEMINI_LIVE_MODEL` — defaults to `gemini-2.5-flash-native-audio-preview-12-2025` for voice calls.
- `GEMINI_LIVE_SYSTEM_INSTRUCTION` — optional voice-assistant instruction override.
- `PUTER_AUTH_TOKEN` — Puter image-generation credential.

Example:
```bash
curl -X POST "$AI_API_URL/ai" -H 'Content-Type: application/json' -H "x-api-key: $JARVIS_API_KEY" -d '{"prompt":"Explain photosynthesis","botName":"Jarvis"}'
```
Never expose `JARVIS_API_KEY` to WhatsApp users or client-side applications.

## Voice WebSocket protocol

Connect JARVIS to `wss://<AI_LINK_HOST>/voice` with the same `x-api-key` used for the authenticated HTTP gateway. The server sends a `ready` event after Gemini Live is connected. Send JSON messages of the form:

```json
{"type":"audio","data":"<base64 PCM16LE>","mimeType":"audio/pcm;rate=16000"}
```

The gateway returns `audio` events containing Gemini PCM audio (normally 24 kHz), plus optional `transcript`, `interrupted`, and `turn_complete` events. Send `{"type":"audio_stream_end"}` when the caller's input stream ends. A `ping` message receives `pong`. Close the WebSocket when the WhatsApp call ends. The WebSocket payload limit is 256 KB per message.

The gateway uses `GEMINI_API_KEY_1` through `GEMINI_API_KEY_5` from this server and rotates keys when opening new sessions. Never put Gemini keys in JARVIS or send them to WhatsApp clients.
