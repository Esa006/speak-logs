import { useState, useEffect, useRef, useCallback } from 'react'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap-icons/font/bootstrap-icons.css'
import './SpeakLog.css'
import {
  PHASES,
  QUESTIONS,
  isConfirmation,
  isCancellation,
} from '../../utils/conversationFlow'
import { requestFollowUp } from '../../utils/aiFollowUp'
import { requestAnalysis } from '../../utils/aiAnalysis'
import { saveLog, updateLogAnalysis, retryProofSubmission } from '../../utils/logService'
import { useVoicePipeline, VOICE_STATE } from '../../hooks/useVoicePipeline'

/* ─────────────────────────────────────────────
   Constants & Duration Formatting
───────────────────────────────────────────── */
const TOTAL_SECONDS = 120

function fmtTimerDisplay(s) {
  const elapsed = Math.max(0, TOTAL_SECONDS - s)
  const elM = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const elS = String(elapsed % 60).padStart(2, '0')
  return `${elM}:${elS} / 02:00`
}

/* Map VOICE_STATE → CSS phase class (keeps existing CSS working) */
function voiceStateToPhase(vs) {
  if (vs === VOICE_STATE.LISTENING)  return 'listening'
  if (vs === VOICE_STATE.SPEAKING)   return 'speaking'
  if (vs === VOICE_STATE.PROCESSING) return 'generating'
  if (vs === VOICE_STATE.CONFIRMING) return 'confirming'
  return 'idle'
}

export default function SpeakLog() {
  const [lang, setLang]                   = useState('ta-IN')
  const [convPhase, setConvPhase]         = useState(PHASES.INTRO)
  const [timeLeft, setTimeLeft]           = useState(TOTAL_SECONDS)
  const [timerOn, setTimerOn]             = useState(false)
  const [saveError, setSaveError]         = useState('')
  const [isSaving, setIsSaving]           = useState(false)

  // Student verbatim answers
  const [log, setLog] = useState({
    tried: '', triedFollowUp: '',
    broke: '', brokeFollowUp: '',
    why:   '', whyFollowUp:   '',
  })

  // AI follow-up display text
  const [followUpQ1, setFollowUpQ1] = useState('')
  const [followUpQ2, setFollowUpQ2] = useState('')
  const [followUpQ3, setFollowUpQ3] = useState('')

  // Save result & proof
  const [savedResult, setSavedResult]       = useState(null)
  const [isRetryingProof, setIsRetryingProof] = useState(false)

  // AI analysis
  const [analysis, setAnalysis]         = useState(null)
  const [isAnalyzing, setIsAnalyzing]   = useState(false)
  const [analysisError, setAnalysisError] = useState('')

  /* ── Stable refs for timer/callback closures ── */
  const convPhaseRef        = useRef(convPhase)
  const logRef              = useRef(log)
  const langRef             = useRef(lang)
  const timerRef            = useRef(null)
  const agentSpeakRef       = useRef(null)  // always-current agentSpeak for timer
  const saveLogRef          = useRef(null)  // always-current save for CONFIRM voice
  const processingAnswerRef = useRef(false) // Guard 3: Processing lock for OpenAI
  const requestIdRef        = useRef(0)     // Guard 10: Stale async request protector

  useEffect(() => {
    convPhaseRef.current = convPhase
    logRef.current       = log
    langRef.current      = lang
  }, [convPhase, log, lang])

  /* ──────────────────────────────────────────────────────────────────────
     useVoicePipeline — the ONLY place mic/TTS logic lives.
     SpeakLog never touches SpeechRecognition or speechSynthesis directly.
     ────────────────────────────────────────────────────────────────────── */
  // Forward-declared ref so onTranscript can call handleStudentAnswer
  // without creating a circular dependency in useCallback deps.
  const handleStudentAnswerRef = useRef(null)

  const {
    voiceState,
    interim,
    srError,
    isSupported,
    startListening,
    stopListening,
    agentSpeak,
    cancelSpeech,
    resetDuplicateGuard,
    setConfirming,
  } = useVoicePipeline({
    lang,
    onTranscript: useCallback((text) => {
      // Delivered by pipeline after silence debounce —
      // guaranteed non-empty, non-duplicate, once per utterance.
      handleStudentAnswerRef.current?.(text)
    }, []),
    onError: useCallback((msg) => {
      setSaveError(msg)
    }, []),
  })

  // Keep agentSpeakRef current so the timer can speak without stale closure
  useEffect(() => { agentSpeakRef.current = agentSpeak }, [agentSpeak])

  /* Derived UI helpers */
  const phase           = voiceStateToPhase(voiceState)
  const isDone          = convPhase === PHASES.DONE
  const isConfirmOrDone = convPhase === PHASES.CONFIRM || convPhase === PHASES.DONE
  const isBeforeStart   = !timerOn && convPhase === PHASES.INTRO
  const isAfterStart    = timerOn && !isConfirmOrDone
  const timerDanger     = timeLeft <= 20
  const timerWarning    = timeLeft <= 40 && !timerDanger

  /* ── Switch language (only when mic/TTS is idle) ── */
  function handleLanguageChange(newLang) {
    if (
      voiceState === VOICE_STATE.LISTENING ||
      voiceState === VOICE_STATE.SPEAKING  ||
      voiceState === VOICE_STATE.PROCESSING
    ) return
    setLang(newLang)
  }

  /* ── 2-minute Countdown timer ── */
  useEffect(() => {
    if (!timerOn) return
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(timerRef.current)
          try { stopListening() } catch {}
          if (convPhaseRef.current !== PHASES.DONE && convPhaseRef.current !== PHASES.CONFIRM) {
            setConvPhase(PHASES.CONFIRM)
            const msg = langRef.current === 'ta-IN'
              ? 'இரண்டு நிமிடங்கள் முடிந்தது! உங்கள் log தயாராக உள்ளது. இதை Proof-ல் post செய்யவா?'
              : 'Two minutes are up! Here is your daily log on Proof. Say "yes, post it" to confirm.'
            agentSpeakRef.current?.({ text: msg, id: 'timeout_confirm' }, () => {
              setConfirming()
              startListening()
            })
          }
          return 0
        }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [timerOn, stopListening, setConfirming, startListening])

  /* ── Finish Log Button ── */
  const handleFinishLog = useCallback(() => {
    stopListening()
    cancelSpeech()
    setConvPhase(PHASES.CONFIRM)
    const prompt = lang === 'ta-IN'
      ? 'உங்கள் log தயாராக உள்ளது. இதை Proof-ல் post செய்ய "yes, post it" அல்லது "சரி போஸ்ட் பண்ணு" என்று சொல்லவும்.'
      : 'Here is your daily log on Proof. Say "yes, post it" to confirm, or click Post to Proof.'
    agentSpeak({ text: prompt, id: `finish_${Date.now()}` }, () => {
      setConfirming()
      startListening()
    })
  }, [lang, agentSpeak, startListening, stopListening, cancelSpeech, setConfirming])

  /* ── AI Session Analysis ── */
  const runAnalysis = useCallback(async (currentLog, logId) => {
    setIsAnalyzing(true)
    setAnalysisError('')
    try {
      const res = await requestAnalysis({ log: currentLog, language: lang })
      if (res?.success) {
        setAnalysis(res)
        if (logId) updateLogAnalysis(logId, res)
      } else {
        setAnalysisError(res?.error || 'Unable to generate analysis')
      }
    } catch (err) {
      setAnalysisError(err.message || 'Analysis failed')
    } finally {
      setIsAnalyzing(false)
    }
  }, [lang])

  /* ── Save Log ── */
  const triggerSaveLog = useCallback(async () => {
    setIsSaving(true)
    setSaveError('')
    const saveMsg = lang === 'ta-IN' ? 'அருமை! உங்கள் log-ஐ Proof-ல் save செய்கிறேன்…' : 'Saving your log to Proof now…'
    agentSpeak({ text: saveMsg, id: 'saving_now' })
    try {
      const current = logRef.current
      const result  = await saveLog({
        tried:         current.tried,
        triedFollowUp: current.triedFollowUp,
        broke:         current.broke,
        brokeFollowUp: current.brokeFollowUp,
        why:           current.why,
        whyFollowUp:   current.whyFollowUp,
        language: lang,
      })
      setSavedResult(result)
      setConvPhase(PHASES.DONE)
      runAnalysis(current, result.id)
      agentSpeak({ text: QUESTIONS[lang][PHASES.DONE], id: `done_${result.id}` })
    } catch (err) {
      console.error('Save error:', err)
      setSaveError(err.message || 'Failed to save log')
    } finally {
      setIsSaving(false)
    }
  }, [lang, agentSpeak, runAnalysis])

  useEffect(() => { saveLogRef.current = triggerSaveLog }, [triggerSaveLog])

  /* ── Retry Proof Submission ── */
  const handleRetryProof = useCallback(async () => {
    if (!savedResult?.id) return
    setIsRetryingProof(true)
    try {
      const res = await retryProofSubmission({
        logId: savedResult.id,
        log:   logRef.current,
        language: lang,
      })
      if (res.proofSubmitted) {
        setSavedResult(prev => ({ ...prev, proofSubmitted: true, proofError: null }))
        agentSpeak(lang === 'ta-IN' ? 'Proof submission வெற்றிகரமாக முடிந்தது!' : 'Log submitted successfully to Proof!')
      } else {
        setSavedResult(prev => ({ ...prev, proofError: res.error || 'Retry rejected' }))
      }
    } catch (err) {
      console.error('Proof retry error:', err)
    } finally {
      setIsRetryingProof(false)
    }
  }, [savedResult, lang, agentSpeak])

  /* ──────────────────────────────────────────────────────────────────────
     Core Conversation State Machine
     Receives ONE finalized transcript per utterance from useVoicePipeline.
     ────────────────────────────────────────────────────────────────────── */
  const handleStudentAnswer = useCallback(async (text) => {
    if (!text || !text.trim()) return

    // Guard 3: Processing lock to prevent duplicate OpenAI requests
    if (processingAnswerRef.current) {
      console.log('[AI] duplicate answer processing prevented for:', text)
      return
    }
    processingAnswerRef.current = true

    const currentPhase = convPhaseRef.current

    try {
      if (currentPhase === PHASES.WHAT_TRIED) {
        setLog(l => ({ ...l, tried: text }))
        setConvPhase(PHASES.FOLLOWUP_1)

        const thisReq = ++requestIdRef.current
        console.log('[AI] request started for WHAT_TRIED, reqId:', thisReq)

        const res = await requestFollowUp({
          transcript: text,
          question:   QUESTIONS[lang][PHASES.WHAT_TRIED],
          language:   lang,
          phase:      PHASES.WHAT_TRIED,
        })

        // Guard 10: Stale async response protection
        if (thisReq !== requestIdRef.current) {
          console.log('[AI] stale async response discarded:', thisReq)
          return
        }
        console.log('[AI] request completed for WHAT_TRIED:', res.followUp)

        setFollowUpQ1(res.followUp)
        const respId = `q1_${Date.now()}`
        agentSpeak({ text: res.followUp, id: respId }, () => {
          processingAnswerRef.current = false
          startListening()
        })
        return
      }

      if (currentPhase === PHASES.FOLLOWUP_1) {
        setLog(l => ({ ...l, triedFollowUp: text }))
        setConvPhase(PHASES.WHAT_BROKE)

        const respId = `q_broke_${Date.now()}`
        agentSpeak({ text: QUESTIONS[lang][PHASES.WHAT_BROKE], id: respId }, () => {
          processingAnswerRef.current = false
          startListening()
        })
        return
      }

      if (currentPhase === PHASES.WHAT_BROKE) {
        setLog(l => ({ ...l, broke: text }))
        setConvPhase(PHASES.FOLLOWUP_2)

        const thisReq = ++requestIdRef.current
        console.log('[AI] request started for WHAT_BROKE, reqId:', thisReq)

        const res = await requestFollowUp({
          transcript: text,
          question:   QUESTIONS[lang][PHASES.WHAT_BROKE],
          language:   lang,
          phase:      PHASES.WHAT_BROKE,
        })

        if (thisReq !== requestIdRef.current) {
          console.log('[AI] stale async response discarded:', thisReq)
          return
        }
        console.log('[AI] request completed for WHAT_BROKE:', res.followUp)

        setFollowUpQ2(res.followUp)
        const respId = `q2_${Date.now()}`
        agentSpeak({ text: res.followUp, id: respId }, () => {
          processingAnswerRef.current = false
          startListening()
        })
        return
      }

      if (currentPhase === PHASES.FOLLOWUP_2) {
        setLog(l => ({ ...l, brokeFollowUp: text }))
        setConvPhase(PHASES.WHY)

        const respId = `q_why_${Date.now()}`
        agentSpeak({ text: QUESTIONS[lang][PHASES.WHY], id: respId }, () => {
          processingAnswerRef.current = false
          startListening()
        })
        return
      }

      if (currentPhase === PHASES.WHY) {
        setLog(l => ({ ...l, why: text }))
        setConvPhase(PHASES.FOLLOWUP_3)

        const thisReq = ++requestIdRef.current
        console.log('[AI] request started for WHY, reqId:', thisReq)

        const res = await requestFollowUp({
          transcript: text,
          question:   QUESTIONS[lang][PHASES.WHY],
          language:   lang,
          phase:      PHASES.WHY,
        })

        if (thisReq !== requestIdRef.current) {
          console.log('[AI] stale async response discarded:', thisReq)
          return
        }
        console.log('[AI] request completed for WHY:', res.followUp)

        setFollowUpQ3(res.followUp)
        const respId = `q3_${Date.now()}`
        agentSpeak({ text: res.followUp, id: respId }, () => {
          processingAnswerRef.current = false
          startListening()
        })
        return
      }

      if (currentPhase === PHASES.FOLLOWUP_3) {
        setLog(l => ({ ...l, whyFollowUp: text }))
        setConvPhase(PHASES.CONFIRM)

        const respId = `confirm_${Date.now()}`
        agentSpeak({ text: QUESTIONS[lang][PHASES.CONFIRM], id: respId }, () => {
          processingAnswerRef.current = false
          setConfirming()
          startListening()
        })
        return
      }

      if (currentPhase === PHASES.CONFIRM) {
        if (isConfirmation(text)) {
          saveLogRef.current?.()
          processingAnswerRef.current = false
        } else if (isCancellation(text)) {
          const msg = lang === 'ta-IN'
            ? 'சரி, log ரத்து செய்யப்பட்டது. நீங்கள் எப்போது வேண்டுமானாலும் மீண்டும் தொடங்கலாம்.'
            : 'Understood. Log cancelled. You can start a new log anytime.'
          agentSpeak({ text: msg, id: `cancel_${Date.now()}` }, () => {
            processingAnswerRef.current = false
          })
        } else {
          const retry = lang === 'ta-IN'
            ? `புரியவில்லை. இதை Proof-ல் post செய்ய 'yes, post it' அல்லது 'சரி போஸ்ட் பண்ணு' என்று சொல்லவும்.`
            : `I didn't quite catch that. Say "yes, post it" to confirm, or click Post to Proof.`
          agentSpeak({ text: retry, id: `retry_${Date.now()}` }, () => {
            processingAnswerRef.current = false
            setConfirming()
            startListening()
          })
        }
      }
    } catch (err) {
      console.error('[SpeakLog] handleStudentAnswer error:', err)
      processingAnswerRef.current = false
    }
  }, [lang, agentSpeak, startListening, setConfirming])

  // Keep the ref current so onTranscript closure is never stale
  useEffect(() => { handleStudentAnswerRef.current = handleStudentAnswer }, [handleStudentAnswer])

  /* ── Mic Tap Handler ── */
  function handleMicTap() {
    if (convPhase === PHASES.DONE) return

    if (voiceState === VOICE_STATE.LISTENING) {
      stopListening()
      return
    }
    if (voiceState === VOICE_STATE.SPEAKING) {
      cancelSpeech()
      startListening()
      return
    }
    if (convPhase === PHASES.INTRO || !timerOn) {
      setTimerOn(true)
      const introId = `intro_${Date.now()}`
      agentSpeak({ text: QUESTIONS[lang][PHASES.INTRO], id: introId }, () => {
        setConvPhase(PHASES.WHAT_TRIED)
        startListening()
      })
      return
    }
    startListening()
  }

  /* ── Reset / Start New Session ── */
  function handleReset() {
    cancelSpeech()
    stopListening()
    clearInterval(timerRef.current)
    resetDuplicateGuard()
    processingAnswerRef.current = false
    requestIdRef.current += 1

    setConvPhase(PHASES.INTRO)
    setTimeLeft(TOTAL_SECONDS)
    setTimerOn(false)
    setLines([])
    setSaveError('')
    setIsSaving(false)
    setFollowUpQ1('')
    setFollowUpQ2('')
    setFollowUpQ3('')
    setSavedResult(null)
    setAnalysis(null)
    setIsAnalyzing(false)
    setAnalysisError('')
    setIsRetryingProof(false)
    setLog({ tried: '', triedFollowUp: '', broke: '', brokeFollowUp: '', why: '', whyFollowUp: '' })
  }

  /* ── Current question display text ── */
  let currentTitle = ''
  switch (convPhase) {
    case PHASES.INTRO:      currentTitle = lang === 'ta-IN' ? 'SpeakLog-க்கு வரவேற்கிறோம்' : 'Welcome to SpeakLog'; break
    case PHASES.WHAT_TRIED: currentTitle = QUESTIONS[lang][PHASES.WHAT_TRIED];  break
    case PHASES.FOLLOWUP_1: currentTitle = followUpQ1 || '...';                  break
    case PHASES.WHAT_BROKE: currentTitle = QUESTIONS[lang][PHASES.WHAT_BROKE];  break
    case PHASES.FOLLOWUP_2: currentTitle = followUpQ2 || '...';                  break
    case PHASES.WHY:        currentTitle = QUESTIONS[lang][PHASES.WHY];          break
    case PHASES.FOLLOWUP_3: currentTitle = followUpQ3 || '...';                  break
    case PHASES.CONFIRM:    currentTitle = lang === 'ta-IN' ? 'உங்கள் Log-ஐ சரிபார்க்கவும்' : 'Your Daily Log'; break
    case PHASES.DONE:       currentTitle = lang === 'ta-IN' ? 'நன்றி! பதிவு முடிந்தது' : 'Session Complete'; break
    default: break
  }

  let currentResponseSnippet = interim
  if (!currentResponseSnippet) {
    switch (convPhase) {
      case PHASES.WHAT_TRIED:  currentResponseSnippet = log.tried;                     break
      case PHASES.FOLLOWUP_1:  currentResponseSnippet = log.triedFollowUp || log.tried; break
      case PHASES.WHAT_BROKE:  currentResponseSnippet = log.broke;                     break
      case PHASES.FOLLOWUP_2:  currentResponseSnippet = log.brokeFollowUp || log.broke; break
      case PHASES.WHY:         currentResponseSnippet = log.why;                       break
      case PHASES.FOLLOWUP_3:  currentResponseSnippet = log.whyFollowUp || log.why;    break
      default: break
    }
  }

  /* ════════════════════════════════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════════════════════════════ */
  return (
    <div className="sl-bg">
      <div className="sl-card">

        {/* ── 1. BEFORE STARTING ────────────────────────────────────────── */}
        {isBeforeStart && (
          <div>
            <div className="sl-topbar">
              <div className="sl-brand">
                <div className="sl-logo"><i className="bi bi-mic-fill" /></div>
                <span className="sl-brand-name">SpeakLog</span>
              </div>
              <div className="d-flex align-items-center gap-2">
                <div className="sl-lang-toggle" role="group" aria-label="Language selection">
                  <button id="lang-ta" className={`sl-lang-btn ${lang === 'ta-IN' ? 'active' : ''}`}
                    onClick={() => handleLanguageChange('ta-IN')} title="தமிழ் (Tamil)">தமிழ்</button>
                  <button id="lang-en" className={`sl-lang-btn ${lang === 'en-IN' ? 'active' : ''}`}
                    onClick={() => handleLanguageChange('en-IN')} title="English">English</button>
                </div>
                <div className="sl-timer" title="Session limit: 2 minutes">
                  <i className="bi bi-clock me-1" />02:00
                </div>
              </div>
            </div>

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

            <div className="sl-question-box">
              <div className="sl-q-num">
                {lang === 'ta-IN' ? 'படி 1: மொழியைத் தேர்ந்தெடுத்துத் தொடங்கவும்' : 'STEP 1: CHOOSE LANGUAGE & START'}
              </div>
              <div className="sl-q-main">{lang === 'ta-IN' ? 'SpeakLog-க்கு வரவேற்கிறோம்' : 'Welcome to SpeakLog'}</div>
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

            <div className="sl-mic-zone">
              <button id="mic-btn" className="sl-mic" onClick={handleMicTap} aria-label="Start voice log">
                <i className="bi bi-mic-fill" />
              </button>
              <span className="sl-mic-hint">
                {lang === 'ta-IN' ? 'தொடங்க மைக்ரோஃபோனைத் தட்டவும்' : 'Tap to start voice log'}
              </span>
              <button id="btn-start-log" className="sl-finish-btn" onClick={handleMicTap}
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))', border: 'none', boxShadow: '0 4px 18px var(--accent-glow)', marginTop: '0.2rem' }}>
                <i className="bi bi-play-circle-fill me-1" />Start Voice Log
              </button>
            </div>

            {srError && (
              <div className="sl-error mx-3 mb-2"><i className="bi bi-exclamation-circle me-2" />{srError}</div>
            )}
            {!isSupported && (
              <div className="sl-error mx-3 mb-2">
                <i className="bi bi-exclamation-triangle me-2" />
                {lang === 'ta-IN'
                  ? 'இந்த உலாவியில் பேச்சு அறிதல் கிடைக்கவில்லை. Google Chrome-ஐ பயன்படுத்தவும்.'
                  : 'Speech recognition is not available in this browser. Please open SpeakLog in Google Chrome.'}
              </div>
            )}

            <div className="sl-bottom">
              <div className="sl-transcript">
                <div className="sl-transcript-placeholder">
                  <i className="bi bi-chat-square-text me-2" />
                  {lang === 'ta-IN' ? 'உங்கள் பதில்கள் இங்கு தோன்றும்...' : 'Your verbatim responses will appear here'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── 2. AFTER START ────────────────────────────────────────────── */}
        {isAfterStart && (
          <div>
            <div className="sl-topbar">
              <div className="sl-brand">
                <div className="sl-logo"><i className="bi bi-mic-fill" /></div>
                <span className="sl-brand-name">SpeakLog</span>
              </div>
              <div className="sl-lang-toggle" role="group" aria-label="Language selection">
                <button id="lang-ta" className={`sl-lang-btn ${lang === 'ta-IN' ? 'active' : ''}`}
                  onClick={() => handleLanguageChange('ta-IN')}
                  disabled={voiceState === VOICE_STATE.LISTENING || voiceState === VOICE_STATE.SPEAKING || voiceState === VOICE_STATE.PROCESSING}
                  title="தமிழ் (Tamil)">தமிழ்</button>
                <button id="lang-en" className={`sl-lang-btn ${lang === 'en-IN' ? 'active' : ''}`}
                  onClick={() => handleLanguageChange('en-IN')}
                  disabled={voiceState === VOICE_STATE.LISTENING || voiceState === VOICE_STATE.SPEAKING || voiceState === VOICE_STATE.PROCESSING}
                  title="English">English</button>
              </div>
            </div>

            <div className="sl-after-start-body">
              <div className={`sl-timer-counter ${timerDanger ? 'danger' : timerWarning ? 'warning' : ''}`}>
                <i className="bi bi-clock me-1" /><span>{fmtTimerDisplay(timeLeft)}</span>
              </div>

              {/* Status pill — driven purely by VOICE_STATE */}
              <div className={`sl-status-pill ${phase}`}>
                {voiceState === VOICE_STATE.LISTENING ? (
                  <><i className="bi bi-broadcast" /><span>🎙️ Listening</span></>
                ) : voiceState === VOICE_STATE.SPEAKING ? (
                  <><i className="bi bi-volume-up-fill" /><span>🔊 Speaking...</span></>
                ) : voiceState === VOICE_STATE.PROCESSING ? (
                  <><i className="bi bi-stars sl-spin" /><span>✨ AI Follow-up...</span></>
                ) : (
                  <><i className="bi bi-mic" /><span>🎙️ Ready</span></>
                )}
              </div>

              <div className="sl-mic-zone" style={{ padding: '0.2rem 0' }}>
                <button
                  id="mic-btn"
                  className={`sl-mic ${voiceState === VOICE_STATE.LISTENING ? 'active' : voiceState === VOICE_STATE.SPEAKING ? 'agent' : ''}`}
                  onClick={handleMicTap}
                  disabled={voiceState === VOICE_STATE.PROCESSING || isSaving}
                  aria-label={voiceState === VOICE_STATE.LISTENING ? 'Stop speaking' : 'Start speaking'}
                >
                  {voiceState === VOICE_STATE.LISTENING   ? <i className="bi bi-stop-fill" />
                   : voiceState === VOICE_STATE.SPEAKING  ? <i className="bi bi-volume-up-fill" />
                   : voiceState === VOICE_STATE.PROCESSING ? <i className="bi bi-arrow-repeat sl-spin" />
                   : <i className="bi bi-mic-fill" />}
                </button>

                {voiceState === VOICE_STATE.LISTENING && (
                  <div className="sl-wave" aria-hidden="true">
                    {[...Array(9)].map((_, i) => <span key={i} />)}
                  </div>
                )}

                {voiceState === VOICE_STATE.LISTENING && (
                  <span className="sl-mic-hint" style={{ color: '#fca5a5', fontSize: '0.76rem', marginTop: '0.25rem' }}>
                    {lang === 'ta-IN'
                      ? '2 விநாடி அமைதி → தானாக அடுத்த கேள்வி · ■ அழுத்தி உடனே முடிக்கலாம்'
                      : '2s silence → auto-proceeds · Click ■ to finish now'}
                  </span>
                )}
              </div>

              <div className="sl-speech-quote">{`"${currentTitle}"`}</div>

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

              {srError && (
                <div className="sl-error mx-3 mb-2" style={{ width: '100%' }}>
                  <i className="bi bi-exclamation-circle me-2" />{srError}
                </div>
              )}

              <div style={{ marginTop: '0.4rem' }}>
                <button id="btn-finish-log" className="sl-finish-btn" onClick={handleFinishLog}>
                  <i className="bi bi-check2-all me-1" />Finish Log
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── 3. CONFIRM & DONE ─────────────────────────────────────────── */}
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

            <div className="sl-verbatim-container">
              <div className="sl-verbatim-card">
                <div className="sl-verbatim-tag tried">
                  <i className="bi bi-lightning-charge-fill me-1" /> What I worked on
                </div>
                <div className={`sl-verbatim-text ${!log.tried ? 'empty' : ''}`}>
                  {log.tried || 'No response recorded'}
                  {log.triedFollowUp && (
                    <div className="sl-verbatim-sub"><strong>Follow-up:</strong> {log.triedFollowUp}</div>
                  )}
                </div>
              </div>

              <div className="sl-verbatim-card">
                <div className="sl-verbatim-tag broke">
                  <i className="bi bi-exclamation-triangle-fill me-1" /> What broke
                </div>
                <div className={`sl-verbatim-text ${!log.broke ? 'empty' : ''}`}>
                  {log.broke || 'No response recorded'}
                  {log.brokeFollowUp && (
                    <div className="sl-verbatim-sub"><strong>Follow-up:</strong> {log.brokeFollowUp}</div>
                  )}
                </div>
              </div>

              <div className="sl-verbatim-card">
                <div className="sl-verbatim-tag why">
                  <i className="bi bi-lightbulb-fill me-1" /> Why
                </div>
                <div className={`sl-verbatim-text ${!log.why ? 'empty' : ''}`}>
                  {log.why || 'No response recorded'}
                  {log.whyFollowUp && (
                    <div className="sl-verbatim-sub"><strong>Follow-up:</strong> {log.whyFollowUp}</div>
                  )}
                </div>
              </div>

              {convPhase === PHASES.CONFIRM && (
                <>
                  <p className="sl-confirm-hint">
                    <i className="bi bi-mic-fill" />
                    {lang === 'ta-IN'
                      ? '"சரி போஸ்ட் பண்ணு" அல்லது "yes, post it" என்று கூறவும்'
                      : 'Say "yes, post it" to confirm by voice'}
                  </p>
                  <div className="sl-confirm-actions">
                    <button id="btn-cancel-log" className="sl-cancel-btn" onClick={handleReset} disabled={isSaving}>
                      <i className="bi bi-x-circle" />
                      {lang === 'ta-IN' ? 'ரத்து' : 'Cancel'}
                    </button>
                    <button id="btn-save-log" className="sl-save-btn" onClick={triggerSaveLog} disabled={isSaving}>
                      <i className={`bi ${isSaving ? 'bi-arrow-repeat sl-spin' : 'bi-cloud-arrow-up-fill'}`} />
                      {isSaving
                        ? (lang === 'ta-IN' ? 'பதிவிடுகிறது...' : 'Posting...')
                        : (lang === 'ta-IN' ? 'Proof-ல் Post செய்' : 'Post to Proof')}
                    </button>
                  </div>
                </>
              )}
            </div>

            {saveError && (
              <div className="sl-error mt-3">
                <i className="bi bi-exclamation-triangle me-2" />Save error: {saveError}
              </div>
            )}

            {savedResult && (
              <div className="sl-save-card">
                <div className="sl-save-title">
                  <i className="bi bi-check-circle-fill text-success" /> ✓ Log saved successfully
                </div>
                <div className="sl-save-id">Log ID: {savedResult.id}</div>
                <div className="sl-proof-row">
                  {savedResult.proofSubmitted ? (
                    <div className="d-flex align-items-center gap-2 flex-wrap">
                      <span className="sl-proof-badge success">
                        <i className="bi bi-patch-check-fill" /> ✓ Submitted successfully to Proof
                      </span>
                      {savedResult.proofUrl && (
                        <a
                          href={savedResult.proofUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="sl-proof-link"
                          style={{ fontSize: '0.8rem', color: '#60a5fa', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                        >
                          View on Proof <i className="bi bi-box-arrow-up-right" style={{ fontSize: '0.7rem' }} />
                        </a>
                      )}
                    </div>
                  ) : (
                    <>
                      <span className="sl-proof-badge warning">
                        <i className="bi bi-exclamation-triangle-fill" /> ⚠ Log created, but submission failed.
                      </span>
                      <button className="sl-proof-retry-btn" onClick={handleRetryProof}
                        disabled={isRetryingProof} title="Retry submission to Proof">
                        <i className={`bi bi-arrow-clockwise ${isRetryingProof ? 'sl-spin' : ''}`} />
                        {isRetryingProof ? 'Retrying…' : 'Retry'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {savedResult && (
              <div className="sl-analysis-box">
                <div className="sl-analysis-header">
                  <div className="sl-analysis-title">
                    <i className="bi bi-robot text-primary" /><span>AI Mentor Analysis</span>
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    <span className={`sl-analysis-badge ${analysis?.source === 'openai' ? 'openai' : ''}`}>
                      {analysis?.source === 'openai' ? 'GPT-4o-mini' : 'Smart Heuristic'}
                    </span>
                    <button className="sl-icon-btn"
                      style={{ width: '28px', height: '28px', fontSize: '0.8rem' }}
                      onClick={() => runAnalysis(log, savedResult.id)} title="Re-analyze" disabled={isAnalyzing}>
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
                      <div className="sl-analysis-sec-title"><i className="bi bi-journal-text" /> Today's Focus</div>
                      <p className="sl-analysis-sec-content">{analysis.summary}</p>
                    </div>
                    {analysis.blockerAnalysis && analysis.blockerAnalysis !== 'N/A' && (
                      <div className="sl-analysis-section">
                        <div className="sl-analysis-sec-title"><i className="bi bi-bug" /> Blocker & Root Cause</div>
                        <p className="sl-analysis-sec-content blocker">{analysis.blockerAnalysis}</p>
                      </div>
                    )}
                    {analysis.keyLearnings && analysis.keyLearnings !== 'N/A' && (
                      <div className="sl-analysis-section">
                        <div className="sl-analysis-sec-title"><i className="bi bi-lightbulb" /> Key Takeaway</div>
                        <p className="sl-analysis-sec-content">{analysis.keyLearnings}</p>
                      </div>
                    )}
                    {Array.isArray(analysis.nextSteps) && analysis.nextSteps.length > 0 && (
                      <div className="sl-analysis-section">
                        <div className="sl-analysis-sec-title"><i className="bi bi-check2-circle" /> Recommended Next Steps</div>
                        <ul className="sl-analysis-steps">
                          {analysis.nextSteps.map((s, idx) => (
                            <li key={idx} className="sl-analysis-step-item">
                              <i className="bi bi-arrow-right-short" /><span>{s}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {Array.isArray(analysis.tags) && analysis.tags.length > 0 && (
                      <div className="sl-analysis-section">
                        <div className="sl-analysis-sec-title"><i className="bi bi-tags" /> Skill & Tech Tags</div>
                        <div className="sl-analysis-tags-wrap">
                          {analysis.tags.map((tag, idx) => (
                            <span key={idx} className="sl-analysis-tag">#{tag}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {analysis.feedback && (
                      <div className="sl-analysis-feedback">"{analysis.feedback}"</div>
                    )}
                  </div>
                ) : analysisError ? (
                  <div className="sl-error">
                    <i className="bi bi-exclamation-triangle me-2" />{analysisError}
                    <div className="mt-2">
                      <button className="sl-analysis-btn" onClick={() => runAnalysis(log, savedResult.id)}>Try Again</button>
                    </div>
                  </div>
                ) : (
                  <button className="sl-analysis-btn" onClick={() => runAnalysis(log, savedResult.id)}>
                    <i className="bi bi-stars" /> Generate AI Insights
                  </button>
                )}
              </div>
            )}

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
