import styles from './MicButton.module.css'

export default function MicButton({ isListening, onStart, onStop, disabled }) {
  return (
    <div className={styles.wrapper}>
      <button
        id="mic-btn"
        className={`${styles.mic} ${isListening ? styles.active : ''}`}
        onClick={isListening ? onStop : onStart}
        disabled={disabled}
        aria-label={isListening ? 'Stop recording' : 'Start recording'}
        title={isListening ? 'Stop' : 'Tap to speak'}
      >
        <i className={`bi ${isListening ? 'bi-stop-fill' : 'bi-mic-fill'}`} />
      </button>

      {isListening && (
        <div className="waveform mt-3">
          <span /><span /><span /><span /><span />
        </div>
      )}

      <p className={styles.hint}>
        {isListening ? 'Listening… speak now' : 'Tap the mic to answer'}
      </p>
    </div>
  )
}
