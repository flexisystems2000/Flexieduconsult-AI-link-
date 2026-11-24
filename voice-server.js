'use strict';

// Keep the existing Express application and routes unchanged. Attach the
// authenticated Gemini Live WebSocket gateway to the HTTP server it creates.
const express = require('express');
const originalListen = express.application.listen;
express.application.listen = function (...args) {
  const server = originalListen.apply(this, args);
  require('./voiceGateway').attachVoiceGateway(server);
  return server;
};

require('./index');
