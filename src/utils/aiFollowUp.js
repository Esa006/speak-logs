/**
 * aiFollowUp.js
 * Client utility to fetch a single follow-up question from /api/follow-up.
 * Secure architecture: Browser -> Vercel Serverless API -> OpenAI
 * API Key is stored only as OPENAI_API_KEY inside server environment variables.
 */

export async function requestFollowUp({
  transcript,
  question,
  language = 'en-IN',
  phase = 'WHAT_TRIED',
}) {
  try {
    const res = await fetch('/api/follow-up', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript,
        question,
        language,
        phase,
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
