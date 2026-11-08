# Changelog

## 1.4.0 - 2026-11-08
- Validate provider output as a JSON object whenever responseFormat=json is requested.
- Return a clear upstream error instead of forwarding malformed planner output as successful JSON.
- Update project documentation and package version.

# Changelog

## 1.3.0
- Added shared-key authentication to `/ai`, `/grammar`, and `/image`.
- Added JSON response mode to `/ai` for JARVIS structured planning.
- Removed provider error details from public error responses.
- Kept PDF and quiz workflows outside this AI service.
