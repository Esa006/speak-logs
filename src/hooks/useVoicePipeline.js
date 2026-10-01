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

/**
 * Merges two speech segments, detecting and eliminating word-level overlaps
 * caused by Chrome's rolling ASR buffer (e.g. "today" + "today create" -> "today create").
 */
function mergeWithOverlap(str1, str2) {
  const s1 = (str1 || '').trim()
  const s2 = (str2 || '').trim()
  if (!s1) return s2
  if (!s2) return s1

  if (s2.toLowerCase().startsWith(s1.toLowerCase())) {
    return s2
  }
  if (s1.toLowerCase().endsWith(s2.toLowerCase())) {
    return s1
  }

  const w1 = s1.split(/\s+/)
  const w2 = s2.split(/\s+/)

  // Check word-level overlap at the seam (up to 8 words)
  const maxOverlap = Math.min(w1.length, w2.length, 8)
  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    const s1Tail = w1.slice(w1.length - overlap).map(w => w.toLowerCase()).join(' ')
    const s2Head = w2.slice(0, overlap).map(w => w.toLowerCase()).join(' ')
    if (s1Tail === s2Head) {
      return [...w1, ...w2.slice(overlap)].join(' ')
    }
  }

  return s1 + ' ' + s2
}

/**
 * Eliminates accidental word doublings like "todaytoday" and consecutive identical words
 * like "today today today" caused by Chrome's interim revision re-emission.
 */
function removeConsecutiveDuplicates(str) {
  if (!str) return ''
  const words = str.trim().split(/\s+/)
  const cleaned = []

  for (let i = 0; i < words.length; i++) {
    const raw = words[i].trim()
    if (!raw) continue

    // 1. Detect stuck-together duplicate words like "todaytoday" or "chatchat"
    let word = raw
    const len = raw.length
    if (len >= 6 && len % 2 === 0) {
      const half = raw.slice(0, len / 2)
      if (raw.toLowerCase() === (half + half).toLowerCase()) {
        word = half
      }
    }

    // 2. Detect consecutive identical words
    const prev = cleaned[cleaned.length - 1]
    if (prev && prev.toLowerCase() === word.toLowerCase()) {
      continue // Drop consecutive repeat
    }

    cleaned.push(word)
  }

  return cleaned.join(' ')
}

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
  const recognitionRef       = useRef(null)   // current SR instance
  const recognitionRunningRef = useRef(false)  // guard: recognition is starting/running
  const isSpeakingRef         = useRef(false)  // guard: TTS is currently speaking
  const spokenResponseIdRef   = useRef(null)   // guard: unique response ID already spoken
  const lastTranscriptRef    = useRef('')     // duplicate-answer guard
  const ttsGenerationRef     = useRef(0)      // TTS stale-callback guard
  const activeUtterancesRef  = useRef(new Set()) // V8 GC protection
  const cachedVoicesRef      = useRef([])
  const langRef              = useRef(lang)
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
    recognitionRunningRef.current = false
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

    // Guard: Never start recognition while TTS is actively speaking
    if (isSpeakingRef.current) {
      console.log('[Speech] start blocked: TTS is currently speaking')
      return
    }

    // Guard: Prevent double invocation if recognition is already running
    if (recognitionRunningRef.current) {
      console.log('[Speech] start blocked: recognition is already running')
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
     * Triggered by the silence debounce, NOT by premature onend.
     */
    const finishListening = () => {
      clearSilenceTimer()
      if (recognitionRef.current !== r) return   // stale-instance guard
      stoppedManually = true
      recognitionRunningRef.current = false
      try { r.stop() } catch {}

      const text = removeConsecutiveDuplicates(capturedTranscript).trim()
      if (!text) {
        setVoiceState(VOICE_STATE.LISTENING)
        return
      }

      if (lastTranscriptRef.current === text) {
        console.log('[Speech] duplicate prevented:', text)
        setVoiceState(VOICE_STATE.LISTENING)
        return
      }
      lastTranscriptRef.current = text
      console.log('[Speech] final transcript:', text)
      setVoiceState(VOICE_STATE.PROCESSING)
      onTranscript?.(text)
    }

    /**
     * resetSilenceTimer — called after ANY recognized speech.
     * Waits SILENCE_MS after the user stops speaking before finalizing.
     */
    const resetSilenceTimer = () => {
      clearSilenceTimer()
      if (!hasSpeech) return
      silenceTimer = setTimeout(finishListening, SILENCE_MS)
    }

    /* ── Event handlers ── */
    r.onstart = () => {
      if (recognitionRef.current !== r) return
      recognitionRunningRef.current = true
      console.log('[Speech] recognition started')
      setVoiceState(VOICE_STATE.LISTENING)
      setInterim('')
    }

    r.onresult = (e) => {
      if (recognitionRef.current !== r) return
      // Strict half-duplex: ignore any microphone input if AI is speaking
      if (isSpeakingRef.current) return

      let finals = ''
      let live = ''

      // Full sweep of results: preserves confirmed text and active interim
      for (let i = 0; i < e.results.length; i++) {
        const item = e.results[i]
        const t = item[0]?.transcript || ''
        if (!t.trim()) continue

        if (item.isFinal) {
          finals = mergeWithOverlap(finals, t.trim())
        } else {
          live = mergeWithOverlap(live, t.trim())
        }
      }

      // Merge confirmed finals with active live interim
      const rawFull = mergeWithOverlap(finals, live)
      // Strip out any duplicate words or words glued together like "todaytoday"
      const cleanFull = removeConsecutiveDuplicates(rawFull)

      capturedTranscript = cleanFull
      hasSpeech = !!cleanFull

      console.log('[Speech] interim transcript:', cleanFull)
      setInterim(cleanFull)

      // CRITICAL: Schedule silence timer whenever speech is heard.
      if (hasSpeech) {
        resetSilenceTimer()
      }
    }

    r.onerror = (e) => {
      if (recognitionRef.current !== r) return
      // 'no-speech' is a normal Chrome timeout when waiting for user — ignore
      if (e.error === 'no-speech') return

      clearSilenceTimer()
      recognitionRunningRef.current = false
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        const msg = langRef.current === 'ta-IN'
          ? 'தயவுசெய்து உங்கள் உலாவியில் மைக்ரோஃபோன் அணுகலை அனுமதிக்கவும்.'
          : 'Please allow microphone access.'
        setSrError(msg)
        onError?.(msg)
        setVoiceState(VOICE_STATE.IDLE)
      } else {
        setSrError(`Microphone notice: ${e.error}`)
      }
    }

    r.onend = () => {
      if (recognitionRef.current !== r) return
      clearSilenceTimer()
      recognitionRunningRef.current = false
      console.log('[Speech] recognition ended')

      // If finished cleanly via debounce, stop here
      if (stoppedManually) {
        setInterim('')
        return
      }

      // If user had spoken, finalize what we captured
      const text = removeConsecutiveDuplicates(capturedTranscript).trim()
      if (text) {
        stoppedManually = true
        lastTranscriptRef.current = text
        console.log('[Speech] final transcript (onend):', text)
        setInterim('')
        setVoiceState(VOICE_STATE.PROCESSING)
        onTranscript?.(text)
        return
      }

      // If Chrome closed due to silence timeout while still in LISTENING,
      // start a fresh recognition instance if AI is NOT speaking
      if (!isSpeakingRef.current) {
        console.log('[Speech] restart: session active, restarting clean recognition')
        setTimeout(() => {
          if (!isSpeakingRef.current) startListening()
        }, 80)
      } else {
        setVoiceState(VOICE_STATE.IDLE)
      }
    }

    // Register BEFORE .start() so all callbacks see correct current instance.
    recognitionRef.current = r
    try {
      r.start()
    } catch (err) {
      console.warn('[Speech] start error:', err)
      recognitionRunningRef.current = false
    }
  }, [isSupported, onTranscript, onError, setVoiceState])

  /* ──────────────────────────────────────────────────────────────────────
     agentSpeak  (public)
     ────────────────────────────────────────────────────────────────────── */
  const agentSpeak = useCallback((input, onDone) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      onDone?.()
      return
    }

    const text = typeof input === 'string' ? input : input?.text || ''
    const responseId = typeof input === 'object' ? input?.id : null

    // Guard: Prevent speaking the same response ID multiple times
    if (responseId) {
      if (spokenResponseIdRef.current === responseId) {
        console.log('[TTS] duplicate prevented for ID:', responseId)
        return
      }
      spokenResponseIdRef.current = responseId
    }

    console.log('[TTS] speaking response ID:', responseId || 'ad-hoc', text)

    ttsGenerationRef.current += 1
    const myGeneration = ttsGenerationRef.current

    // Strict Half-Duplex: stop microphone recognition immediately before AI speaks
    isSpeakingRef.current = true
    stopListening()

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
          // Acoustic buffer: wait 200ms before allowing mic so speaker echo doesn't trigger mic
          setTimeout(() => {
            isSpeakingRef.current = false
            onDone?.()
          }, 200)
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
  }, [setVoiceState, stopListening])

  /* ──────────────────────────────────────────────────────────────────────
     cancelSpeech  (public — user taps mic while agent is speaking)
     ────────────────────────────────────────────────────────────────────── */
  const cancelSpeech = useCallback(() => {
    ttsGenerationRef.current += 1   // invalidate current TTS generation
    isSpeakingRef.current = false
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
