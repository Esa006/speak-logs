import { useState, useEffect, useRef, useCallback } from 'react'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap-icons/font/bootstrap-icons.css'
import './SpeakLog.css'
import {
  PHASES,
  QUESTIONS,
  GREETINGS,
  isConfirmation,
  isCancellation,
} from '../../utils/conversationFlow'
import { requestFollowUp } from '../../utils/aiFollowUp'
import { requestAnalysis } from '../../utils/aiAnalysis'
import { saveLog, updateLogAnalysis, retryProofSubmission } from '../../utils/logService'

/* ─────────────────────────────────────────────
   Constants & Duration Formatting
───────────────────────────────────────────── */
const TOTAL_SECONDS = 120 // ~2-minute assignment duration

function fmtTimerDisplay(s) {
  const elapsed = Math.max(0, TOTAL_SECONDS - s)
  const elM = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const elS = String(elapsed % 60).padStart(2, '0')
  return `${elM}:${elS} / 02:00`
}

export default function SpeakLog() {
  const [lang, setLang]                   = useState('ta-IN')
  const [convPhase, setConvPhase]         = useState(PHASES.INTRO)
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

  // Log save & Proof submission status
  const [savedResult, setSavedResult]     = useState(null)
  const [saveError, setSaveError]         = useState('')
  const [isRetryingProof, setIsRetryingProof] = useState(false)

  // AI Session Analysis states
  const [analysis, setAnalysis]           = useState(null)
  const [isAnalyzing, setIsAnalyzing]     = useState(false)
  const [analysisError, setAnalysisError] = useState('')

  const recognitionRef = useRef(null)
  const synthRef       = useRef(null)
  const timerRef       = useRef(null)
  const convPhaseRef   = useRef(convPhase)
  const logRef         = useRef(log)
  const phaseRef       = useRef(phase)
  const answerRef      = useRef(null)
  const saveLogRef     = useRef(null)

  useEffect(() => {
    convPhaseRef.current = convPhase
    logRef.current       = log
    phaseRef.current     = phase
  }, [convPhase, log, phase])

  const isSupported = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window
  const greeting    = GREETINGS[lang] || GREETINGS['en-IN']
  const isDone      = convPhase === PHASES.DONE

  /* ── Switch language ── */
  function handleLanguageChange(newLang) {
    if (phase === 'listening' || phase === 'speaking' || phase === 'generating') return
    setLang(newLang)
    if (recognitionRef.current) {
      recognitionRef.current.lang = newLang
    }
  }

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
      setSrError(
        lang === 'ta-IN'
          ? 'இந்த உலாவியில் பேச்சு அறிதல் கிடைக்கவில்லை. Google Chrome-ஐ பயன்படுத்தவும்.'
          : 'Speech recognition is not available in this browser. Please open SpeakLog in Google Chrome.'
      )
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
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        const msg = lang === 'ta-IN'
          ? 'தயவுசெய்து உங்கள் உலாவியில் மைக்ரோஃபோன் அணுகலை அனுமதிக்கவும்.'
          : 'Please allow microphone access.'
        setSrError(msg)
        agentSpeak(msg)
      } else if (e.error !== 'no-speech') {
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
  }, [lang, isSupported, agentSpeak])

  const stopListening = useCallback(() => {
    try {
      recognitionRef.current?.stop()
    } catch {}
  }, [])

  /* ── 2-minute Countdown timer ── */
  useEffect(() => {
    if (timerOn && convPhase !== PHASES.DONE) {
      timerRef.current = setInterval(() => {
        setTimeLeft(t => {
          if (t <= 1) {
            clearInterval(timerRef.current)
            try { recognitionRef.current?.stop() } catch {}
            // Time reached ~2 minutes: finalize transcript and guide to confirmation review
            setConvPhase(prev => {
              if (prev !== PHASES.DONE && prev !== PHASES.CONFIRM) {
                setPhase('confirming')
                const timeoutMsg = lang === 'ta-IN'
                  ? 'இரண்டு நிமிடங்கள் முடிந்தது! உங்கள் log தயாராக உள்ளது. இதை save செய்யவா?'
                  : 'Two minutes are up! Here is your daily log. Review your responses below.'
                agentSpeak(timeoutMsg)
                return PHASES.CONFIRM
              }
              return prev
            })
            return 0
          }
          return t - 1
        })
      }, 1000)
    }
    return () => clearInterval(timerRef.current)
  }, [timerOn, convPhase, lang, agentSpeak])

  /* ── Finish Log Button Handler ── */
  const handleFinishLog = useCallback(() => {
    window.speechSynthesis?.cancel()
    try { recognitionRef.current?.stop() } catch {}
    setConvPhase(PHASES.CONFIRM)
    setPhase('confirming')
    const confirmPrompt = lang === 'ta-IN'
      ? 'உங்கள் log தயாராக உள்ளது. இதை save செய்ய Submit Log அழுத்தவும் அல்லது "yes, save it" என்று சொல்லவும்.'
      : 'Here is your daily log. Review your responses below and tap Submit Log to confirm.'
    agentSpeak(confirmPrompt)
  }, [lang, agentSpeak])

  /* ── Core State Machine: Process Student Answer ── */
  const handleStudentAnswer = useCallback(async (text) => {
    const currentPhase = convPhaseRef.current

    setLines(prev => [...prev, { text, ts: Date.now() }])

    // 1. Answered WHAT_TRIED ("What did you work on today?")
    if (currentPhase === PHASES.WHAT_TRIED) {
      setLog(l => ({ ...l, tried: text }))
      setConvPhase(PHASES.FOLLOWUP_1)
      setPhase('generating')

      const mainQ = QUESTIONS[lang][PHASES.WHAT_TRIED]
      const res = await requestFollowUp({
        transcript: text,
        question: mainQ,
        language: lang,
        phase: PHASES.WHAT_TRIED,
      })

      const followUpText = res.followUp
      setFollowUpQ1(followUpText)
      setFollowUpSource(res.source)

      agentSpeak(followUpText, () => {
        startListening()
      })
      return
    }

    // 2. Answered FOLLOWUP_1 -> Move to WHAT_BROKE
    if (currentPhase === PHASES.FOLLOWUP_1) {
      setLog(l => ({ ...l, triedFollowUp: text }))
      setConvPhase(PHASES.WHAT_BROKE)

      const q2 = QUESTIONS[lang][PHASES.WHAT_BROKE]
      agentSpeak(q2, () => {
        startListening()
      })
      return
    }

    // 3. Answered WHAT_BROKE ("What broke or didn't work as expected?")
    if (currentPhase === PHASES.WHAT_BROKE) {
      setLog(l => ({ ...l, broke: text }))
      setConvPhase(PHASES.FOLLOWUP_2)
      setPhase('generating')

      const mainQ = QUESTIONS[lang][PHASES.WHAT_BROKE]
      const res = await requestFollowUp({
        transcript: text,
        question: mainQ,
        language: lang,
        phase: PHASES.WHAT_BROKE,
      })

      const followUpText = res.followUp
      setFollowUpQ2(followUpText)
      setFollowUpSource(res.source)

      agentSpeak(followUpText, () => {
        startListening()
      })
      return
    }

    // 4. Answered FOLLOWUP_2 -> Move to WHY
    if (currentPhase === PHASES.FOLLOWUP_2) {
      setLog(l => ({ ...l, brokeFollowUp: text }))
      setConvPhase(PHASES.WHY)

      const q3 = QUESTIONS[lang][PHASES.WHY]
      agentSpeak(q3, () => {
        startListening()
      })
      return
    }

    // 5. Answered WHY ("Why do you think that happened?")
    if (currentPhase === PHASES.WHY) {
      setLog(l => ({ ...l, why: text }))
      setConvPhase(PHASES.FOLLOWUP_3)
      setPhase('generating')

      const mainQ = QUESTIONS[lang][PHASES.WHY]
      const res = await requestFollowUp({
        transcript: text,
        question: mainQ,
        language: lang,
        phase: PHASES.WHY,
      })

      const followUpText = res.followUp
      setFollowUpQ3(followUpText)
      setFollowUpSource(res.source)

      agentSpeak(followUpText, () => {
        startListening()
      })
      return
    }

    // 6. Answered FOLLOWUP_3 -> Move to Confirmation Phase
    if (currentPhase === PHASES.FOLLOWUP_3) {
      setLog(l => ({ ...l, whyFollowUp: text }))
      setConvPhase(PHASES.CONFIRM)
      setPhase('confirming')

      const confirmPrompt = QUESTIONS[lang][PHASES.CONFIRM]
      agentSpeak(confirmPrompt, () => {
        startListening()
      })
      return
    }

    // 7. In Confirmation Phase -> Check for Voice Confirmation
    if (currentPhase === PHASES.CONFIRM) {
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
          ? `புரியவில்லை. இதை save செய்ய 'yes, save it' அல்லது 'சரி சேவ் பண்ணு' என்று சொல்லவும் அல்லது Submit Log கிளிக் செய்யவும்.`
          : `I didn't quite catch that. Say "yes, save it" to confirm, or click Submit Log.`
        agentSpeak(retryPrompt, () => {
          startListening()
        })
      }
    }
  }, [lang, agentSpeak, startListening])

  /* ── Generate AI Session Analysis ── */
  const runAnalysis = useCallback(async (currentLog, logId) => {
    setIsAnalyzing(true)
    setAnalysisError('')
    try {
      const res = await requestAnalysis({
        log: currentLog,
        language: lang,
      })
      if (res && res.success) {
        setAnalysis(res)
        if (logId) {
          updateLogAnalysis(logId, res)
        }
      } else {
        setAnalysisError(res?.error || 'Unable to generate analysis')
      }
    } catch (err) {
      console.error('Analysis error:', err)
      setAnalysisError(err.message || 'Analysis failed')
    } finally {
      setIsAnalyzing(false)
    }
  }, [lang])

  /* ── Save Log & Submit ── */
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
        triedFollowUp: currentLog.triedFollowUp,
        broke: currentLog.broke,
        brokeFollowUp: currentLog.brokeFollowUp,
        why: currentLog.why,
        whyFollowUp: currentLog.whyFollowUp,
        language: lang,
      })

      setSavedResult(result)
      setConvPhase(PHASES.DONE)
      setPhase('done')

      // Trigger AI Analysis in parallel
      runAnalysis(currentLog, result.id)

      const successMsg = QUESTIONS[lang][PHASES.DONE]
      agentSpeak(successMsg)
    } catch (err) {
      console.error('Save error:', err)
      setSaveError(err.message || 'Failed to save log')
      setPhase('confirming')
    }
  }, [lang, agentSpeak, runAnalysis])

  /* ── Retry Proof Submission ── */
  const handleRetryProof = useCallback(async () => {
    if (!savedResult?.id) return
    setIsRetryingProof(true)
    try {
      const res = await retryProofSubmission({
        logId: savedResult.id,
        log: logRef.current,
        language: lang,
      })
      if (res.proofSubmitted) {
        setSavedResult(prev => ({ ...prev, proofSubmitted: true, proofError: null }))
        const successSpeech = lang === 'ta-IN'
          ? 'Proof submission வெற்றிகரமாக முடிந்தது!'
          : 'Log submitted successfully to Proof!'
        agentSpeak(successSpeech)
      } else {
        setSavedResult(prev => ({ ...prev, proofError: res.error || 'Retry rejected' }))
      }
    } catch (err) {
      console.error('Proof retry error:', err)
    } finally {
      setIsRetryingProof(false)
    }
  }, [savedResult, lang, agentSpeak])

  useEffect(() => {
    answerRef.current = handleStudentAnswer
  }, [handleStudentAnswer])

  useEffect(() => {
    saveLogRef.current = triggerSaveLog
  }, [triggerSaveLog])

  /* ── Mic Tap Handler ── */
  function handleMicTap() {
    if (convPhase === PHASES.DONE) return

    if (phase === 'listening') {
      stopListening()
      return
    }

    if (phase === 'speaking') {
      window.speechSynthesis?.cancel()
      setAgentText('')
    }

    if (convPhase === PHASES.INTRO || !timerOn) {
      setTimerOn(true)
      const introPrompt = QUESTIONS[lang][PHASES.INTRO]
      agentSpeak(introPrompt, () => {
        setConvPhase(PHASES.WHAT_TRIED)
        startListening()
      })
      return
    }

    startListening()
  }

  /* ── Reset / Start New Session ── */
  function handleReset() {
    window.speechSynthesis?.cancel()
    try { recognitionRef.current?.stop() } catch {}
    clearInterval(timerRef.current)

    setPhase('idle')
    setConvPhase(PHASES.INTRO)
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
    setIsRetryingProof(false)
    setAnalysis(null)
    setIsAnalyzing(false)
    setAnalysisError('')
    setLog({
      tried: '',
      triedFollowUp: '',
      broke: '',
      brokeFollowUp: '',
      why: '',
      whyFollowUp: '',
    })
  }

  /* ── Determine Current Question / Speech Quote Text ── */
  let currentTitle = ''
  switch (convPhase) {
    case PHASES.INTRO:
      currentTitle = lang === 'ta-IN' ? 'SpeakLog-க்கு வரவேற்கிறோம்' : 'Welcome to SpeakLog'
      break
    case PHASES.WHAT_TRIED:
      currentTitle = QUESTIONS[lang][PHASES.WHAT_TRIED]
      break
    case PHASES.FOLLOWUP_1:
      currentTitle = followUpQ1 || '...'
      break
    case PHASES.WHAT_BROKE:
      currentTitle = QUESTIONS[lang][PHASES.WHAT_BROKE]
      break
    case PHASES.FOLLOWUP_2:
      currentTitle = followUpQ2 || '...'
      break
    case PHASES.WHY:
      currentTitle = QUESTIONS[lang][PHASES.WHY]
      break
    case PHASES.FOLLOWUP_3:
      currentTitle = followUpQ3 || '...'
      break
    case PHASES.CONFIRM:
      currentTitle = lang === 'ta-IN' ? 'உங்கள் Log-ஐ சரிபார்க்கவும்' : 'Your Daily Log'
      break
    case PHASES.DONE:
      currentTitle = lang === 'ta-IN' ? 'நன்றி! பதிவு முடிந்தது' : 'Session Complete'
      break
    default:
      break
  }

  const isConfirmOrDone = convPhase === PHASES.CONFIRM || convPhase === PHASES.DONE
  const isBeforeStart   = !timerOn && convPhase === PHASES.INTRO
  const isAfterStart    = timerOn && !isConfirmOrDone
  const timerDanger     = timeLeft <= 20
  const timerWarning    = timeLeft <= 40 && !timerDanger

  // Current response snippet for the live response box during After Start
  let currentResponseSnippet = interim
  if (!currentResponseSnippet) {
    switch (convPhase) {
      case PHASES.WHAT_TRIED:
        currentResponseSnippet = log.tried
        break
      case PHASES.FOLLOWUP_1:
        currentResponseSnippet = log.triedFollowUp || log.tried
        break
      case PHASES.WHAT_BROKE:
        currentResponseSnippet = log.broke
        break
      case PHASES.FOLLOWUP_2:
        currentResponseSnippet = log.brokeFollowUp || log.broke
        break
      case PHASES.WHY:
        currentResponseSnippet = log.why
        break
      case PHASES.FOLLOWUP_3:
        currentResponseSnippet = log.whyFollowUp || log.why
        break
      default:
        break
    }
  }

  return (
    <div className="sl-bg">
      <div className="sl-card">

        {/* ════════════════════════════════════════════════════════════════
            1. BEFORE STARTING (UI 1: Presentation & Assignment Clarity)
           ════════════════════════════════════════════════════════════════ */}
        {isBeforeStart && (
          <div>
            {/* Topbar: SpeakLog + தமிழ் | English + 02:00 */}
            <div className="sl-topbar">
              <div className="sl-brand">
                <div className="sl-logo"><i className="bi bi-mic-fill" /></div>
                <span className="sl-brand-name">SpeakLog</span>
              </div>
              <div className="d-flex align-items-center gap-2">
                <div className="sl-lang-toggle" role="group" aria-label="Language selection">
                  <button
                    id="lang-ta"
                    className={`sl-lang-btn ${lang === 'ta-IN' ? 'active' : ''}`}
                    onClick={() => handleLanguageChange('ta-IN')}
                    title="தமிழ் (Tamil)"
                  >
                    தமிழ்
                  </button>
                  <button
                    id="lang-en"
                    className={`sl-lang-btn ${lang === 'en-IN' ? 'active' : ''}`}
                    onClick={() => handleLanguageChange('en-IN')}
                    title="English"
                  >
                    English
                  </button>
                </div>
                <div className="sl-timer" title="Session limit: 2 minutes">
                  <i className="bi bi-clock me-1" />
                  02:00
                </div>
              </div>
            </div>

            {/* 👋 Let's talk about your day */}
            <div className="sl-greeting">
              <div className="sl-greeting-main">
                {lang === 'ta-IN' ? '👋 வணக்கம்! உங்கள் நாளைப் பற்றி பேசலாம்' : "👋 Let's talk about your day"}
              </div>
              <div className="sl-greeting-en">
                {lang === 'ta-IN'
                  ? 'உங்கள் பொறியியல் பதிவிற்கான 2 நிமிட குரல் பிரதிபலிப்பு'
                  : '2-minute voice reflection for your engineering log'}
              </div>
            </div>

            {/* Welcome Card */}
            <div className="sl-question-box">
              <div className="sl-q-num">
                {lang === 'ta-IN' ? 'படி 1: மொழியைத் தேர்ந்தெடுத்துத் தொடங்கவும்' : 'STEP 1: CHOOSE LANGUAGE & START'}
              </div>
              <div className="sl-q-main">
                {lang === 'ta-IN' ? 'SpeakLog-க்கு வரவேற்கிறோம்' : 'Welcome to SpeakLog'}
              </div>
              <div className="sl-q-en">
                {lang === 'ta-IN'
                  ? 'உங்கள் தினசரி பொறியியல் பதிவை 2 நிமிடங்களில் பதிவு செய்யுங்கள்.'
                  : "Let's capture your daily engineering log in about 2 minutes."}
              </div>
              <div className="sl-intro-hint">
                <i className="bi bi-chat-quote-fill me-2 text-primary" />
                <span>
                  {lang === 'ta-IN'
                    ? 'மைக்ரோஃபோனைத் தட்டவும் அல்லது கீழே உள்ள பொத்தானை அழுத்தி தொடங்கவும்.'
                    : 'Tap the microphone to start your 2-minute voice reflection check-in.'}
                </span>
              </div>
            </div>

            {/* Central Mic Button + Start Voice Log */}
            <div className="sl-mic-zone">
              <button
                id="mic-btn"
                className="sl-mic"
                onClick={handleMicTap}
                aria-label="Start voice log"
              >
                <i className="bi bi-mic-fill" />
              </button>
              <span className="sl-mic-hint">
                {lang === 'ta-IN' ? 'தொடங்க மைக்ரோஃபோனைத் தட்டவும்' : 'Tap to start voice log'}
              </span>
              <button
                id="btn-start-log"
                className="sl-finish-btn"
                onClick={handleMicTap}
                style={{
                  background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
                  border: 'none',
                  boxShadow: '0 4px 18px var(--accent-glow)',
                  marginTop: '0.2rem',
                }}
              >
                <i className="bi bi-play-circle-fill me-1" />
                Start Voice Log
              </button>
            </div>

            {/* Speech error notice if any */}
            {srError && (
              <div className="sl-error mx-3 mb-2">
                <i className="bi bi-exclamation-circle me-2" />{srError}
              </div>
            )}

            {!isSupported && (
              <div className="sl-error mx-3 mb-2">
                <i className="bi bi-exclamation-triangle me-2" />
                {lang === 'ta-IN'
                  ? 'இந்த உலாவியில் பேச்சு அறிதல் கிடைக்கவில்லை. Google Chrome-ஐ பயன்படுத்தவும்.'
                  : 'Speech recognition is not available in this browser. Please open SpeakLog in Google Chrome.'}
              </div>
            )}

            {/* Bottom verbatim response placeholder box */}
            <div className="sl-bottom">
              <div className="sl-transcript">
                <div className="sl-transcript-placeholder">
                  <i className="bi bi-chat-square-text me-2" />
                  {lang === 'ta-IN'
                    ? 'உங்கள் பதில்கள் இங்கு தோன்றும்...'
                    : 'Your verbatim responses will appear here'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════
            2. AFTER START (UI 2: Simplicity & Clean Voice Interaction)
           ════════════════════════════════════════════════════════════════ */}
        {isAfterStart && (
          <div>
            {/* Topbar: SpeakLog + தமிழ் | English */}
            <div className="sl-topbar">
              <div className="sl-brand">
                <div className="sl-logo"><i className="bi bi-mic-fill" /></div>
                <span className="sl-brand-name">SpeakLog</span>
              </div>
              <div className="sl-lang-toggle" role="group" aria-label="Language selection">
                <button
                  id="lang-ta"
                  className={`sl-lang-btn ${lang === 'ta-IN' ? 'active' : ''}`}
                  onClick={() => handleLanguageChange('ta-IN')}
                  disabled={phase === 'listening' || phase === 'speaking' || phase === 'generating'}
                  title="தமிழ் (Tamil)"
                >
                  தமிழ்
                </button>
                <button
                  id="lang-en"
                  className={`sl-lang-btn ${lang === 'en-IN' ? 'active' : ''}`}
                  onClick={() => handleLanguageChange('en-IN')}
                  disabled={phase === 'listening' || phase === 'speaking' || phase === 'generating'}
                  title="English"
                >
                  English
                </button>
              </div>
            </div>

            <div className="sl-after-start-body">
              {/* 01:24 / 02:00 Timer */}
              <div className={`sl-timer-counter ${timerDanger ? 'danger' : timerWarning ? 'warning' : ''}`}>
                <i className="bi bi-clock me-1" />
                <span>{fmtTimerDisplay(timeLeft)}</span>
              </div>

              {/* Status indicator */}
              <div className={`sl-status-pill ${phase}`}>
                {phase === 'listening' ? (
                  <>
                    <i className="bi bi-broadcast" />
                    <span>🎙️ Listening</span>
                  </>
                ) : phase === 'speaking' ? (
                  <>
                    <i className="bi bi-volume-up-fill" />
                    <span>🔊 Speaking...</span>
                  </>
                ) : phase === 'generating' ? (
                  <>
                    <i className="bi bi-stars sl-spin" />
                    <span>✨ AI Follow-up...</span>
                  </>
                ) : (
                  <>
                    <i className="bi bi-mic" />
                    <span>🎙️ Ready</span>
                  </>
                )}
              </div>

              {/* Central Mic Button */}
              <div className="sl-mic-zone" style={{ padding: '0.2rem 0' }}>
                <button
                  id="mic-btn"
                  className={`sl-mic ${phase === 'listening' ? 'active' : phase === 'speaking' ? 'agent' : ''}`}
                  onClick={handleMicTap}
                  disabled={phase === 'generating' || phase === 'saving'}
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
              </div>

              {/* Agent's current question */}
              <div className="sl-speech-quote">
                {`"${currentTitle}"`}
              </div>

              {/* Response Card: Your response appears here... */}
              <div className="sl-live-response-box">
                <div className="sl-live-response-header">
                  <i className="bi bi-chat-left-dots-fill me-1" />
                  <span>{lang === 'ta-IN' ? 'உங்கள் நேரடி பதில்' : 'Your Live Response'}</span>
                </div>
                <div className="sl-live-response-content">
                  {interim ? (
                    <span className="sl-live-interim">{interim}</span>
                  ) : currentResponseSnippet ? (
                    <span className="sl-live-captured">{currentResponseSnippet}</span>
                  ) : (
                    <span className="sl-live-placeholder">
                      {lang === 'ta-IN' ? 'உங்கள் பதில் இங்கு தோன்றும்...' : 'Your response appears here...'}
                    </span>
                  )}
                </div>
              </div>

              {/* Speech error notice if any */}
              {srError && (
                <div className="sl-error mx-3 mb-2" style={{ width: '100%' }}>
                  <i className="bi bi-exclamation-circle me-2" />{srError}
                </div>
              )}

              {/* [ Finish Log ] */}
              <div style={{ marginTop: '0.4rem' }}>
                <button
                  id="btn-finish-log"
                  className="sl-finish-btn"
                  onClick={handleFinishLog}
                >
                  <i className="bi bi-check2-all me-1" />
                  Finish Log
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════
            3. FINAL CONFIRMATION (Your Daily Log)
           ════════════════════════════════════════════════════════════════ */}
        {isConfirmOrDone && (
          <div style={{ padding: '1rem 1.25rem 1.5rem' }}>
            <div className="sl-daily-log-header">
              <h2 className="sl-daily-log-title">Your Daily Log</h2>
              <p className="sl-daily-log-sub">
                {lang === 'ta-IN'
                  ? 'உங்கள் சொந்த வார்த்தைகளில் பதிவு செய்யப்பட்ட விவரங்கள்'
                  : 'Preserved verbatim without summarization'}
              </p>
            </div>

            {/* Three distinct verbatim sections */}
            <div className="sl-verbatim-container">
              {/* Section 1: What I worked on */}
              <div className="sl-verbatim-card">
                <div className="sl-verbatim-tag tried">
                  <i className="bi bi-lightning-charge-fill me-1" /> What I worked on
                </div>
                <div className={`sl-verbatim-text ${!log.tried ? 'empty' : ''}`}>
                  {log.tried || 'No response recorded'}
                  {log.triedFollowUp && (
                    <div className="sl-verbatim-sub">
                      <strong>Follow-up:</strong> {log.triedFollowUp}
                    </div>
                  )}
                </div>
              </div>

              {/* Section 2: What broke */}
              <div className="sl-verbatim-card">
                <div className="sl-verbatim-tag broke">
                  <i className="bi bi-exclamation-triangle-fill me-1" /> What broke
                </div>
                <div className={`sl-verbatim-text ${!log.broke ? 'empty' : ''}`}>
                  {log.broke || 'No response recorded'}
                  {log.brokeFollowUp && (
                    <div className="sl-verbatim-sub">
                      <strong>Follow-up:</strong> {log.brokeFollowUp}
                    </div>
                  )}
                </div>
              </div>

              {/* Section 3: Why */}
              <div className="sl-verbatim-card">
                <div className="sl-verbatim-tag why">
                  <i className="bi bi-lightbulb-fill me-1" /> Why
                </div>
                <div className={`sl-verbatim-text ${!log.why ? 'empty' : ''}`}>
                  {log.why || 'No response recorded'}
                  {log.whyFollowUp && (
                    <div className="sl-verbatim-sub">
                      <strong>Follow-up:</strong> {log.whyFollowUp}
                    </div>
                  )}
                </div>
              </div>

              {/* Confirm Actions: Cancel & Save Log side-by-side */}
              {convPhase === PHASES.CONFIRM && (
                <div className="sl-confirm-actions">
                  <button
                    id="btn-cancel-log"
                    className="sl-cancel-btn"
                    onClick={handleReset}
                    disabled={phase === 'saving'}
                  >
                    <i className="bi bi-x-circle me-1" />
                    Cancel
                  </button>
                  <button
                    id="btn-save-log"
                    className="sl-save-btn"
                    onClick={triggerSaveLog}
                    disabled={phase === 'saving'}
                  >
                    <i className="bi bi-cloud-arrow-up-fill me-1" />
                    {phase === 'saving' ? 'Saving...' : 'Save Log'}
                  </button>
                </div>
              )}
            </div>

            {/* Error banner if save failed */}
            {saveError && (
              <div className="sl-error mt-3">
                <i className="bi bi-exclamation-triangle me-2" />Save error: {saveError}
              </div>
            )}

            {/* Dual Status: Log Saved & Proof Submission Card */}
            {savedResult && (
              <div className="sl-save-card">
                <div className="sl-save-title">
                  <i className="bi bi-check-circle-fill text-success" />
                  ✓ Log saved successfully
                </div>
                <div className="sl-save-id">Log ID: {savedResult.id}</div>

                <div className="sl-proof-row">
                  {savedResult.proofSubmitted ? (
                    <span className="sl-proof-badge success">
                      <i className="bi bi-patch-check-fill" />
                      ✓ Submitted successfully
                    </span>
                  ) : (
                    <>
                      <span className="sl-proof-badge warning">
                        <i className="bi bi-exclamation-triangle-fill" />
                        ⚠ Log created, but submission failed.
                      </span>
                      <button
                        className="sl-proof-retry-btn"
                        onClick={handleRetryProof}
                        disabled={isRetryingProof}
                        title="Retry submission to Proof"
                      >
                        <i className={`bi bi-arrow-clockwise ${isRetryingProof ? 'sl-spin' : ''}`} />
                        {isRetryingProof ? 'Retrying…' : 'Retry'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* AI Mentor Analysis Box */}
            {savedResult && (
              <div className="sl-analysis-box">
                <div className="sl-analysis-header">
                  <div className="sl-analysis-title">
                    <i className="bi bi-robot text-primary" />
                    <span>AI Mentor Analysis</span>
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    <span className={`sl-analysis-badge ${analysis?.source === 'openai' ? 'openai' : ''}`}>
                      {analysis?.source === 'openai' ? 'GPT-4o-mini' : 'Smart Heuristic'}
                    </span>
                    <button
                      className="sl-icon-btn"
                      style={{ width: '28px', height: '28px', fontSize: '0.8rem' }}
                      onClick={() => runAnalysis(log, savedResult.id)}
                      title="Re-analyze"
                      disabled={isAnalyzing}
                    >
                      <i className={`bi bi-arrow-clockwise ${isAnalyzing ? 'sl-spin' : ''}`} />
                    </button>
                  </div>
                </div>

                {isAnalyzing ? (
                  <div className="sl-analysis-loading">
                    <i className="bi bi-gear-wide-connected sl-spin text-primary" style={{ fontSize: '1.6rem' }} />
                    <span>Analyzing your engineering log with AI…</span>
                  </div>
                ) : analysis ? (
                  <div>
                    {analysis.momentum && (
                      <div className="sl-analysis-momentum-tag">
                        <i className="bi bi-lightning-charge-fill text-warning" />
                        <span><strong>Momentum:</strong> {analysis.momentum}</span>
                      </div>
                    )}

                    <div className="sl-analysis-section">
                      <div className="sl-analysis-sec-title">
                        <i className="bi bi-journal-text" /> Today's Focus
                      </div>
                      <p className="sl-analysis-sec-content">{analysis.summary}</p>
                    </div>

                    {analysis.blockerAnalysis && analysis.blockerAnalysis !== 'N/A' && (
                      <div className="sl-analysis-section">
                        <div className="sl-analysis-sec-title">
                          <i className="bi bi-bug" /> Blocker & Root Cause
                        </div>
                        <p className="sl-analysis-sec-content blocker">{analysis.blockerAnalysis}</p>
                      </div>
                    )}

                    {analysis.keyLearnings && analysis.keyLearnings !== 'N/A' && (
                      <div className="sl-analysis-section">
                        <div className="sl-analysis-sec-title">
                          <i className="bi bi-lightbulb" /> Key Takeaway
                        </div>
                        <p className="sl-analysis-sec-content">{analysis.keyLearnings}</p>
                      </div>
                    )}

                    {Array.isArray(analysis.nextSteps) && analysis.nextSteps.length > 0 && (
                      <div className="sl-analysis-section">
                        <div className="sl-analysis-sec-title">
                          <i className="bi bi-check2-circle" /> Recommended Next Steps
                        </div>
                        <ul className="sl-analysis-steps">
                          {analysis.nextSteps.map((s, idx) => (
                            <li key={idx} className="sl-analysis-step-item">
                              <i className="bi bi-arrow-right-short" />
                              <span>{s}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {Array.isArray(analysis.tags) && analysis.tags.length > 0 && (
                      <div className="sl-analysis-section">
                        <div className="sl-analysis-sec-title">
                          <i className="bi bi-tags" /> Skill & Tech Tags
                        </div>
                        <div className="sl-analysis-tags-wrap">
                          {analysis.tags.map((tag, idx) => (
                            <span key={idx} className="sl-analysis-tag">#{tag}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {analysis.feedback && (
                      <div className="sl-analysis-feedback">
                        "{analysis.feedback}"
                      </div>
                    )}
                  </div>
                ) : analysisError ? (
                  <div className="sl-error">
                    <i className="bi bi-exclamation-triangle me-2" />
                    {analysisError}
                    <div className="mt-2">
                      <button
                        className="sl-analysis-btn"
                        onClick={() => runAnalysis(log, savedResult.id)}
                      >
                        Try Again
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="sl-analysis-btn"
                    onClick={() => runAnalysis(log, savedResult.id)}
                  >
                    <i className="bi bi-stars" /> Generate AI Insights
                  </button>
                )}
              </div>
            )}

            {/* Restart button */}
            {isDone && (
              <div className="text-center mt-3 mb-2">
                <button id="btn-reset" className="sl-finish-btn" onClick={handleReset}>
                  <i className="bi bi-arrow-counterclockwise me-1" />Start a new log
                </button>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
