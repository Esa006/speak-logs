import { useState } from 'react'
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition'
import styles from './TamilTest.module.css'

/**
 * TamilTest page
 * ──────────────
 * Quick standalone test for Web Speech API with ta-IN.
 * Documents recognition quality, errors, and latency — part of the dev log.
 * Mount this page by temporarily replacing <VoiceAgent /> in App.jsx.
 */
export default function TamilTest() {
  const [results, setResults] = useState([])
  const [log, setLog]         = useState([])

  const addLog = (msg) =>
    setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`])

  const handleResult = (text) => {
    setResults(prev => [...prev, text])
    addLog(`✅ Recognised: "${text}"`)
  }

  const { isListening, interimText, error, isSupported, start, stop } =
    useSpeechRecognition({
      lang: 'ta-IN',
      onResult: handleResult,
      onEnd: () => addLog('🔴 Recognition ended'),
    })

  function handleStart() {
    addLog('🎙️ Started listening (ta-IN)')
    start()
  }

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>Tamil Speech Recognition Test</h2>
      <p className={styles.sub}>
        Testing <code>ta-IN</code> via Web Speech API in Chrome.<br />
        Results and errors are logged below for the dev diary.
      </p>

      {!isSupported && (
        <div className="alert alert-warning">
          <strong>Not supported.</strong> Please open in Google Chrome.
        </div>
      )}

      {error && (
        <div className="alert alert-danger">{error}</div>
      )}

      <div className="d-flex gap-3 mb-4">
        <button
          id="tamil-start-btn"
          className={`btn ${styles.startBtn}`}
          onClick={handleStart}
          disabled={isListening || !isSupported}
        >
          <i className="bi bi-mic-fill me-2" />
          {isListening ? 'Listening…' : 'Start Tamil Test'}
        </button>
        <button
          id="tamil-stop-btn"
          className={`btn ${styles.stopBtn}`}
          onClick={stop}
          disabled={!isListening}
        >
          <i className="bi bi-stop-fill me-2" />Stop
        </button>
      </div>

      {interimText && (
        <div className={styles.interim}>
          Live: <em>{interimText}</em>
        </div>
      )}

      <section className={styles.section}>
        <h3>Results</h3>
        {results.length === 0
          ? <p className="text-muted">No results yet. Speak something in Tamil.</p>
          : results.map((r, i) => (
            <div key={i} className={styles.result}>{r}</div>
          ))
        }
      </section>

      <section className={styles.section}>
        <h3>Dev Log</h3>
        <pre className={styles.devLog}>
          {log.join('\n') || '(log is empty)'}
        </pre>
      </section>
    </div>
  )
}
