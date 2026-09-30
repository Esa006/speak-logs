import { useState, useEffect, useCallback, useRef } from 'react'
import { useSpeechRecognition }  from '../../hooks/useSpeechRecognition'
import { useSpeechSynthesis }    from '../../hooks/useSpeechSynthesis'
import {
  PHASES, QUESTIONS, buildFollowUp,
  formatLog, isConfirmation, isCancellation,
} from '../../utils/conversationFlow'
import { saveLog as postLog } from '../../utils/logService'
import MicButton      from './MicButton'
import TranscriptView from './TranscriptView'
import LogPreview     from './LogPreview'
import StatusBadge    from './StatusBadge'
import LanguageToggle from './LanguageToggle'
import styles from './VoiceAgent.module.css'

const PHASE_ORDER = [
  PHASES.INTRO,
  PHASES.WHAT_TRIED,
  PHASES.FOLLOWUP_1,
  PHASES.WHAT_BROKE,
  PHASES.FOLLOWUP_2,
  PHASES.WHY,
  PHASES.FOLLOWUP_3,
  PHASES.CONFIRM,
  PHASES.DONE,
]

export default function VoiceAgent() {
  const [lang, setLang]           = useState('en-IN')
  const [phase, setPhase]         = useState(PHASES.INTRO)
  const [log, setLog]             = useState({ tried: '', broke: '', why: '' })
  const [messages, setMessages]   = useState([])   // chat transcript
  const [agentBusy, setAgentBusy] = useState(false)
  const [posted, setPosted]       = useState(null)  // null | {ok, id}
  const [postError, setPostError] = useState(null)
  const answerRef = useRef('')       // latest student answer before follow-up

  const addMessage = useCallback((role, text) => {
    setMessages(prev => [...prev, { role, text, ts: Date.now() }])
  }, [])

  /* ── Speech synthesis ── */
  const { speak, cancel } = useSpeechSynthesis()

  const agentSay = useCallback((text, afterSpeak) => {
    addMessage('agent', text)
    setAgentBusy(true)
    speak({
      text,
      lang,
      onEnd: () => {
        setAgentBusy(false)
        if (afterSpeak) afterSpeak()
      },
    })
  }, [addMessage, speak, lang])

  /* ── Speech recognition ── */
  const handleResult = useCallback((transcript) => {
    addMessage('student', transcript)
    answerRef.current = transcript
  }, [addMessage])

  const { isListening, interimText, error: srError, isSupported, start, stop } =
    useSpeechRecognition({ lang, onResult: handleResult, onEnd: handlePhaseAdvance })

  /* ── Phase advance logic ── */
  function handlePhaseAdvance() {
    const answer = answerRef.current
    if (!answer) return  // no speech detected — wait

    switch (phase) {
      case PHASES.WHAT_TRIED:
        setLog(l => ({ ...l, tried: answer }))
        answerRef.current = ''
        setPhase(PHASES.FOLLOWUP_1)
        break

      case PHASES.FOLLOWUP_1:
        setPhase(PHASES.WHAT_BROKE)
        break

      case PHASES.WHAT_BROKE:
        setLog(l => ({ ...l, broke: answer }))
        answerRef.current = ''
        setPhase(PHASES.FOLLOWUP_2)
        break

      case PHASES.FOLLOWUP_2:
        setPhase(PHASES.WHY)
        break

      case PHASES.WHY:
        setLog(l => ({ ...l, why: answer }))
        answerRef.current = ''
        setPhase(PHASES.FOLLOWUP_3)
        break

      case PHASES.FOLLOWUP_3:
        setPhase(PHASES.CONFIRM)
        break

      case PHASES.CONFIRM:
        if (isConfirmation(answer)) {
          handlePost()
        } else if (isCancellation(answer)) {
          addMessage('agent', 'No problem. Log cancelled. Refresh to start over.')
          setPhase(PHASES.DONE)
        } else {
          agentSay("Sorry, I didn't catch that. Say 'yes, post it' to confirm or 'no' to cancel.", () => startListening())
        }
        break

      default:
        break
    }
  }

  /* ── Drive agent speech per phase ── */
  useEffect(() => {
    switch (phase) {
      case PHASES.INTRO:
        agentSay(QUESTIONS[PHASES.INTRO], () => {
          setPhase(PHASES.WHAT_TRIED)
        })
        break

      case PHASES.WHAT_TRIED:
        agentSay(QUESTIONS[PHASES.WHAT_TRIED], () => startListening())
        break

      case PHASES.FOLLOWUP_1:
        agentSay(buildFollowUp(PHASES.FOLLOWUP_1, log.tried || ''), () => startListening())
        break

      case PHASES.WHAT_BROKE:
        agentSay(QUESTIONS[PHASES.WHAT_BROKE], () => startListening())
        break

      case PHASES.FOLLOWUP_2:
        agentSay(buildFollowUp(PHASES.FOLLOWUP_2, log.broke || ''), () => startListening())
        break

      case PHASES.WHY:
        agentSay(QUESTIONS[PHASES.WHY], () => startListening())
        break

      case PHASES.FOLLOWUP_3:
        agentSay(buildFollowUp(PHASES.FOLLOWUP_3, log.why || ''), () => startListening())
        break

      case PHASES.CONFIRM: {
        const confirmText = typeof QUESTIONS[PHASES.CONFIRM] === 'function'
          ? QUESTIONS[PHASES.CONFIRM](log)
          : QUESTIONS[PHASES.CONFIRM]
        agentSay(confirmText, () => startListening())
        break
      }

      default:
        break
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  function startListening() {
    answerRef.current = ''
    start()
  }

  async function handlePost() {
    setPhase(PHASES.DONE)
    agentSay('Great! Saving your log now…')
    try {
      const result = await postLog({ ...log, language: lang })
      setPosted(result)
      addMessage('agent', `✅ Log saved successfully! (id: ${result.id})`)
    } catch (err) {
      setPostError(err.message)
      addMessage('agent', `❌ Failed to save: ${err.message}`)
    }
  }

  const isDone = phase === PHASES.DONE

  return (
    <div className={styles.container}>
      {/* Top bar */}
      <div className={`${styles.topBar} d-flex align-items-center justify-content-between flex-wrap gap-2`}>
        <StatusBadge phase={phase} isListening={isListening} agentBusy={agentBusy} />
        <LanguageToggle lang={lang} onChange={setLang} disabled={phase !== PHASES.INTRO && phase !== PHASES.DONE} />
      </div>

      {/* Not supported warning */}
      {!isSupported && (
        <div className="alert alert-warning mt-3" role="alert">
          <i className="bi bi-exclamation-triangle me-2" />
          Web Speech API is not available. Please open this app in <strong>Google Chrome</strong>.
        </div>
      )}

      {/* Speech recognition error */}
      {srError && (
        <div className="alert alert-danger mt-3" role="alert">
          <i className="bi bi-bug me-2" />{srError}
        </div>
      )}

      {/* Conversation transcript */}
      <TranscriptView messages={messages} interimText={interimText} isListening={isListening} />

      {/* Mic button — shown while a question is active */}
      {!isDone && !agentBusy && (
        <MicButton
          isListening={isListening}
          onStart={startListening}
          onStop={stop}
          disabled={agentBusy || !isSupported}
        />
      )}

      {/* Log preview after CONFIRM phase or when DONE */}
      {(phase === PHASES.CONFIRM || phase === PHASES.DONE) && (
        <LogPreview log={log} posted={posted} postError={postError} />
      )}

      {/* Restart button */}
      {isDone && (
        <div className="text-center mt-4">
          <button
            className={`btn ${styles.restartBtn}`}
            onClick={() => window.location.reload()}
          >
            <i className="bi bi-arrow-counterclockwise me-2" />
            Start a new log
          </button>
        </div>
      )}
    </div>
  )
}
