import { handleLogSave, handleProofRetry } from '../server/logHandler.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }))
    return
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    
    // Check if this is a retry action
    if (body.action === 'retry-proof' || body.retry) {
      const retryResult = await handleProofRetry({
        logId: body.logId,
        log: body.log || {},
        language: body.language || 'en-IN',
      })
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(retryResult))
      return
    }

    const result = await handleLogSave({
      log: body.log || {},
      language: body.language || 'en-IN',
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
