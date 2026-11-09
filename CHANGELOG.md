# Changelog

## 1.5.0 — Prompt-budget and correlation diagnostics

- Added request correlation IDs and response `x-correlation-id` headers.
- Added prompt-character and serialized-request-byte measurement before Gemini calls.
- Preserved the default 50,000-character gateway prompt limit and added a configurable lower ceiling.
- Added structured 413 pre-provider rejection diagnostics, including prompt chars, request bytes, model and response format.
- Added structured provider error classes for rate limiting, authentication, timeouts, provider failures and invalid structured output.
- Normalized Express oversized-body and malformed-JSON errors into structured JSON responses.
- Added unit tests for request metrics, correlation IDs and provider error classification.


## 1.4.0 - 2026-11-08
- Validate provider output as a JSON object whenever responseFormat=json is requested.
- Return a clear upstream error instead of forwarding malformed planner output as successful JSON.
- Update project documentation and package version.

# Changelog

## 1.5.0 — Prompt-budget and correlation diagnostics

- Added request correlation IDs and response `x-correlation-id` headers.
- Added prompt-character and serialized-request-byte measurement before Gemini calls.
- Preserved the default 50,000-character gateway prompt limit and added a configurable lower ceiling.
- Added structured 413 pre-provider rejection diagnostics, including prompt chars, request bytes, model and response format.
- Added structured provider error classes for rate limiting, authentication, timeouts, provider failures and invalid structured output.
- Normalized Express oversized-body and malformed-JSON errors into structured JSON responses.
- Added unit tests for request metrics, correlation IDs and provider error classification.


## 1.3.0
- Added shared-key authentication to `/ai`, `/grammar`, and `/image`.
- Added JSON response mode to `/ai` for JARVIS structured planning.
- Removed provider error details from public error responses.
- Kept PDF and quiz workflows outside this AI service.
