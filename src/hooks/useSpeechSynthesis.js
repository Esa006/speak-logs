/**
 * useSpeechSynthesis
 * Wraps the browser speechSynthesis API so the agent can speak.
 */
import { useCallback, useRef } from 'react'

export function useSpeechSynthesis() {
  const utteranceRef = useRef(null)

  const isSupported =
    typeof window !== 'undefined' && 'speechSynthesis' in window

  /**
   * speak(text, options)
   * @param {string} text       - Text for the agent to say
   * @param {object} options
   * @param {string} options.lang   - BCP-47 language tag, default 'en-IN'
   * @param {number} options.rate   - Speed (0.1 – 10), default 0.95
   * @param {number} options.pitch  - Pitch (0 – 2), default 1
   * @param {Function} options.onEnd - Callback after speech ends
   */
  const speak = useCallback(({ text, lang = 'en-IN', rate = 0.95, pitch = 1, onEnd }) => {
    if (!isSupported) return
    window.speechSynthesis.cancel()

    const utterance      = new SpeechSynthesisUtterance(text)
    utterance.lang       = lang
    utterance.rate       = rate
    utterance.pitch      = pitch
    utterance.onend      = () => { if (onEnd) onEnd() }
    utterance.onerror    = (e) => console.error('SpeechSynthesis error', e)
    utteranceRef.current = utterance
    window.speechSynthesis.speak(utterance)
  }, [isSupported])

  const cancel = useCallback(() => {
    window.speechSynthesis?.cancel()
  }, [])

  return { speak, cancel, isSupported }
}
