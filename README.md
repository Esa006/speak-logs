# SpeakLog — speak your log

**A voice agent that turns two minutes of talking into a student's own log.**

> Built for Vruksha Consultancy (Chennai) hiring challenge.

---

## Try it

**Live:** https://speak-logs.vercel.app
**Repo:** https://github.com/Esa006/speak-logs
**My Proof build log:** https://proof.zeromaintenanceengineer.in/next/log/80be0193-3eb9-4748-99a6-480693394c49

---

## How to test (3 lines)

1. Open **https://speak-logs.vercel.app** in Google Chrome and allow the mic when prompted.
2. Pick Tamil or English, press **Start**, and speak when the agent asks its questions.
3. After the third follow-up, say **"yes, post it"** (or **"sari post pannu"**) to save your log.

---

## What it does

| Step | Brief says | SpeakLog does |
|------|-----------|---------------|
| Ask | Tamil or English: what did you try, what broke, why? | 3 questions + 1 follow-up each, bilingual |
| Follow up | One question built from what they just said | Embeds their exact words: "When working on X, what tool did you use?" |
| Keep words | Word for word. No summary | verbatim:true — raw speech stored unchanged |
| Post on yes | Read it back. Post only when they say so | isConfirmation() matches voice + button; Proof JSON-RPC 2.0 |

---

## Architecture

Chrome Web Speech API
  -> useVoicePipeline.js  (silence debounce, dedup, mutex lock)
       -> SpeakLog.jsx     (9-phase FSM: INTRO to DONE)
            |-> /api/follow-up -> OpenAI gpt-4o-mini -> 1 follow-up per answer
            +-> /api/logs     -> Proof JSON-RPC 2.0 tools/call post_log

---

## What broke during the build (and how we fixed it)

- **Interim duplication bug** — Chrome ASR repeats trailing 500 ms audio buffer across segments.
  Fixed with sliding-window overlap algorithm (mergeWithOverlap, up to 8-word seam detection).

- **Recursive acoustic feedback** — TTS audio was re-transcribed back into the pipeline.
  Fixed with isSpeakingRef mutex lock that gates onresult events while agent speaks.

- **Abrupt cutoffs** — Fixed 10s timeout interrupted students mid-thought.
  Replaced with 3s silence-debounce VAD that waits for genuine pause.

Full details in BUILD_LOG.md.

---

## Environment variables (Vercel)

- OPENAI_API_KEY : GPT-4o-mini follow-up questions (snippet-based fallback if absent)
- PROOF_TOKEN    : Bearer token for posting to Proof (add in Vercel dashboard)

Never commit either to git — both are in .env.local (gitignored).

---

## Run locally

git clone https://github.com/Esa006/speak-logs.git
cd speak-logs
npm install
cp .env.example .env.local
npm run dev
# open http://localhost:5173 in Chrome
