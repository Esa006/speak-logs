/**
 * useVoicePipeline
 *
 * A production-style voice pipeline for SpeakLog.
 *
 * Architecture:
 *   Microphone
 *     ↓
 *   SpeechRecognition (continuous=true, interimResults=true)
 *     ↓
 *   Collect interim + final transcript
 *     ↓
 *   Silence debounce (SILENCE_MS after last final result)
 *     ↓  User still speaking → reset timer
 *   Finalize ONE transcript
 *     ↓
 *   onTranscript(text) callback  ← app decides what to do
 *     ↓
 *   AI follow-up  →  TTS  →  startListening() again
 *
 * Key guarantees:
 *   1. VOICE_STATE machine — only one state owns the mic at a time.
 *   2. Stale-instance guard — old recognition callbacks are silently ignored.
 *   3. Duplicate-transcript guard — same text is never delivered twice in a row.
 *   4. onend ≠ "user finished" — the app (not the browser) decides completion.
 *   5. TTS generation counter — stale TTS callbacks cannot trigger re-listening.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/* ─────────────────────────────────────────────────────────────────────────
   Voice state machine
   ─────────────────────────────────────────────────────────────────────── */
export const VOICE_STATE = {
  IDLE:        'idle',
  SPEAKING:    'speaking',
  LISTENING:   'listening',
  PROCESSING:  'processing',
  CONFIRMING:  'confirming',
}

/* Silence debounce: ms of quiet after the last final segment before we
   consider the user done speaking. Tune between 2500–4000 for Tamil. */
const SILENCE_MS = 3000

/* ─────────────────────────────────────────────────────────────────────────
   Hook
   ─────────────────────────────────────────────────────────────────────── */
/**
 * @param {object}   opts
 * @param {string}   opts.lang            BCP-47 tag, e.g. 'ta-IN' or 'en-IN'
 * @param {Function} opts.onTranscript    Called with the finalized transcript string
 * @param {Function} [opts.onError]       Called with an error message string
 * @param {Function} [opts.onStateChange] Called whenever voiceState changes
 */
export function useVoicePipeline({ lang, onTranscript, onError, onStateChange } = {}) {
  /* ── Public state ── */
  const [voiceState, _setVoiceState] = useState(VOICE_STATE.IDLE)
  const [interim,    setInterim]     = useState('')
  const [agentText,  setAgentText]   = useState('')
  const [srError,    setSrError]     = useState('')

  /* ── Internal refs ── */
  const recognitionRef     = useRef(null)  // current SR instance
  const lastTranscriptRef  = useRef('')    // duplicate-answer guard
  const ttsGenerationRef   = useRef(0)     // TTS stale-callback guard
  const activeUtterancesRef = useRef(new Set()) // V8 GC protection
  const cachedVoicesRef    = useRef([])
  const langRef            = useRef(lang)
  langRef.current = lang

  // Pre-load and cache voices on mount so they are available synchronously
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const updateVoices = () => {
      const v = window.speechSynthesis.getVoices()
      if (v.length > 0) cachedVoicesRef.current = v
    }
    updateVoices()
    window.speechSynthesis.onvoiceschanged = updateVoices
    return () => {
      if (window.speechSynthesis?.onvoiceschanged === updateVoices) {
        window.speechSynthesis.onvoiceschanged = null
      }
    }
  }, [])

  /* ── State setter that also notifies parent ── */
  const setVoiceState = useCallback((next) => {
    _setVoiceState(next)
    onStateChange?.(next)
  }, [onStateChange])

  /* ── isSupported ── */
  const isSupported =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

  /* ──────────────────────────────────────────────────────────────────────
     stopListening  (public)
     ────────────────────────────────────────────────────────────────────── */
  const stopListening = useCallback(() => {
    try { recognitionRef.current?.stop() } catch {}
  }, [])

  /* ──────────────────────────────────────────────────────────────────────
     startListening  (public)
     ────────────────────────────────────────────────────────────────────── */
  const startListening = useCallback(() => {
    if (!isSupported) {
      const msg = langRef.current === 'ta-IN'
        ? 'இந்த உலாவியில் பேச்சு அறிதல் கிடைக்கவில்லை. Google Chrome-ஐ பயன்படுத்தவும்.'
        : 'Speech recognition is not available in this browser. Please open SpeakLog in Google Chrome.'
      setSrError(msg)
      onError?.(msg)
      return
    }
    setSrError('')
    window.speechSynthesis?.cancel()
    setAgentText('')

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    const r  = new SR()
    r.lang            = langRef.current
    r.interimResults  = true
    r.continuous      = true   // We control stopping — not the browser.
    r.maxAlternatives = 1

    /* Per-session local state */
    let capturedTranscript = ''
    let silenceTimer       = null
    let hasSpeech          = false
    let stoppedManually    = false

    const clearSilenceTimer = () => {
      if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null }
    }

    /**
     * finishListening — the app (not the browser) decides the answer is complete.
     * Triggered by the silence debounce, NOT by onend.
     */
    const finishListening = () => {
      clearSilenceTimer()
      if (recognitionRef.current !== r) return   // stale-instance guard
      stoppedManually = true
      try { r.stop() } catch {}

      const text = capturedTranscript.trim()
      if (!text) { setVoiceState(VOICE_STATE.IDLE); return }

      if (lastTranscriptRef.current === text) {
        console.log('[VoicePipeline] Duplicate transcript ignored:', text)
        setVoiceState(VOICE_STATE.IDLE)
        return
      }
      lastTranscriptRef.current = text
      setVoiceState(VOICE_STATE.PROCESSING)
      onTranscript?.(text)
    }

    /**
     * resetSilenceTimer — called after every final result.
     * Mid-speech interim results clear the timer to protect natural pauses.
     */
    const resetSilenceTimer = () => {
      clearSilenceTimer()
      if (!hasSpeech) return
      silenceTimer = setTimeout(finishListening, SILENCE_MS)
    }

    /* ── Event handlers ── */
    r.onstart = () => {
      if (recognitionRef.current !== r) return
      setVoiceState(VOICE_STATE.LISTENING)
      setInterim('')
    }

    r.onresult = (e) => {
      if (recognitionRef.current !== r) return
      let live = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]
        const t      = result[0].transcript
        if (!t.trim()) continue
        hasSpeech = true
        if (result.isFinal) {
          capturedTranscript += (capturedTranscript ? ' ' : '') + t.trim()
          resetSilenceTimer()
        } else {
          live += t
          // Interim flowing → user is mid-sentence → cancel silence timer.
          clearSilenceTimer()
        }
      }
      setInterim((capturedTranscript ? capturedTranscript + ' ' : '') + live)
    }

    r.onerror = (e) => {
      if (recognitionRef.current !== r) return
      clearSilenceTimer()
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        const msg = langRef.current === 'ta-IN'
          ? 'தயவுசெய்து உங்கள் உலாவியில் மைக்ரோஃபோன் அணுகலை அனுமதிக்கவும்.'
          : 'Please allow microphone access.'
        setSrError(msg)
        onError?.(msg)
      } else if (e.error !== 'no-speech') {
        setSrError(`Microphone notice: ${e.error}`)
      }
      setVoiceState(VOICE_STATE.IDLE)
    }

    r.onend = () => {
      // Guard 1: stale instance — a newer session has taken over.
      if (recognitionRef.current !== r) return
      clearSilenceTimer()
      setInterim('')

      // Guard 2: finishListening() already fired via silence debounce.
      if (stoppedManually) return

      // Browser ended unexpectedly. Deliver transcript once if we have it.
      const text = capturedTranscript.trim()
      if (text) {
        if (lastTranscriptRef.current === text) {
          console.log('[VoicePipeline] Duplicate (onend) ignored:', text)
          setVoiceState(VOICE_STATE.IDLE)
          return
        }
        stoppedManually = true
        lastTranscriptRef.current = text
        setVoiceState(VOICE_STATE.PROCESSING)
        onTranscript?.(text)
      } else {
        setVoiceState(VOICE_STATE.IDLE)
      }
    }

    // Register BEFORE .start() so all callbacks see correct current instance.
    recognitionRef.current = r
    try { r.start() } catch (err) {
      console.warn('[VoicePipeline] start error:', err)
    }
  }, [isSupported, onTranscript, onError, setVoiceState])

  /* ──────────────────────────────────────────────────────────────────────
     agentSpeak  (public)
     ────────────────────────────────────────────────────────────────────── */
  const agentSpeak = useCallback((text, onDone) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      onDone?.()
      return
    }

    ttsGenerationRef.current += 1
    const myGeneration = ttsGenerationRef.current

    // Cancel any ongoing speech and ensure synthesis is unpaused
    window.speechSynthesis.cancel()
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume()
    }

    setAgentText(text)
    setVoiceState(VOICE_STATE.SPEAKING)

    function pickVoice(voices) {
      const l = langRef.current || 'ta-IN'
      // 1. Exact locale match (e.g. 'ta-IN' or 'en-IN')
      let v = voices.find(vx => vx.lang === l)
      if (v) return v
      // 2. Language prefix match (e.g. 'ta' or 'en')
      v = voices.find(vx => vx.lang.startsWith(l.split('-')[0]))
      if (v) return v
      // 3. Name contains language
      if (l.startsWith('ta')) {
        v = voices.find(vx => /tamil/i.test(vx.name))
        if (v) return v
        // 4. Fallback for Tamil on Windows: if no Tamil voice is installed,
        // use an Indian English or Hindi voice so speech actually outputs
        v = voices.find(vx => vx.lang === 'en-IN' || /india/i.test(vx.name))
        if (v) return v
      }
      return voices.find(vx => vx.default) || voices[0] || null
    }

    function doSpeak() {
      if (ttsGenerationRef.current !== myGeneration) return

      const availableVoices = cachedVoicesRef.current.length > 0
        ? cachedVoicesRef.current
        : window.speechSynthesis.getVoices()

      const voice = pickVoice(availableVoices)
      const u = new SpeechSynthesisUtterance(text)

      if (voice) {
        u.voice = voice
        u.lang = voice.lang || langRef.current
      } else {
        u.lang = langRef.current
      }

      u.rate = langRef.current.startsWith('ta') ? 0.92 : 0.95
      u.pitch = 1

      // Chrome GC bug fix: Keep a strong reference in Set until spoken
      activeUtterancesRef.current.add(u)

      let finished = false
      const finalize = () => {
        if (finished) return
        finished = true
        activeUtterancesRef.current.delete(u)
        if (ttsGenerationRef.current === myGeneration) {
          setAgentText('')
          onDone?.()
        }
      }

      u.onend = finalize
      u.onerror = (err) => {
        if (err.error !== 'interrupted') {
          console.warn('[VoicePipeline] TTS notice:', err.error)
        }
        finalize()
      }

      window.speechSynthesis.speak(u)

      // Chrome keep-alive & unpause check
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume()
      }
    }

    // Try speaking immediately. If voices not yet populated, do quick fallback
    if (cachedVoicesRef.current.length > 0 || window.speechSynthesis.getVoices().length > 0) {
      doSpeak()
    } else {
      const timer = setTimeout(doSpeak, 250)
      window.speechSynthesis.onvoiceschanged = () => {
        clearTimeout(timer)
        cachedVoicesRef.current = window.speechSynthesis.getVoices()
        doSpeak()
      }
    }
  }, [setVoiceState])

  /* ──────────────────────────────────────────────────────────────────────
     cancelSpeech  (public — user taps mic while agent is speaking)
     ────────────────────────────────────────────────────────────────────── */
  const cancelSpeech = useCallback(() => {
    ttsGenerationRef.current += 1   // invalidate current TTS generation
    activeUtterancesRef.current.clear()
    window.speechSynthesis?.cancel()
    setAgentText('')
    setVoiceState(VOICE_STATE.IDLE)
  }, [setVoiceState])

  /* ──────────────────────────────────────────────────────────────────────
     resetDuplicateGuard  (call on session reset)
     ────────────────────────────────────────────────────────────────────── */
  const resetDuplicateGuard = useCallback(() => {
    lastTranscriptRef.current = ''
  }, [])

  /* ──────────────────────────────────────────────────────────────────────
     setConfirming  (used during CONFIRM phase)
     ────────────────────────────────────────────────────────────────────── */
  const setConfirming = useCallback(() => {
    setVoiceState(VOICE_STATE.CONFIRMING)
  }, [setVoiceState])

  return {
    voiceState, interim, agentText, srError, isSupported,
    startListening, stopListening, agentSpeak, cancelSpeech,
    resetDuplicateGuard, setConfirming,
    VOICE_STATE,
  }
}
