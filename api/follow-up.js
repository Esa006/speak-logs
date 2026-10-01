import { handleFollowUp } from '../server/followUpHandler.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }))
    return
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const result = await handleFollowUp({
      transcript: body.transcript || '',
      question: body.question || '',
      language: body.language || 'en-IN',
      phase: body.phase || 'WHAT_TRIED',
      envApiKey: process.env.OPENAI_API_KEY,
    })
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(result))
  } catch (err) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: err?.message || 'Internal server error' }))
  }
}
