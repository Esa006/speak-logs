/**
 * aiFollowUp.js
 * Client utility to fetch a single follow-up question from /api/follow-up.
 * Connects React App -> /api/follow-up -> OpenAI API -> speechSynthesis()
 */

const LOCAL_STORAGE_KEY = 'speaklog_openai_api_key'

export function getStoredApiKey() {
  try {
    return localStorage.getItem(LOCAL_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

export function setStoredApiKey(key) {
  try {
    if (!key) {
      localStorage.removeItem(LOCAL_STORAGE_KEY)
    } else {
      localStorage.setItem(LOCAL_STORAGE_KEY, key.trim())
    }
  } catch (err) {
    console.error('Failed to store API key:', err)
  }
}

export async function requestFollowUp({
  transcript,
  question,
  language = 'en-IN',
  phase = 'WHAT_TRIED',
  customApiKey = '',
}) {
  const effectiveKey = customApiKey || getStoredApiKey()

  try {
    const res = await fetch('/api/follow-up', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript,
        question,
        language,
        phase,
        customApiKey: effectiveKey,
      }),
    })

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`Server returned ${res.status}: ${errorText}`)
    }

    const data = await res.json()
    return {
      followUp: data.followUp || 'Can you tell me more about that?',
      source: data.source || 'fallback',
      model: data.model,
      note: data.note,
    }
  } catch (err) {
    console.warn('[aiFollowUp] Request failed, using client fallback:', err)
    // Client fallback if network disconnected
    const isTamil = (language || '').toLowerCase().startsWith('ta')
    return {
      followUp: isTamil
        ? 'இதைப் பற்றி இன்னும் கொஞ்சம் விவரமாக சொல்ல முடியுமா?'
        : 'Could you share a bit more detail about that?',
      source: 'offline_fallback',
      error: err.message,
    }
  }
}
