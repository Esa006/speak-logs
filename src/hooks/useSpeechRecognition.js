import { useRef, useState, useCallback } from 'react'

/**
 * useSpeechRecognition
 * Wraps the browser Web Speech API.
 * Supports both ta-IN (Tamil) and en-IN (English-India).
 */
export function useSpeechRecognition({ lang = 'en-IN', onResult, onEnd } = {}) {
  const recognitionRef = useRef(null)
  const [isListening, setIsListening] = useState(false)
  const [interimText, setInterimText]  = useState('')
  const [error, setError]              = useState(null)

  const isSupported =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

  const start = useCallback(() => {
    if (!isSupported) {
      setError('Web Speech API is not supported in this browser. Please use Chrome.')
      return
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition

    const recognition = new SpeechRecognition()
    recognition.lang              = lang
    recognition.interimResults    = true
    recognition.maxAlternatives   = 1
    recognition.continuous        = false   // one utterance at a time

    recognition.onstart = () => {
      setIsListening(true)
      setInterimText('')
      setError(null)
    }

    recognition.onresult = (event) => {
      let interim = ''
      let final   = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          final += transcript
        } else {
          interim += transcript
        }
      }
      setInterimText(interim)
      if (final && onResult) onResult(final.trim())
    }

    recognition.onerror = (event) => {
      setError(`Speech error: ${event.error}`)
      setIsListening(false)
    }

    recognition.onend = () => {
      setIsListening(false)
      setInterimText('')
      if (onEnd) onEnd()
    }

    recognitionRef.current = recognition
    recognition.start()
  }, [lang, isSupported, onResult, onEnd])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  return { isListening, interimText, error, isSupported, start, stop }
}
