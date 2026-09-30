# SpeakLog (speak-logs)

Bilingual voice agent that talks with a student for around 2 minutes and saves their verbatim daily work log in their own words.

Built with **React**, **Vite**, **Bootstrap 5**, the browser **Web Speech API**, and **OpenAI API** (`gpt-4o-mini`).

---

## 🚀 Features

- **2-Minute Voice Session**: Built-in countdown timer with subtle audio and visual indicators.
- **Bilingual Speech Pipeline**:
  - Voice input with Web Speech API for **Tamil (`ta-IN`)** and **English (`en-IN`)**.
  - Agent speech output via browser `speechSynthesis()`.
- **Three Core Questions**:
  1. *What did you try?* (நீங்கள் இன்று என்ன try பண்ணினீர்கள்?)
  2. *What broke or didn't work?* (என்ன சரியாக வரவில்லை?)
  3. *Why do you think that happened?* (ஏன் அப்படி நடந்தது என்று நினைக்கிறீர்கள்?)
- **Dynamic AI Follow-up**:
  - After each answer, the agent asks **exactly one follow-up question** powered by OpenAI's `gpt-4o-mini` via `/api/follow-up`.
  - Built-in contextual fallback when running offline or without an API key.
- **Verbatim Log Preservation**:
  - The student's exact spoken words are captured directly without summarization or rephrasing.
- **Voice Confirmation & Local Save**:
  - Reviews the complete log before saving.
  - Confirms via voice (*"yes, save it"*) or button click.
  - Persists logs locally to `localStorage` with generated log IDs.

---

## 🏗️ Architecture

```text
http://localhost:5173
       │
       │ Student's speech (ta-IN / en-IN via Web Speech API)
       ▼
React App (src/components/SpeakLog/SpeakLog.jsx)
       │
       ▼ POST /api/follow-up
Vite Middleware + OpenAI Handler (server/followUpHandler.js)
       │
       ▼ OpenAI API (gpt-4o-mini)
One Follow-up Question
       │
       ▼ Response { followUp }
React App
       │
       ▼
speechSynthesis() Speaks Question
```

---

## 🛠️ Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment (Optional)
Copy `.env.example` to `.env.local` to enable live OpenAI follow-up questions:
```bash
cp .env.example .env.local
```
Add your key:
```env
OPENAI_API_KEY=sk-...
```
*(You can also configure your OpenAI API Key directly inside the app using the settings button in the top bar.)*

### 3. Start Development Server
```bash
npm run dev
```
Open **[http://localhost:5173](http://localhost:5173)** in Google Chrome (required for the Web Speech API).

### 4. Build for Production
```bash
npm run build
```

---

## 📜 License
MIT
