import { useState, useEffect, useRef, useCallback } from 'react'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap-icons/font/bootstrap-icons.css'
import './SpeakLog.css'
import { requestFollowUp, getStoredApiKey, setStoredApiKey } from '../../utils/aiFollowUp'
import { saveLog } from '../../utils/logService'
import { isConfirmation, isCancellation } from '../../utils/conversationFlow'

/* ─────────────────────────────────────────────
   Constants & Step Flow
───────────────────────────────────────────── */
const TOTAL_SECONDS = 120 // 2-minute assignment duration

// Flow Steps:
// 0: Q1 (What tried) -> 1: Q1 Follow-up
// 2: Q2 (What broke) -> 3: Q2 Follow-up
// 4: Q3 (Why)        -> 5: Q3 Follow-up
// 6: Confirmation    -> 7: Done/Saved
const STEPS = {
  Q1: 0,
  Q1_FOLLOWUP: 1,
  Q2: 2,
  Q2_FOLLOWUP: 3,
  Q3: 4,
  Q3_FOLLOWUP: 5,
  CONFIRM: 6,
  DONE: 7,
}

const MAIN_QUESTIONS = {
  'ta-IN': [
    { q: 'நீங்கள் இன்று என்ன try பண்ணினீர்கள்?', en: 'What did you try today?' },
    { q: 'என்ன சரியாக வரவில்லை அல்லது என்ன பிரச்சனை வந்தது?', en: "What broke or didn't work as expected?" },
    { q: 'ஏன் அப்படி நடந்தது என்று நினைக்கிறீர்கள்?', en: 'Why do you think that happened?' },
  ],
  'en-IN': [
    { q: 'What did you try today?', en: '' },
    { q: "What broke or didn't work the way you expected?", en: '' },
    { q: 'Why do you think that happened?', en: '' },
  ],
}

const GREETINGS = {
  'ta-IN': { main: 'வணக்கம்! உங்கள் நாளைப் பற்றி பேசலாம்', en: "👋 Let's talk about your day" },
  'en-IN': { main: "👋 Let's talk about your day", en: '' },
}

function fmtTime(s) {
  const m = String(Math.floor(s / 60)).padStart(2, '0')
  const sec = String(s % 60).padStart(2, '0')
  return `${m}:${sec}`
}

export default function SpeakLog() {
  const [lang, setLang]                   = useState('ta-IN')
  const [step, setStep]                   = useState(STEPS.Q1)
  const [phase, setPhase]                 = useState('idle') // idle | speaking | listening | generating | confirming | saving | done
  const [timeLeft, setTimeLeft]           = useState(TOTAL_SECONDS)
  const [timerOn, setTimerOn]             = useState(false)
  const [lines, setLines]                 = useState([])
  const [interim, setInterim]             = useState('')
  const [srError, setSrError]             = useState('')
  const [agentText, setAgentText]         = useState('')

  // Student's verbatim answers
  const [log, setLog]                     = useState({
    tried: '',
    triedFollowUp: '',
    broke: '',
    brokeFollowUp: '',
    why: '',
    whyFollowUp: '',
  })

  // Dynamic AI Follow-up states
  const [followUpQ1, setFollowUpQ1]       = useState('')
  const [followUpQ2, setFollowUpQ2]       = useState('')
  const [followUpQ3, setFollowUpQ3]       = useState('')
  const [followUpSource, setFollowUpSource] = useState('')

  // Log save status
  const [savedResult, setSavedResult]     = useState(null)
  const [saveError, setSaveError]         = useState('')

  // OpenAI Key settings modal
  const [apiKey, setApiKey]               = useState(() => getStoredApiKey())
  const [showKeyModal, setShowKeyModal]   = useState(false)
  const [tempKey, setTempKey]             = useState('')

  const recognitionRef = useRef(null)
  const synthRef       = useRef(null)
  const timerRef       = useRef(null)
  const stepRef        = useRef(step)
  const logRef         = useRef(log)
  const phaseRef       = useRef(phase)
  const answerRef      = useRef(null)
  const saveLogRef     = useRef(null)

  useEffect(() => {
    stepRef.current  = step
    logRef.current   = log
    phaseRef.current = phase
  }, [step, log, phase])

  const isSupported = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window
  const questions   = MAIN_QUESTIONS[lang]
  const greeting    = GREETINGS[lang]
  const isDone      = step === STEPS.DONE || timeLeft === 0

  /* ── 2-minute Countdown timer ── */
  useEffect(() => {
    if (timerOn && !isDone) {
      timerRef.current = setInterval(() => {
        setTimeLeft(t => {
          if (t <= 1) {
            clearInterval(timerRef.current)
            setStep(STEPS.DONE)
            setPhase('done')
            return 0
          }
          return t - 1
        })
      }, 1000)
    }
    return () => clearInterval(timerRef.current)
  }, [timerOn, isDone])

  /* ── Switch language ── */
  useEffect(() => {
    if (recognitionRef.current) {
      recognitionRef.current.lang = lang
    }
  }, [lang])

  /* ── Helper: Agent speaks text with browser speechSynthesis ── */
  const agentSpeak = useCallback((text, onDone) => {
    if (!('speechSynthesis' in window)) {
      if (onDone) onDone()
      return
    }

    window.speechSynthesis.cancel()
    setAgentText(text)
    setPhase('speaking')

    const u = new SpeechSynthesisUtterance(text)
    u.lang  = lang
    u.rate  = 0.95

    // Choose the best available voice for language
    const voices = window.speechSynthesis.getVoices()
    const match = voices.find(v => v.lang === lang || v.lang.startsWith(lang.split('-')[0]))
    if (match) u.voice = match

    u.onend = () => {
      setAgentText('')
      if (onDone) onDone()
    }
    u.onerror = (err) => {
      console.warn('speechSynthesis error:', err)
      setAgentText('')
      if (onDone) onDone()
    }

    synthRef.current = u
    window.speechSynthesis.speak(u)
  }, [lang])

  /* ── Helper: Start speech recognition ── */
  const startListening = useCallback(() => {
    if (!isSupported) {
      setSrError('Use Google Chrome for Web Speech API.')
      return
    }
    setSrError('')
    window.speechSynthesis?.cancel()
    setAgentText('')

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    const r  = new SR()
    r.lang           = lang
    r.interimResults = true
    r.continuous     = false

    let capturedTranscript = ''

    r.onstart = () => {
      setPhase('listening')
      setInterim('')
    }

    r.onresult = (e) => {
      let live = '', final = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) {
          final += t
        } else {
          live += t
        }
      }
      setInterim(live)
      if (final) {
        capturedTranscript = final.trim()
      }
    }

    r.onerror = (e) => {
      if (e.error !== 'no-speech') {
        setSrError(`Microphone notice: ${e.error}`)
      }
      setPhase('idle')
    }

    r.onend = () => {
      setInterim('')
      const text = capturedTranscript.trim()
      if (text) {
        answerRef.current?.(text)
      } else {
        // If silence or empty, keep phase idle
        if (phaseRef.current === 'listening') {
          setPhase('idle')
        }
      }
    }

    recognitionRef.current = r
    try {
      r.start()
    } catch (err) {
      console.warn('SpeechRecognition start error:', err)
    }
  }, [lang, isSupported])

  const stopListening = useCallback(() => {
    try {
      recognitionRef.current?.stop()
    } catch {}
  }, [])

  /* ── Core State Machine: Process Student Answer ── */
  const handleStudentAnswer = useCallback(async (text) => {
    const currentStep = stepRef.current

    // Add to visual transcript history
    setLines(prev => [...prev, { text, ts: Date.now() }])

    // 1. Answered Q1 (What did you try?)
    if (currentStep === STEPS.Q1) {
      setLog(l => ({ ...l, tried: text }))
      setPhase('generating')

      const mainQ = questions[0].q
      const res = await requestFollowUp({
        transcript: text,
        question: mainQ,
        language: lang,
        phase: 'WHAT_TRIED',
      })

      const followUpText = res.followUp
      setFollowUpQ1(followUpText)
      setFollowUpSource(res.source)
      setStep(STEPS.Q1_FOLLOWUP)

      agentSpeak(followUpText, () => {
        startListening()
      })
      return
    }

    // 2. Answered Q1 Follow-Up -> Move to Q2
    if (currentStep === STEPS.Q1_FOLLOWUP) {
      setLog(l => ({ ...l, triedFollowUp: text }))
      setStep(STEPS.Q2)

      const q2 = questions[1].q
      agentSpeak(q2, () => {
        startListening()
      })
      return
    }

    // 3. Answered Q2 (What broke?)
    if (currentStep === STEPS.Q2) {
      setLog(l => ({ ...l, broke: text }))
      setPhase('generating')

      const mainQ = questions[1].q
      const res = await requestFollowUp({
        transcript: text,
        question: mainQ,
        language: lang,
        phase: 'WHAT_BROKE',
      })

      const followUpText = res.followUp
      setFollowUpQ2(followUpText)
      setFollowUpSource(res.source)
      setStep(STEPS.Q2_FOLLOWUP)

      agentSpeak(followUpText, () => {
        startListening()
      })
      return
    }

    // 4. Answered Q2 Follow-Up -> Move to Q3
    if (currentStep === STEPS.Q2_FOLLOWUP) {
      setLog(l => ({ ...l, brokeFollowUp: text }))
      setStep(STEPS.Q3)

      const q3 = questions[2].q
      agentSpeak(q3, () => {
        startListening()
      })
      return
    }

    // 5. Answered Q3 (Why do you think that happened?)
    if (currentStep === STEPS.Q3) {
      setLog(l => ({ ...l, why: text }))
      setPhase('generating')

      const mainQ = questions[2].q
      const res = await requestFollowUp({
        transcript: text,
        question: mainQ,
        language: lang,
        phase: 'WHY',
      })

      const followUpText = res.followUp
      setFollowUpQ3(followUpText)
      setFollowUpSource(res.source)
      setStep(STEPS.Q3_FOLLOWUP)

      agentSpeak(followUpText, () => {
        startListening()
      })
      return
    }

    // 6. Answered Q3 Follow-Up -> Move to Confirmation Phase
    if (currentStep === STEPS.Q3_FOLLOWUP) {
      setLog(l => ({ ...l, whyFollowUp: text }))
      setStep(STEPS.CONFIRM)
      setPhase('confirming')

      const confirmPrompt = lang === 'ta-IN'
        ? `உங்கள் log உங்கள் சொந்த வார்த்தைகளில் தயாராக உள்ளது. இதை save செய்யவா? உறுதிப்படுத்த 'yes, save it' என்று சொல்லவும்.`
        : `Here is your log in your own words. Should I save this log? Say 'yes, save it' to confirm.`

      agentSpeak(confirmPrompt, () => {
        startListening()
      })
      return
    }

    // 7. In Confirmation Phase -> Check for Voice Confirmation
    if (currentStep === STEPS.CONFIRM) {
      if (isConfirmation(text)) {
        saveLogRef.current?.()
      } else if (isCancellation(text)) {
        const cancelMsg = lang === 'ta-IN'
          ? 'சரி, log ரத்து செய்யப்பட்டது. நீங்கள் எப்போது வேண்டுமானாலும் மீண்டும் தொடங்கலாம்.'
          : 'Understood. Log cancelled. You can start a new log anytime.'
        agentSpeak(cancelMsg, () => {
          setPhase('idle')
        })
      } else {
        const retryPrompt = lang === 'ta-IN'
          ? `புரியவில்லை. இதை save செய்ய 'yes, save it' என்று சொல்லவும் அல்லது Save Log கிளிக் செய்யவும்.`
          : `I didn't quite catch that. Say "yes, save it" to confirm, or click Save Log.`
        agentSpeak(retryPrompt, () => {
          startListening()
        })
      }
    }
  }, [questions, lang, agentSpeak, startListening])

  /* ── Save Log Locally ── */
  const triggerSaveLog = useCallback(async () => {
    setPhase('saving')
    setSaveError('')

    const speechSaving = lang === 'ta-IN'
      ? 'அருமை! உங்கள் log-ஐ save செய்கிறேன்…'
      : 'Saving your log now…'
    agentSpeak(speechSaving)

    try {
      const currentLog = logRef.current
      const result = await saveLog({
        tried: currentLog.tried,
        broke: currentLog.broke,
        why: currentLog.why,
        language: lang,
      })

      setSavedResult(result)
      setStep(STEPS.DONE)
      setPhase('done')

      const successMsg = lang === 'ta-IN'
        ? 'உங்கள் log வெற்றிகரமாக save செய்யப்பட்டது!'
        : 'Awesome! Your log has been saved.'
      agentSpeak(successMsg)
    } catch (err) {
      console.error('Save error:', err)
      setSaveError(err.message || 'Failed to save log')
      setPhase('confirming')
    }
  }, [lang, agentSpeak])

  useEffect(() => {
    answerRef.current = handleStudentAnswer
  }, [handleStudentAnswer])

  useEffect(() => {
    saveLogRef.current = triggerSaveLog
  }, [triggerSaveLog])

  /* ── Mic Tap Handler ── */
  function handleMicTap() {
    if (isDone) return

    // If currently listening, manual stop triggers recognition.onend
    if (phase === 'listening') {
      stopListening()
      return
    }

    // If agent is speaking, cancel and start listening
    if (phase === 'speaking') {
      window.speechSynthesis?.cancel()
      setAgentText('')
    }

    // If first tap, start session
    if (!timerOn) {
      setTimerOn(true)
      const firstQ = questions[0].q
      const greetingPrefix = lang === 'ta-IN' ? 'வணக்கம்! ' : ''
      agentSpeak(`${greetingPrefix}${firstQ}`, () => {
        startListening()
      })
      return
    }

    // Subsequent tap: listen for current active step
    startListening()
  }

  /* ── Reset / Start New Session ── */
  function handleReset() {
    window.speechSynthesis?.cancel()
    try { recognitionRef.current?.stop() } catch {}
    clearInterval(timerRef.current)

    setPhase('idle')
    setStep(STEPS.Q1)
    setTimeLeft(TOTAL_SECONDS)
    setTimerOn(false)
    setLines([])
    setInterim('')
    setSrError('')
    setAgentText('')
    setFollowUpQ1('')
    setFollowUpQ2('')
    setFollowUpQ3('')
    setFollowUpSource('')
    setSavedResult(null)
    setSaveError('')
    setLog({
      tried: '',
      triedFollowUp: '',
      broke: '',
      brokeFollowUp: '',
      why: '',
      whyFollowUp: '',
    })
  }

  /* ── Save Custom API Key ── */
  function handleSaveKey() {
    setStoredApiKey(tempKey)
    setApiKey(tempKey.trim())
    setShowKeyModal(false)
  }

  /* ── Determine Current Displayed Question Text ── */
  let currentTitle = ''
  let currentEnSubtitle = ''
  let stepBadgeText = ''
  let isFollowUpStep = false

  switch (step) {
    case STEPS.Q1:
      stepBadgeText = 'Question 1 of 3'
      currentTitle = questions[0].q
      currentEnSubtitle = questions[0].en
      break
    case STEPS.Q1_FOLLOWUP:
      stepBadgeText = 'Follow-up 1 of 3'
      isFollowUpStep = true
      currentTitle = followUpQ1 || '...'
      break
    case STEPS.Q2:
      stepBadgeText = 'Question 2 of 3'
      currentTitle = questions[1].q
      currentEnSubtitle = questions[1].en
      break
    case STEPS.Q2_FOLLOWUP:
      stepBadgeText = 'Follow-up 2 of 3'
      isFollowUpStep = true
      currentTitle = followUpQ2 || '...'
      break
    case STEPS.Q3:
      stepBadgeText = 'Question 3 of 3'
      currentTitle = questions[2].q
      currentEnSubtitle = questions[2].en
      break
    case STEPS.Q3_FOLLOWUP:
      stepBadgeText = 'Follow-up 3 of 3'
      isFollowUpStep = true
      currentTitle = followUpQ3 || '...'
      break
    case STEPS.CONFIRM:
      stepBadgeText = 'Review & Confirmation'
      currentTitle = lang === 'ta-IN' ? 'உங்கள் Log-ஐ சரிபார்க்கவும்' : 'Review your log'
      currentEnSubtitle = lang === 'ta-IN' ? 'Check your verbatim responses below' : ''
      break
    case STEPS.DONE:
      stepBadgeText = 'Complete'
      currentTitle = lang === 'ta-IN' ? 'நன்றி! பதிவு முடிந்தது' : 'Session Complete'
      break
    default:
      break
  }

  const timerDanger  = timeLeft <= 20
  const timerWarning = timeLeft <= 40 && !timerDanger

  return (
    <div className="sl-bg">
      <div className="sl-card">

        {/* ══════════ TOP BAR ══════════ */}
        <div className="sl-topbar">
          <div className="sl-brand">
            <div className="sl-logo"><i className="bi bi-mic-fill" /></div>
            <span className="sl-brand-name">SpeakLog</span>
          </div>

          <div className="sl-top-actions">
            {/* OpenAI API Key settings */}
            <button
              className="sl-icon-btn"
              title="OpenAI API Settings"
              onClick={() => { setTempKey(apiKey); setShowKeyModal(true) }}
              aria-label="OpenAI Settings"
            >
              <i className="bi bi-sliders" />
              {apiKey && <span className="sl-key-dot" title="OpenAI API Key configured" />}
            </button>

            {/* Countdown timer */}
            <div className={`sl-timer ${timerDanger ? 'danger' : timerWarning ? 'warning' : ''}`}>
              <i className="bi bi-clock me-1" />
              {fmtTime(timeLeft)}
            </div>
          </div>
        </div>

        {/* ══════════ GREETING ══════════ */}
        <div className="sl-greeting">
          <p className="sl-greeting-main">{greeting.main}</p>
          {greeting.en && <p className="sl-greeting-en">{greeting.en}</p>}
        </div>

        {/* ══════════ QUESTION & PROMPT BOX ══════════ */}
        <div className="sl-question-box">
          <div className="d-flex align-items-center justify-content-between mb-1">
            <div className="sl-q-num">{stepBadgeText}</div>
            {isFollowUpStep && (
              <span className="sl-ai-badge">
                <i className="bi bi-stars" />
                {followUpSource === 'openai' ? 'OpenAI GPT-4o-mini' : 'AI Follow-up'}
              </span>
            )}
          </div>

          {phase === 'generating' ? (
            <div className="sl-generating-indicator">
              <i className="bi bi-arrow-repeat sl-spin" />
              <span>
                {lang === 'ta-IN'
                  ? 'OpenAI Follow-up கேள்வி தயாரிக்கிறது…'
                  : 'Generating follow-up question via OpenAI…'}
              </span>
            </div>
          ) : (
            <>
              <p className="sl-q-main">{currentTitle}</p>
              {currentEnSubtitle && <p className="sl-q-en">{currentEnSubtitle}</p>}
            </>
          )}

          {/* Agent speaking animated dots */}
          {agentText && (
            <div className="sl-agent-speaking">
              <span className="sl-agent-dot" />
              <span className="sl-agent-dot" />
              <span className="sl-agent-dot" />
            </div>
          )}

          {/* Verbatim Log Card during Confirmation Step */}
          {step === STEPS.CONFIRM && (
            <div className="sl-verbatim-container">
              <div className="sl-verbatim-card">
                <div className="sl-verbatim-tag">
                  <i className="bi bi-lightning-charge text-warning" /> What I tried (Verbatim)
                </div>
                <div className={`sl-verbatim-text ${!log.tried ? 'empty' : ''}`}>
                  {log.tried || 'No answer recorded'}
                </div>
              </div>

              <div className="sl-verbatim-card">
                <div className="sl-verbatim-tag">
                  <i className="bi bi-exclamation-triangle text-danger" /> What broke (Verbatim)
                </div>
                <div className={`sl-verbatim-text ${!log.broke ? 'empty' : ''}`}>
                  {log.broke || 'No answer recorded'}
                </div>
              </div>

              <div className="sl-verbatim-card">
                <div className="sl-verbatim-tag">
                  <i className="bi bi-lightbulb text-info" /> Why (Verbatim)
                </div>
                <div className={`sl-verbatim-text ${!log.why ? 'empty' : ''}`}>
                  {log.why || 'No answer recorded'}
                </div>
              </div>

              <div className="sl-confirm-buttons">
                <button
                  id="btn-save-log"
                  className="sl-post-btn"
                  onClick={triggerSaveLog}
                  disabled={phase === 'saving'}
                >
                  <i className="bi bi-check2-circle" />
                  {phase === 'saving' ? 'Saving log…' : 'Save Log'}
                </button>
                <button
                  className="sl-cancel-btn"
                  onClick={handleReset}
                  disabled={phase === 'saving'}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Log Save Success Card */}
          {savedResult && (
            <div className="sl-save-card">
              <div className="sl-save-title">
                <i className="bi bi-check-circle-fill text-success" />
                Log Saved Successfully!
              </div>
              <div className="sl-save-id">Log ID: {savedResult.id}</div>
            </div>
          )}
        </div>

        {/* ══════════ MIC AREA ══════════ */}
        <div className="sl-mic-zone">
          <button
            id="mic-btn"
            className={`sl-mic ${phase === 'listening' ? 'active' : phase === 'speaking' ? 'agent' : ''}`}
            onClick={handleMicTap}
            disabled={isDone || phase === 'generating' || phase === 'saving'}
            aria-label={phase === 'listening' ? 'Stop speaking' : 'Start speaking'}
          >
            {phase === 'listening'
              ? <i className="bi bi-stop-fill" />
              : phase === 'speaking'
                ? <i className="bi bi-volume-up-fill" />
                : phase === 'generating'
                  ? <i className="bi bi-arrow-repeat sl-spin" />
                  : <i className="bi bi-mic-fill" />}
          </button>

          {phase === 'listening' && (
            <div className="sl-wave" aria-hidden="true">
              {[...Array(9)].map((_, i) => <span key={i} />)}
            </div>
          )}

          <p className="sl-mic-hint">
            {isDone
              ? 'Session complete'
              : phase === 'saving'
                ? 'Saving log…'
                : phase === 'generating'
                  ? 'Generating follow-up question…'
                  : phase === 'listening'
                    ? (step === STEPS.CONFIRM ? 'Listening… say "yes, save it"' : 'Listening… tap to stop')
                    : phase === 'speaking'
                      ? 'Agent speaking…'
                      : step === STEPS.CONFIRM
                        ? 'Say "yes, save it" or tap Save Log'
                        : timerOn
                          ? 'Tap to speak answer'
                          : 'Tap to start speaking'}
          </p>
        </div>

        {/* ══════════ DIVIDER ══════════ */}
        <div className="sl-divider" />

        {/* ══════════ LANGUAGE + TRANSCRIPT ══════════ */}
        <div className="sl-bottom">
          {/* Language toggle */}
          <div className="sl-lang-row">
            <span className="sl-lang-label">Language</span>
            <div className="sl-lang-toggle">
              <button
                id="lang-ta"
                className={`sl-lang-btn ${lang === 'ta-IN' ? 'active' : ''}`}
                onClick={() => { stopListening(); setLang('ta-IN') }}
                disabled={phase === 'listening' || timerOn}
                title="தமிழ் (Tamil)"
              >
                தமிழ்
              </button>
              <button
                id="lang-en"
                className={`sl-lang-btn ${lang === 'en-IN' ? 'active' : ''}`}
                onClick={() => { stopListening(); setLang('en-IN') }}
                disabled={phase === 'listening' || timerOn}
                title="English"
              >
                English
              </button>
            </div>
          </div>

          {/* Speech error */}
          {srError && (
            <div className="sl-error">
              <i className="bi bi-exclamation-circle me-2" />{srError}
            </div>
          )}

          {/* Log save error */}
          {saveError && (
            <div className="sl-error">
              <i className="bi bi-exclamation-triangle me-2" />Save error: {saveError}
            </div>
          )}

          {/* Web Speech API browser check */}
          {!isSupported && (
            <div className="sl-error">
              <i className="bi bi-exclamation-triangle me-2" />
              Web Speech API requires <strong>Google Chrome</strong>.
            </div>
          )}

          {/* Transcript area */}
          <div
            className="sl-transcript"
            id="transcript-area"
            aria-live="polite"
            aria-label="Your spoken response"
          >
            {lines.length === 0 && !interim ? (
              <p className="sl-transcript-placeholder">Your verbatim responses will appear here</p>
            ) : (
              <>
                {lines.map((l, i) => (
                  <p key={l.ts} className="sl-transcript-line">
                    <span className="sl-line-num">{i + 1}</span>
                    {l.text}
                  </p>
                ))}
                {interim && (
                  <p className="sl-transcript-interim">{interim}</p>
                )}
              </>
            )}
          </div>
        </div>

        {/* ══════════ DONE STATE ══════════ */}
        {isDone && (
          <div className="sl-done-bar">
            <span>
              {timeLeft === 0 ? "⏰ Time's up!" : '✅ Log recorded and saved!'}
            </span>
            <button id="btn-reset" className="sl-reset-btn" onClick={handleReset}>
              <i className="bi bi-arrow-counterclockwise me-1" />New log
            </button>
          </div>
        )}

      </div>

      {/* ══════════ OPENAI SETTINGS MODAL ══════════ */}
      {showKeyModal && (
        <div className="sl-modal-overlay" onClick={() => setShowKeyModal(false)}>
          <div className="sl-modal-card" onClick={e => e.stopPropagation()}>
            <div className="sl-modal-title">
              <i className="bi bi-robot text-primary" /> OpenAI API Settings
            </div>
            <p className="sl-modal-sub">
              Enter your <code>OPENAI_API_KEY</code> to enable live GPT-4o-mini follow-up questions.
              If omitted, SpeakLog will use its smart context-aware fallback questions automatically.
            </p>
            <input
              type="password"
              className="sl-modal-input"
              placeholder="sk-proj-..."
              value={tempKey}
              onChange={e => setTempKey(e.target.value)}
            />
            <div className="sl-modal-actions">
              <button
                className="sl-cancel-btn"
                onClick={() => setShowKeyModal(false)}
              >
                Close
              </button>
              <button
                className="sl-post-btn"
                style={{ padding: '.5rem 1rem' }}
                onClick={handleSaveKey}
              >
                Save Key
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
