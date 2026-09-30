import { useEffect, useRef } from 'react'
import styles from './TranscriptView.module.css'

export default function TranscriptView({ messages, interimText, isListening }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, interimText])

  return (
    <div className={styles.transcript} id="transcript-view" aria-live="polite" aria-label="Conversation transcript">
      {messages.length === 0 && (
        <p className={styles.empty}>Your conversation will appear here…</p>
      )}

      {messages.map((msg) => (
        <div
          key={msg.ts}
          className={`${styles.bubble} ${styles[msg.role]} fade-in-up`}
        >
          <span className={styles.roleLabel}>
            {msg.role === 'agent' ? '🤖 Agent' : '🎙️ You'}
          </span>
          <p className={styles.text}>{msg.text}</p>
        </div>
      ))}

      {/* Interim (real-time) text while speaking */}
      {isListening && interimText && (
        <div className={`${styles.bubble} ${styles.student} ${styles.interim}`}>
          <span className={styles.roleLabel}>🎙️ You (live)</span>
          <p className={styles.text}>{interimText}</p>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}
