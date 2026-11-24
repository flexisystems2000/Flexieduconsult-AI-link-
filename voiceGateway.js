'use strict';

const { WebSocketServer, WebSocket } = require('ws');
const crypto = require('crypto');

const API_KEYS = [
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
  process.env.GEMINI_API_KEY_5
].map(value => String(value || '').trim()).filter(Boolean);

const MODEL = String(process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live').trim();
const SYSTEM_INSTRUCTION = String(process.env.GEMINI_LIVE_SYSTEM_INSTRUCTION ||
  'You are JARVIS, the voice assistant for Flexi Educational Consult. Speak naturally, warmly, clearly and concisely. Listen carefully and answer the caller directly. Use Nigerian English naturally when appropriate. Do not claim to perform an action unless it has actually been completed.');

let nextKey = 0;
let genaiPromise;

function authorized(req) {
  const expected = String(process.env.JARVIS_API_KEY || '').trim();
  const supplied = String(req.headers['x-api-key'] || req.headers.authorization || '')
    .replace(/^Bearer\s+/i, '').trim();
  if (!expected || !supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function getGoogleGenAI() {
  if (!genaiPromise) genaiPromise = import('@google/genai').then(module => module.GoogleGenAI);
  return genaiPromise;
}

function safeSend(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

async function openLiveSession(socket, diagnostics) {
  if (!API_KEYS.length) throw new Error('No Gemini API keys are configured on AI Link.');
  const GoogleGenAI = await getGoogleGenAI();
  let lastError;
  // These buffers must live in the same scope as the Gemini onmessage callback.
  let callerTranscriptBuffer = '';
  let lastCallerTranscriptSent = '';
  for (let attempt = 0; attempt < API_KEYS.length; attempt++) {
    const slot = nextKey;
    const apiKey = API_KEYS[nextKey];
    nextKey = (nextKey + 1) % API_KEYS.length;
    try {
      const ai = new GoogleGenAI({ apiKey });
      const session = await ai.live.connect({
        model: MODEL,
        config: {
          responseModalities: ['AUDIO'],
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } },
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        },
        callbacks: {
          onmessage(message) {
            const content = message?.serverContent;
            if (content?.interrupted) safeSend(socket, { type: 'interrupted' });
            const parts = content?.modelTurn?.parts || [];
            for (const part of parts) {
              // The Google GenAI SDK normally exposes audio as inlineData.
              // Accept equivalent normalized shapes as well, without assuming
              // that a text transcription is itself playable audio.
              const audioPart = part?.inlineData || part?.inline_data || part?.audio;
              const audioData = typeof audioPart === 'string'
                ? audioPart
                : (audioPart?.data || audioPart?.bytes);
              if (typeof audioData === 'string' && audioData.length) {
                const mimeType = audioPart?.mimeType || audioPart?.mime_type || 'audio/pcm;rate=24000';
                diagnostics.outputFrames++;
                diagnostics.outputBytes += Buffer.byteLength(audioData, 'base64');
                if (diagnostics.outputFrames === 1 || diagnostics.outputFrames % 25 === 0) {
                  console.log('[AI Link Voice Audio] Gemini audio generated', {
                    frames: diagnostics.outputFrames, bytes: diagnostics.outputBytes, mimeType
                  });
                }
                safeSend(socket, { type: 'audio', data: audioData, mimeType });
              }
            }
            // Gemini Live SDK versions/models may expose input transcription
            // either under serverContent or as a top-level server message.
            // Transcription can also arrive in fragments, so buffer until finished.
            const callerTranscriptEvent =
              message?.inputTranscription ||
              content?.inputTranscription;
            const callerTranscript = String(callerTranscriptEvent?.text || '').trim();
            if (callerTranscript) {
              callerTranscriptBuffer += (callerTranscriptBuffer ? ' ' : '') + callerTranscript;
              // Some SDK responses omit "finished" on final transcription
              // messages; treat anything other than explicit false as final.
              if (callerTranscriptEvent?.finished !== false) {
                const finalTranscript = callerTranscriptBuffer.trim();
                callerTranscriptBuffer = '';
                if (finalTranscript && finalTranscript !== lastCallerTranscriptSent) {
                  lastCallerTranscriptSent = finalTranscript;
                  console.log('[AI Link Voice Audio] Caller speech transcription finalized', {
                    characters: finalTranscript.length,
                    source: message?.inputTranscription ? 'top-level' : 'serverContent'
                  });
                  safeSend(socket, { type: 'caller_transcript', text: finalTranscript });
                }
              }
            }
            const transcript = content?.outputTranscription?.text;
            if (transcript) {
              console.log('[AI Link Voice Audio] Gemini output transcript received', { characters: transcript.length });
              if (diagnostics.outputFrames === 0) {
                console.warn('[AI Link Voice Audio] Transcript arrived without audio; inspecting response shape', {
                  serverContentKeys: Object.keys(content || {}),
                  modelTurnPresent: Boolean(content?.modelTurn),
                  partsCount: parts.length,
                  partShapes: parts.slice(0, 4).map(part => ({
                    keys: Object.keys(part || {}),
                    inlineDataKeys: Object.keys(part?.inlineData || part?.inline_data || part?.audio || {})
                  })),
                  usageMetadataKeys: Object.keys(message?.usageMetadata || {})
                });
              }
              safeSend(socket, { type: 'transcript', text: transcript });
            }
            if (content?.turnComplete) {
              console.log('[AI Link Voice Audio] Gemini turn complete', {
                inputFrames: diagnostics.inputFrames, outputFrames: diagnostics.outputFrames
              });
              safeSend(socket, { type: 'turn_complete' });
            }
          },
          onerror(error) {
            console.error('[AI Link Voice] Gemini Live session error', {
              keySlot: slot + 1, message: String(error?.message || error).slice(0, 300)
            });
            safeSend(socket, { type: 'error', code: 'GEMINI_LIVE_ERROR', error: 'The live AI session encountered an error.' });
          },
          onclose(event) {
            safeSend(socket, { type: 'closed', reason: String(event?.reason || 'Gemini Live session closed').slice(0, 160) });
          }
        }
      });
      console.log('[AI Link Voice] Gemini Live session connected', { model: MODEL, keySlot: slot + 1 });
      return session;
    } catch (error) {
      lastError = error;
      console.warn('[AI Link Voice] Gemini Live connection attempt failed', {
        keySlot: slot + 1, status: error?.status || error?.response?.status || null,
        code: error?.code || null, message: String(error?.message || error).slice(0, 250)
      });
    }
  }
  throw lastError || new Error('Unable to connect to Gemini Live.');
}

function attachVoiceGateway(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    let pathname;
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { return; }
    if (pathname !== '/voice') return;
    if (!authorized(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });

  wss.on('connection', async socket => {
    let session;
    let closed = false;
    const diagnostics = { inputFrames: 0, inputBytes: 0, outputFrames: 0, outputBytes: 0 };
    socket.on('message', async raw => {
      let message;
      try { message = JSON.parse(raw.toString()); }
      catch { safeSend(socket, { type: 'error', code: 'INVALID_MESSAGE', error: 'Messages must be valid JSON.' }); return; }
      if (message.type === 'audio') {
        if (!session) { safeSend(socket, { type: 'error', code: 'SESSION_NOT_READY', error: 'The voice session is not ready.' }); return; }
        if (typeof message.data !== 'string' || message.data.length > 180000) {
          safeSend(socket, { type: 'error', code: 'INVALID_AUDIO', error: 'Audio payload is missing or too large.' }); return;
        }
        try {
          const audioBytes = Buffer.byteLength(message.data, 'base64');
          session.sendRealtimeInput({
            audio: {
              data: message.data,
              mimeType: String(message.mimeType || 'audio/pcm;rate=16000')
            }
          });
          diagnostics.inputFrames++;
          diagnostics.inputBytes += audioBytes;
          if (diagnostics.inputFrames === 1 || diagnostics.inputFrames % 50 === 0) {
            console.log('[AI Link Voice Audio] Caller audio received from JARVIS', {
              frames: diagnostics.inputFrames, bytes: diagnostics.inputBytes,
              mimeType: String(message.mimeType || 'audio/pcm;rate=16000')
            });
          }
        } catch (error) {
          safeSend(socket, { type: 'error', code: 'AUDIO_FORWARD_FAILED', error: 'Could not forward caller audio.' });
        }
      } else if (message.type === 'audio_stream_end' && session) {
        try { session.sendRealtimeInput({ audioStreamEnd: true }); } catch {}
      } else if (message.type === 'ping') {
        safeSend(socket, { type: 'pong' });
      }
    });
    socket.on('close', () => {
      closed = true;
      try { session?.close(); } catch {}
      session = null;
    });
    socket.on('error', error => console.warn('[AI Link Voice] WebSocket client error:', error.message));

    try {
      session = await openLiveSession(socket, diagnostics);
      if (closed) { try { session.close(); } catch {} return; }
      safeSend(socket, { type: 'ready', model: MODEL, input: 'audio/pcm;rate=16000', output: 'audio/pcm;rate=24000' });
      console.log('[AI Link Voice Audio] Voice session ready; audio diagnostics initialized.');
    } catch (error) {
      console.error('[AI Link Voice] Could not initialize session:', String(error?.message || error).slice(0, 300));
      safeSend(socket, { type: 'error', code: 'VOICE_UNAVAILABLE', error: 'Live voice service is temporarily unavailable.' });
      try { socket.close(1011, 'Voice service unavailable'); } catch {}
    }
  });

  console.log('[AI Link Voice] Authenticated /voice WebSocket gateway attached.');
  return wss;
}

module.exports = { attachVoiceGateway };
