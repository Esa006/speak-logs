# SpeakLog (speak-logs)

Bilingual voice agent that talks with an engineering student for around 2 minutes and saves their verbatim daily work log in their own words.

Built with **React**, **Vite**, **Bootstrap 5**, the browser **Web Speech API**, and **OpenAI API** (`gpt-4o-mini`).

---

## 🏛️ System Architecture

```text
                    SPEAKLOG
                       │
              ┌────────┴────────┐
              │                 │
           Tamil              English
              │                 │
              └────────┬────────┘
                       ↓
               Voice Agent
          SpeechSynthesis + Web Speech
                       ↓
              Conversation FSM
                       ↓
               OpenAI Follow-up
                       ↓
                 120 seconds
                       ↓
             Student Transcript
                       ↓
                  Confirmation
                       ↓
               Save Log + ID
                       ↓
              AI Mentor Analysis
                       ↓
                localStorage
```

---

## 💬 Conversation Phases

The conversation follows a clean, 9-stage state machine that keeps the student engaged and feels natural:

```text
INTRO       (Warm welcome + "What did you work on today?")
  ↓
WHAT_TRIED  (Student answers what they worked on)
  ↓
FOLLOWUP_1  (One natural follow-up question via OpenAI GPT-4o-mini)
  ↓
WHAT_BROKE  (Agent asks what broke or didn't work)
  ↓
FOLLOWUP_2  (One natural follow-up question via OpenAI GPT-4o-mini)
  ↓
WHY         (Agent asks why they think that happened / root cause)
  ↓
FOLLOWUP_3  (One natural follow-up question via OpenAI GPT-4o-mini)
  ↓
CONFIRM     (Review verbatim transcript + student confirms via voice or button)
  ↓
DONE        (Log ID generated + saved to localStorage + AI mentor analysis)
```

---

## 🔒 Security & Architecture

Secure, serverless architecture where **no API keys are ever stored in the browser or localStorage**:

```text
Browser (Web Speech API)
   ↓ POST /api/follow-up or /api/analyze
Vercel Serverless API (api/*.js)
   ↓ (Server-side OPENAI_API_KEY)
OpenAI API (gpt-4o-mini)
```

- **Environment Variable**: Use only `OPENAI_API_KEY=your_key` inside Vercel Environment Variables (or `.env.local` for local development).
- **Zero Client Key Storage**: `speaklog_openai_api_key` has been completely eliminated from the client-side code and browser `localStorage`.
- **Persistence Scope**: The application persists logs to client-side `localStorage` with a generated ID (`LOG-XXXXX`). It does not rely on or claim an external database or Proof platform backend.

---

## 🛠️ Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment (Optional for Live OpenAI)
Copy `.env.example` to `.env.local` to enable live OpenAI follow-up questions:
```bash
cp .env.example .env.local
```
Add your key inside `.env.local`:
```env
OPENAI_API_KEY=sk-...
```

*(If omitted or running offline, SpeakLog seamlessly uses its smart, natural contextual fallback questions and heuristics).*

### 3. Start Development Server
```bash
npm run dev
```
Open **[http://localhost:5173](http://localhost:5173)** in Google Chrome (required for the Web Speech API).

### 4. Run Automated Pipeline Verification
Run the regression check anytime to verify all 8 pipeline layers:
```bash
npm run verify
```

### 5. Build for Production
```bash
npm run build
```

---

## 🚀 Deployment to Vercel

SpeakLog is pre-configured with [`vercel.json`](file:///c:/Users/Admin/Downloads/SpeakLog/vercel.json) and serverless API endpoints in [`api/`](file:///c:/Users/Admin/Downloads/SpeakLog/api):

1. Push your code to your GitHub repository:
   ```bash
   git add .
   git commit -m "feat: speaklog assignment flow and serverless architecture"
   git push origin main
   ```
2. Log in to [vercel.com](https://vercel.com) and click **"Add New Project"**.
3. Import your repository (`Esa006/speak-logs`).
4. In **Environment Variables**, add:
   - `OPENAI_API_KEY`: `your_openai_api_key`
5. Click **Deploy**. Vercel will provide an **HTTPS** URL (required for the Chrome Web Speech API).

---

## 📜 Detailed Proof Document
See [`PROOF.md`](file:///c:/Users/Admin/Downloads/SpeakLog/PROOF.md) for full step-by-step evidence, verified test runs, and engineering methodology.

---

## 📜 License
MIT
