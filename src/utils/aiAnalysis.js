/**
 * aiAnalysis.js
 * Client utility to fetch an AI post-session analysis report from /api/analyze.
 * Secure architecture: Browser -> Vercel Serverless API -> OpenAI
 * API Key is stored only as OPENAI_API_KEY inside server environment variables.
 */

export async function requestAnalysis({
  log,
  language = 'en-IN',
}) {
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        log,
        language,
      }),
    })

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`Server returned ${res.status}: ${errorText}`)
    }

    const data = await res.json()
    return data
  } catch (err) {
    console.warn('[aiAnalysis] Request failed, using client fallback:', err)
    return {
      success: true,
      source: 'client_fallback',
      summary: log.tried ? `Worked on: ${log.tried.slice(0, 100)}` : 'Daily engineering practice completed.',
      blockerAnalysis: log.broke ? `Faced blocker: ${log.broke.slice(0, 100)}` : 'No blockers noted.',
      keyLearnings: log.why ? `Insight: ${log.why.slice(0, 100)}` : 'Built debugging resilience.',
      nextSteps: ['Review and test the edge cases.', 'Prepare the next task.'],
      tags: ['DEV-LOG', 'SPEAKLOG'],
      momentum: 'Steady Progress',
      feedback: 'Great continuous progress! Every recorded blocker brings clarity.',
      error: err.message,
    }
  }
}
