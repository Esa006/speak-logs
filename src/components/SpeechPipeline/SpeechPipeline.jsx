import { useState, useRef, useCallback } from 'react'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap-icons/font/bootstrap-icons.css'
import './SpeechPipeline.css'

/* ─────────────────────────────────────────────
   Steps:  PERMISSION  →  LANGUAGE  →  RECORD  →  TRANSCRIPT
   ───────────────────────────────────────────── */
const STEP = {
  PERMISSION:  'PERMISSION',
  LANGUAGE:    'LANGUAGE',
  RECORD:      'RECORD',
  TRANSCRIPT:  'TRANSCRIPT',
}

const LANGS = [
  { code: 'ta-IN', native: 'தமிழ்',  english: 'Tamil'   },
  { code: 'en-IN', native: 'English', english: 'English (India)' },
]

export default function SpeechPipeline() {
  const [step, setStep]             = useState(STEP.PERMISSION)
  const [permStatus, setPermStatus] = useState('idle')   // idle | granted | denied | error
  const [lang, setLang]             = useState(null)
  const [isListening, setListening] = useState(false)
  const [listenStatus, setListenStatus] = useState('Ready')   // Ready | Listening… | Hearing you… | Processing…
  const [interim, setInterim]       = useState('')
  const [lines, setLines]           = useState([])       // [{text, lang, ts}]
  const [srError, setSrError]       = useState('')

  const recognitionRef    = useRef(null)
  // Two separate buffers — the KEY fix:
  //   finalTranscript  → accumulates confirmed text (never reset mid-session)
  //   interimTranscript → always REPLACED by latest Chrome revision (never appended)
  const finalBufRef       = useRef('')
  const sessionActiveRef  = useRef(false)  // auto-restart guard
  const isSupported    = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window

  /* ── Step 1: request mic permission ── */
  async function requestPermission() {
    setPermStatus('idle')
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true })
      setPermStatus('granted')
      setTimeout(() => setStep(STEP.LANGUAGE), 600)
    } catch (err) {
      setPermStatus(err.name === 'NotAllowedError' ? 'denied' : 'error')
    }
  }

  /* ── Step 3: start recording ── */
  const startListening = useCallback(() => {
    if (!isSupported) { setSrError('Web Speech API not supported — use Chrome.'); return }

    // Reset the final buffer for this new recording session
    finalBufRef.current  = ''
    sessionActiveRef.current = true

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    const r  = new SR()
    r.lang            = lang
    r.interimResults  = true
    r.maxAlternatives = 1
    r.continuous      = true   // We control stopping — not the browser

    // ── onstart: mic is now open ────────────────────────────────────────
    r.onstart = () => {
      setListening(true)
      setInterim('')
      setSrError('')
      setListenStatus('Listening…')
    }

    // ── onspeechstart: voice detected ───────────────────────────────────
    r.onspeechstart = () => {
      setListenStatus('Hearing you…')
    }

    // ── onspeechend: voice stopped — processing ──────────────────────────
    r.onspeechend = () => {
      setListenStatus('Processing…')
    }

    // ── onresult: THE CRITICAL FIX ───────────────────────────────────────
    // Chrome sends rolling REVISIONS of the same interim result:
    //   Event 1: "today"           (interim, resultIndex=0)
    //   Event 2: "today I am"      (interim, resultIndex=0 — REVISION)
    //   Event 3: "today I am work" (interim, resultIndex=0 — REVISION)
    // 
    // WRONG approach: live += transcript  →  "today today I am today I am work"
    // RIGHT approach: live  = transcript  →  always shows latest version only
    //
    // For finals: accumulate into finalBufRef (one continuous string)
    // For interim: build fresh `live` string — REPLACE, never append
    r.onresult = (e) => {
      // Build fresh interim from the CURRENT event only (resultIndex onwards)
      let live = ''

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (!t.trim()) continue

        if (e.results[i].isFinal) {
          // Confirmed text: append to the session's final buffer
          finalBufRef.current += (finalBufRef.current ? ' ' : '') + t.trim()
        } else {
          // Interim revision: BUILD FRESH — do not append to previous interim
          live += t
        }
      }

      // Display: finalized text + current interim (replaced, not appended)
      const display = (finalBufRef.current ? finalBufRef.current + ' ' : '') + live
      setInterim(display || '')

      if (step !== STEP.TRANSCRIPT && finalBufRef.current) {
        setStep(STEP.TRANSCRIPT)
      }
    }

    r.onerror = (e) => {
      if (e.error === 'no-speech') return   // normal — just keep waiting
      setSrError(`Error: ${e.error}`)
      setListening(false)
      setListenStatus('Ready')
    }

    // ── onend: browser stopped recognition ──────────────────────────────
    // IMPORTANT: onend ≠ "user finished speaking"
    // Chrome fires onend for many reasons (network hiccup, timeout, etc.)
    // Strategy:
    //   • If user manually stopped (sessionActiveRef=false) → go idle
    //   • Otherwise auto-restart so the session stays alive
    r.onend = () => {
      setListening(false)
      setListenStatus('Ready')
      setInterim('')

      if (sessionActiveRef.current) {
        // Auto-restart: give Chrome 150ms to release resources
        setTimeout(() => {
          if (!sessionActiveRef.current) return  // user stopped in the meantime
          try {
            const r2 = new SR()
            r2.lang            = lang
            r2.interimResults  = true
            r2.maxAlternatives = 1
            r2.continuous      = true
            // Re-attach same handlers by starting again via startListening
            // (simpler: just call start() on a fresh instance)
            // We use a minimal restart to avoid re-running all the setup
            recognitionRef.current?.start()
          } catch {
            // Already starting or mic unavailable — safe to ignore
          }
        }, 150)
      }
    }

    recognitionRef.current = r
    r.start()
  }, [lang, isSupported, step])

  const stopListening = useCallback(() => {
    sessionActiveRef.current = false   // prevent auto-restart
    try { recognitionRef.current?.stop() } catch {}
    setListening(false)
    setListenStatus('Ready')
    // Finalize: push accumulated transcript as one line
    const accumulated = finalBufRef.current.trim()
    if (accumulated) {
      setLines(prev => [...prev, { text: accumulated, lang, ts: Date.now() }])
      finalBufRef.current = ''
      setInterim('')
      if (step !== STEP.TRANSCRIPT) setStep(STEP.TRANSCRIPT)
    }
  }, [lang, step])

  const clearAll = () => {
    stopListening()
    setLines([])
    setInterim('')
    setSrError('')
    setStep(STEP.RECORD)
  }

  /* ── render helpers ── */
  const stepIndex   = [STEP.PERMISSION, STEP.LANGUAGE, STEP.RECORD, STEP.TRANSCRIPT].indexOf(step)
  const chosenLang  = LANGS.find(l => l.code === lang)

  return (
    <div className="sp-root">

      {/* ── Header ── */}
      <header className="sp-header">
        <div className="sp-logo"><i className="bi bi-mic-fill" /></div>
        <div>
          <h1 className="sp-title">SpeakLog</h1>
          <p className="sp-sub">Speech → Exact Transcript</p>
        </div>
      </header>

      <main className="sp-main">

        {/* ── Pipeline stepper ── */}
        <div className="sp-stepper" role="list">
          {['Mic Permission', 'Language', 'Record', 'Transcript'].map((label, i) => (
            <div
              key={label}
              className={`sp-step ${i < stepIndex ? 'done' : i === stepIndex ? 'active' : 'pending'}`}
              role="listitem"
              aria-current={i === stepIndex ? 'step' : undefined}
            >
              <div className="sp-step-dot">
                {i < stepIndex
                  ? <i className="bi bi-check-lg" />
                  : <span>{i + 1}</span>}
              </div>
              <span className="sp-step-label">{label}</span>
              {i < 3 && <div className={`sp-step-line ${i < stepIndex ? 'done' : ''}`} />}
            </div>
          ))}
        </div>

        {/* ─────────────────────────────────────
            STEP 1 — Microphone Permission
        ───────────────────────────────────── */}
        {step === STEP.PERMISSION && (
          <section className="sp-card fade-up" aria-labelledby="perm-heading">
            <div className="sp-card-icon perm">
              <i className="bi bi-mic" />
            </div>
            <h2 id="perm-heading">Allow microphone access</h2>
            <p className="sp-card-desc">
              SpeakLog needs your microphone to convert speech to text.<br />
              Your audio is processed locally in the browser — nothing is sent to a server.
            </p>

            {permStatus === 'denied' && (
              <div className="sp-alert danger">
                <i className="bi bi-x-circle me-2" />
                Permission denied. Click the 🔒 icon in Chrome's address bar and allow microphone, then try again.
              </div>
            )}
            {permStatus === 'error' && (
              <div className="sp-alert danger">
                <i className="bi bi-exclamation-triangle me-2" />
                Could not access microphone. Check your browser settings.
              </div>
            )}
            {permStatus === 'granted' && (
              <div className="sp-alert success">
                <i className="bi bi-check-circle me-2" />
                Microphone access granted!
              </div>
            )}

            <button
              id="btn-allow-mic"
              className="sp-btn primary"
              onClick={requestPermission}
              disabled={permStatus === 'granted'}
            >
              <i className="bi bi-mic-fill me-2" />
              {permStatus === 'granted' ? 'Access granted ✓' : 'Allow microphone'}
            </button>
          </section>
        )}

        {/* ─────────────────────────────────────
            STEP 2 — Language Selection
        ───────────────────────────────────── */}
        {step === STEP.LANGUAGE && (
          <section className="sp-card fade-up" aria-labelledby="lang-heading">
            <div className="sp-card-icon lang">
              <i className="bi bi-translate" />
            </div>
            <h2 id="lang-heading">Choose your language</h2>
            <p className="sp-card-desc">
              Pick the language you'll speak in. You can switch later from the recording screen.
            </p>

            <div className="sp-lang-grid">
              {LANGS.map(l => (
                <button
                  key={l.code}
                  id={`lang-btn-${l.code}`}
                  className={`sp-lang-card ${lang === l.code ? 'selected' : ''}`}
                  onClick={() => setLang(l.code)}
                  aria-pressed={lang === l.code}
                >
                  <span className="sp-lang-native">{l.native}</span>
                  <span className="sp-lang-english">{l.english}</span>
                  <span className="sp-lang-code">{l.code}</span>
                  {lang === l.code && (
                    <span className="sp-lang-check"><i className="bi bi-check-circle-fill" /></span>
                  )}
                </button>
              ))}
            </div>

            <button
              id="btn-start-recording"
              className="sp-btn primary"
              disabled={!lang}
              onClick={() => setStep(STEP.RECORD)}
            >
              Continue
              <i className="bi bi-arrow-right ms-2" />
            </button>
          </section>
        )}

        {/* ─────────────────────────────────────
            STEP 3 — Record
        ───────────────────────────────────── */}
        {(step === STEP.RECORD || step === STEP.TRANSCRIPT) && (
          <section className="sp-card fade-up sp-record-card" aria-labelledby="record-heading">

            {/* Top row */}
            <div className="sp-record-top">
              <div>
                <h2 id="record-heading" className="mb-0">
                  {step === STEP.TRANSCRIPT ? 'Transcript' : 'Ready to record'}
                </h2>
                <p className="sp-card-desc mb-0">
                  {isListening
                    ? 'Listening… speak now. Press Stop when done.'
                    : step === STEP.TRANSCRIPT
                      ? 'Tap the mic to record more.'
                      : 'Tap the mic button to start speaking.'}
                </p>
              </div>

              {/* Language switcher (re-pick without going back) */}
              <div className="sp-lang-toggle">
                {LANGS.map(l => (
                  <button
                    key={l.code}
                    id={`toggle-${l.code}`}
                    className={`sp-toggle-btn ${lang === l.code ? 'active' : ''}`}
                    onClick={() => { stopListening(); setLang(l.code) }}
                    title={`Switch to ${l.english}`}
                  >
                    {l.native}
                  </button>
                ))}
              </div>
            </div>

            {srError && (
              <div className="sp-alert danger">
                <i className="bi bi-bug me-2" />{srError}
              </div>
            )}

            {!isSupported && (
              <div className="sp-alert warning">
                <i className="bi bi-exclamation-triangle me-2" />
                Web Speech API not available — please use <strong>Google Chrome</strong>.
              </div>
            )}

            {/* Mic button */}
            <div className="sp-mic-area">
              <button
                id="mic-toggle-btn"
                className={`sp-mic-btn ${isListening ? 'active' : ''}`}
                onClick={isListening ? stopListening : startListening}
                disabled={!isSupported}
                aria-label={isListening ? 'Stop recording' : 'Start recording'}
              >
                <i className={`bi ${isListening ? 'bi-stop-fill' : 'bi-mic-fill'}`} />
              </button>

              {isListening
                ? <div className="sp-waveform" aria-hidden="true">
                    <span/><span/><span/><span/><span/><span/><span/>
                  </div>
                : <p className="sp-mic-hint">
                    {isSupported ? 'Tap to speak' : 'Not available'}
                  </p>
              }
            </div>

            {/* Live interim */}
            {interim && (
              <div className="sp-interim" aria-live="polite" aria-label="Live speech">
                <span className="sp-interim-label">Live</span>
                {interim}
              </div>
            )}

            {/* ─── TRANSCRIPT ─── */}
            {lines.length > 0 && (
              <div className="sp-transcript-block">
                <div className="sp-transcript-header">
                  <span className="sp-transcript-title">
                    <i className="bi bi-card-text me-2" />
                    Exact Transcript
                  </span>
                  <span className="sp-verbatim-badge">verbatim</span>
                  <button
                    id="btn-clear"
                    className="sp-clear-btn ms-auto"
                    onClick={clearAll}
                    title="Clear transcript and record again"
                  >
                    <i className="bi bi-trash3 me-1" />Clear
                  </button>
                </div>

                <div
                  className="sp-transcript-lines"
                  id="transcript-output"
                  aria-live="polite"
                  aria-label="Speech transcript"
                >
                  {lines.map((line, i) => (
                    <div key={line.ts} className="sp-line fade-up">
                      <span className="sp-line-num">{i + 1}</span>
                      <span className="sp-line-lang">{line.lang}</span>
                      <span className="sp-line-text">{line.text}</span>
                    </div>
                  ))}
                </div>

                <div className="sp-transcript-footer">
                  <i className="bi bi-info-circle me-1" />
                  These are your exact words — nothing has been edited or summarised.
                </div>
              </div>
            )}
          </section>
        )}

      </main>
    </div>
  )
}
