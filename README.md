# 🤖 Gemini Link API

A lightweight Node.js Express wrapper for the Google Gemini 1.5 Flash API. This service provides a simple HTTP endpoint to interact with Gemini's generative AI models.

## 🚀 Features
- **Simple Endpoint:** Ask questions via a basic GET request.
- **Fast Performance:** Uses the optimized `gemini-1.5-flash` model.
- **Error Handling:** Built-in validation for missing parameters and API errors.
- **Production Ready:** Includes timeouts and environment variable security.

---

## 🛠️ Installation

1. **Clone or create your project folder:**
   ```bash
   mkdir gemini-api && cd gemini-api

## 2. Install dependencies
```bash
 npm install

## 3. **Set up your API Key:**
   Obtain an API key from the [Google AI Studio](https://aistudio.google.com/).

---

## ⚙️ Environment Variables

To run this project, you need to add the following environment variable to your `.env` file or your hosting provider (Heroku, Render, etc.):

`GEMINI_API_KEY` = Your_Google_Gemini_API_Key

---

## 🖥️ Usage

### Start the server
```bash
npm start




