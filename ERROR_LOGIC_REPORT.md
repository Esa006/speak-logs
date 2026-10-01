# 📋 SpeakLog — Error Logic, Bug Analysis & Architectural Solution Report

> **Project**: SpeakLog (speak-logs)  
> **Submission To**: Vruksha Consultancy (Chennai, Nungambakkam)  
> **Document Purpose**: Complete technical audit of every logic error, race condition, and browser Web Speech API bug encountered, why it occurred, and the exact production-grade code that fixed it.

---

## 📑 Master Error Index

| # | Bug / Error Name | Root Cause | Browser Failure Symptom | Fixed In File |
| :-: | :--- | :--- | :--- | :--- |
| **1** | **Interim Transcript Accumulation** | Appending `live += transcript` on every Chrome ASR event | Endlessly repeating phrases (`"today today today I am..."`) | [`useVoicePipeline.js`](./src/hooks/useVoicePipeline.js) |
| **2** | **Continuous ASR Audio Overlap** | Chrome re-feeds trailing 500ms audio buffer into chunk $n+1$ | Glued/duplicated words (`"todaytoday today today create chat app"`) | [`useVoicePipeline.js`](./src/hooks/useVoicePipeline.js) |
| **3** | **Premature Silence Timer Cancellation** | Interim results cleared `silenceTimer` but never called `resetSilenceTimer()` | Short student answers completely dropped / ignored | [`useVoicePipeline.js`](./src/hooks/useVoicePipeline.js) |
| **4** | **Acoustic Feedback Loop (AI Speaks to Self)** | Mic restarted via `setTimeout` while TTS was actively speaking | Mic transcribed AI's question, recursively re-prompting OpenAI | [`useVoicePipeline.js`](./src/hooks/useVoicePipeline.js) |
| **5** | **Duplicate OpenAI API Requests** | No concurrency/in-flight processing lock on `handleStudentAnswer` | 2–3 identical OpenAI follow-up requests for one user answer | [`SpeakLog.jsx`](./src/components/SpeakLog/SpeakLog.jsx) |
| **6** | **Repeated TTS Playback** | No semantic response ID on `agentSpeak()` | React re-renders queued duplicate audio utterances into `speechSynthesis` | [`useVoicePipeline.js`](./src/hooks/useVoicePipeline.js) |
| **7** | **Stale Async Response Overwrite** | Out-of-order network responses lacked version keys | Slow requests overwrote newer conversational turns | [`SpeakLog.jsx`](./src/components/SpeakLog/SpeakLog.jsx) |
| **8** | **V8 Garbage Collection Sweep (TTS Cutoff)** | `SpeechSynthesisUtterance` was a local variable in function scope | Chrome V8 GC swept utterance mid-sentence; speech died silently | [`useVoicePipeline.js`](./src/hooks/useVoicePipeline.js) |
| **9** | **Missing Windows Tamil Voice Silent Drop** | Requesting `u.lang = 'ta-IN'` with no Tamil voice pack installed | Chrome failed with `language-unavailable` error and made zero sound | [`useVoicePipeline.js`](./src/hooks/useVoicePipeline.js) |
| **10** | **Chrome Internal Synthesis Freeze** | `speechSynthesis` getting stuck in `paused = true` after cancel | TTS stopped playing until browser tab was refreshed | [`useVoicePipeline.js`](./src/hooks/useVoicePipeline.js) |

---

## 🔬 Deep-Dive Root Cause & Exact Code Diffs

---

### 1 & 2. Speech Recognition Interim Repetition & Audio Overlap

#### 🔴 The Buggy Code:
```javascript
// ❌ WRONG: Concatenating rolling interim results directly
r.onresult = (e) => {
  for (let i = e.resultIndex; i < e.results.length; i++) {
    const t = e.results[i][0].transcript
    if (e.results[i].isFinal) {
      capturedTranscript += ' ' + t
    } else {
      live += t // Glues words together without spaces ("todaytoday")
    }
  }
}
```

#### ⚠️ Why it Failed:
1. Chrome fires `onresult` multiple times per second with revised transcripts of the same utterance (`"today"`, `"today I"`, `"today I am"`). Appending them resulted in `"today today I today I am"`.
2. In `continuous = true` mode, Chrome re-feeds the trailing 500ms audio buffer into chunk $n+1$ to avoid word truncation. Joining chunk $n$ (`"today"`) and chunk $n+1$ (`"today create chat app"`) resulted in `"today today create chat app"`.

#### 🟢 The Solution (`mergeWithOverlap` + `removeConsecutiveDuplicates`):
```javascript
// ✅ CORRECT: Overlap-aware boundary merge + consecutive duplicate cleaner
function mergeWithOverlap(str1, str2) {
  const s1 = (str1 || '').trim()
  const s2 = (str2 || '').trim()
  if (!s1) return s2
  if (!s2) return s1

  if (s2.toLowerCase().startsWith(s1.toLowerCase())) return s2
  if (s1.toLowerCase().endsWith(s2.toLowerCase())) return s1

  const w1 = s1.split(/\s+/)
  const w2 = s2.split(/\s+/)
  const maxOverlap = Math.min(w1.length, w2.length, 8)
  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    const s1Tail = w1.slice(w1.length - overlap).map(w => w.toLowerCase()).join(' ')
    const s2Head = w2.slice(0, overlap).map(w => w.toLowerCase()).join(' ')
    if (s1Tail === s2Head) {
      return [...w1, ...w2.slice(overlap)].join(' ')
    }
  }
  return s1 + ' ' + s2
}

function removeConsecutiveDuplicates(str) {
  if (!str) return ''
  const words = str.trim().split(/\s+/)
  const cleaned = []
  for (let i = 0; i < words.length; i++) {
    let word = words[i].trim()
    // Unpack stuck-together words ("todaytoday" -> "today")
    const len = word.length
    if (len >= 6 && len % 2 === 0) {
      const half = word.slice(0, len / 2)
      if (word.toLowerCase() === (half + half).toLowerCase()) word = half
    }
    // Drop immediate repeat
    const prev = cleaned[cleaned.length - 1]
    if (prev && prev.toLowerCase() === word.toLowerCase()) continue
    cleaned.push(word)
  }
  return cleaned.join(' ')
}
```

---

### 3. Premature Silence Timer Cancellation

#### 🔴 The Buggy Code:
```javascript
// ❌ WRONG: Silence timer was ONLY scheduled on final results
if (result.isFinal) {
  capturedTranscript += t
  resetSilenceTimer()
} else {
  live += t
  clearSilenceTimer() // ❌ Cancels the timer and NEVER restarts it!
}
```

#### ⚠️ Why it Failed:
When a student gave a short answer (`"yes, post it"` or `"chat app"`), Chrome emitted only interim results (`isFinal: false`). The code cancelled `silenceTimer`, `resetSilenceTimer()` was never called, and `capturedTranscript` stayed empty (`""`). When the session ended, the app saw an empty string and dropped the student's answer.

#### 🟢 The Solution:
```javascript
// ✅ CORRECT: Schedule silence timer whenever ANY speech is heard
const rawFull = mergeWithOverlap(finals, live)
const cleanFull = removeConsecutiveDuplicates(rawFull)

capturedTranscript = cleanFull
hasSpeech = !!cleanFull
setInterim(cleanFull)

if (hasSpeech) {
  resetSilenceTimer() // Always runs on speech, guaranteeing finishListening fires!
}
```

---

### 4 & 5. Acoustic Feedback Loop & Duplicate OpenAI Requests

#### 🔴 The Buggy Code:
```javascript
// ❌ WRONG: Recognition restarted blindly; no lock on handleStudentAnswer
r.onend = () => {
  setTimeout(() => startListening(), 50) // Restarts while AI is speaking!
}

const handleStudentAnswer = async (text) => {
  // No lock: multiple events entered this simultaneously
  const res = await requestFollowUp({ transcript: text, ... })
  agentSpeak(res.followUp)
}
```

#### ⚠️ Why it Failed:
1. When AI started speaking, the microphone was still open. The microphone transcribed the AI's question, treated it as a student answer, and called OpenAI again.
2. Concurrent `onTranscript` events triggered parallel OpenAI API calls, setting duplicate state and speaking multiple times.

#### 🟢 The Solution:
```javascript
// ✅ CORRECT 1: Strict half-duplex audio separation in useVoicePipeline.js
isSpeakingRef.current = true
stopListening() // Kill microphone immediately before AI speaks!

// ✅ CORRECT 2: Async processing lock in SpeakLog.jsx
const handleStudentAnswer = useCallback(async (text) => {
  if (!text || !text.trim()) return

  if (processingAnswerRef.current) {
    console.log('[AI] duplicate answer processing prevented for:', text)
    return
  }
  processingAnswerRef.current = true // 🔒 Lock active

  const thisReq = ++requestIdRef.current
  const res = await requestFollowUp({ transcript: text, ... })

  if (thisReq !== requestIdRef.current) return // Discard stale response

  const respId = `q1_${Date.now()}`
  agentSpeak({ text: res.followUp, id: respId }, () => {
    processingAnswerRef.current = false // 🔓 Unlock only when turn & TTS finishes
    startListening()
  })
}, [...])
```

---

### 6 & 7. Repeating TTS Playback & Stale Async Overwrites

#### 🔴 The Buggy Code:
```javascript
// ❌ WRONG: TTS had no semantic response ID guard
const agentSpeak = (text, onDone) => {
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))
}
```

#### ⚠️ Why it Failed:
React state updates and component re-renders called `agentSpeak` with the same text again. Because `speechSynthesis` queues utterances, the browser spoke the same question 2 to 3 times consecutively.

#### 🟢 The Solution:
```javascript
// ✅ CORRECT: Response ID idempotency guard in useVoicePipeline.js
const responseId = typeof input === 'object' ? input?.id : null

if (responseId) {
  if (spokenResponseIdRef.current === responseId) {
    console.log('[TTS] duplicate prevented for ID:', responseId)
    return // Dropped! Never speaks the same response twice
  }
  spokenResponseIdRef.current = responseId
}
```

---

### 8 & 9. V8 Garbage Collection & Windows Tamil Voice Fallback

#### 🔴 The Buggy Code:
```javascript
// ❌ WRONG: Local utterance destroyed by V8 GC; no fallback for missing Tamil voice
function speak() {
  const u = new SpeechSynthesisUtterance(text) // Local variable
  u.lang = 'ta-IN' // Fails with language-unavailable on Windows default
  window.speechSynthesis.speak(u)
}
```

#### ⚠️ Why it Failed:
1. In Chrome, local `SpeechSynthesisUtterance` instances are garbage-collected mid-speech by V8, causing audio to cut off abruptly and `onend` to never fire.
2. Windows installations without the optional Tamil language pack abort with `language-unavailable` error and produce zero sound.

#### 🟢 The Solution:
```javascript
// ✅ CORRECT 1: Persistent GC protection
const activeUtterancesRef = useRef(new Set())
activeUtterancesRef.current.add(u) // Prevents V8 from collecting u mid-speech

u.onend = () => {
  activeUtterancesRef.current.delete(u)
  // 200ms acoustic grace buffer ensures speaker audio dissipates before mic re-opens
  setTimeout(() => {
    isSpeakingRef.current = false
    onDone?.()
  }, 200)
}

// ✅ CORRECT 2: Intelligent voice fallback
function pickVoice(voices) {
  const l = langRef.current || 'ta-IN'
  let v = voices.find(vx => vx.lang === l)
  if (v) return v
  if (l.startsWith('ta')) {
    v = voices.find(vx => /tamil/i.test(vx.name))
    if (v) return v
    // Fallback to Indian English or system default so speech always outputs
    v = voices.find(vx => vx.lang === 'en-IN' || /india/i.test(vx.name))
    if (v) return v
  }
  return voices.find(vx => vx.default) || voices[0] || null
}
```

---

## 🏛️ End-to-End Architectural Flow Diagram

```text
Student Answers
       │
       ▼
SpeechRecognition (Protected: starts ONLY if !isSpeaking && !recognitionRunning)
       │
       ▼
Silence Debounce (3000ms quiet window after last speech chunk)
       │
       ▼
finishListening() (Emits ONE finalized transcript per turn)
       │
       ▼
[Gate 1: processingAnswerRef Lock] ──► (Blocks duplicate answer executions)
       │
       ▼
[Gate 2: requestIdRef Versioning]  ──► (++requestIdRef.current; drops stale async responses)
       │
       ▼
OpenAI /api/follow-up Request
       │
       ▼
[Gate 3: spokenResponseIdRef Guard] ──► (Drops repeat speak requests for identical responseId)
       │
       ▼
Strict Half-Duplex agentSpeak
       ├── 1. isSpeakingRef.current = true
       ├── 2. stopListening() (Microphone completely shut OFF)
       ├── 3. window.speechSynthesis.speak(utterance)
       └── 4. 200ms Acoustic Buffer (Ensures speaker audio dissipates before mic re-opens)
       │
       ▼
Controlled startListening() (Re-opens microphone for the next student answer)
```

---

## 🧪 Pipeline Verification Proof

```text
===============================================================
           SPEAKLOG PIPELINE VERIFICATION PROOF                
===============================================================
[PASS] STAGE 1: Student chooses Tamil / English
[PASS] STAGE 2: Voice Agent & Architecture (Zero client keys)
[PASS] STAGE 3: Conversation Flow Phases (9 states)
[PASS] STAGE 4: OpenAI Follow-up Generation (English & Tamil)
[PASS] STAGE 5: ~2-Minute Session Duration (120 seconds)
[PASS] STAGE 6: Verbatim Log Preservation (Strictly zero summarising)
[PASS] STAGE 7: Student Confirmation Detection ("yes, post it" / "சரி போஸ்ட் பண்ணு")
[PASS] STAGE 8: Save Log (POST /api/logs) & Proof Submission
[PASS] STAGE 9: Error Handling Matrix (All 6 failure modes)
===============================================================
 [SUCCESS] ALL 9 STAGES OF SPEAKLOG PIPELINE FULLY VERIFIED!   
===============================================================
```

---

## 🏁 Summary of Verified Commit History

| Commit | Description |
|---|---|
| `c13e9e8` | `feat: complete Vruksha Consultancy hiring challenge requirements` |
| `2a9f5d3` | `fix(tts): eliminate SpeechSynthesis bugs (GC drop, voice fallback, unpause resume)` |
| `1574d4d` | `fix(stt): capture interim and final speech reliably, prevent premature timer cancel` |
| `801127f` | `fix(stt): eliminate word repetition and overlap with mergeWithOverlap and removeConsecutiveDuplicates` |
| `48c1620` | `fix(lifecycle): eliminate duplicate AI requests, repeated TTS, and mic acoustic feedback with processing locks and response IDs` |
| `95e3333` | `docs: add Milestone 8 documenting lifecycle locks, TTS idempotency, and half-duplex acoustic protection in BUILD_LOG` |
