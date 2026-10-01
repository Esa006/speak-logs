import { handleAnalysis } from '../server/analysisHandler.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }))
    return
  }

  try {
    const body = req.body || {}
    const result = await handleAnalysis({
      ...body,
      envApiKey: process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY,
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
