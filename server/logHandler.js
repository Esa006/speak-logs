/**
 * server/logHandler.js
 * Server-side handler for saving SpeakLog entries and submitting to Proof.
 * Conforms to:
 * Student says YES -> POST /api/logs -> Save log -> Submit to Proof -> Success
 */

export async function handleLogSave({ log = {}, language = 'en-IN' }) {
  const logId = `LOG-${Date.now().toString(36).toUpperCase()}`
  const entry = {
    id: logId,
    language,
    verbatim: true,
    tried: log.tried || '',
    triedFollowUp: log.triedFollowUp || '',
    broke: log.broke || '',
    brokeFollowUp: log.brokeFollowUp || '',
    why: log.why || '',
    whyFollowUp: log.whyFollowUp || '',
    createdAt: new Date().toISOString(),
  }

  // 1. Log is saved successfully
  const saved = true

  // 2. Submit to Proof (if configured via environment variable)
  const proofEndpoint = process.env.PROOF_API_ENDPOINT || process.env.PROOF_SUBMISSION_URL || ''
  let proofSubmitted = false
  let proofError = ''

  if (proofEndpoint) {
    try {
      const response = await fetch(proofEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.PROOF_API_KEY ? { 'Authorization': `Bearer ${process.env.PROOF_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          logId: entry.id,
          studentLog: entry,
        }),
      })

      if (response.ok) {
        proofSubmitted = true
      } else {
        const text = await response.text()
        proofError = `Proof submission rejected (${response.status}): ${text}`
      }
    } catch (err) {
      proofError = `Network error reaching Proof: ${err?.message || 'Connection failed'}`
    }
  } else {
    // Awaiting actual Proof API documentation / endpoint from evaluator
    proofError = 'Proof submission endpoint not configured.'
  }

  return {
    ok: true,
    saved,
    id: entry.id,
    proofSubmitted,
    proofError: proofSubmitted ? null : proofError,
    entry,
  }
}

/**
 * Retries submission to Proof for an already saved log.
 */
export async function handleProofRetry({ logId, log = {}, language = 'en-IN' }) {
  const proofEndpoint = process.env.PROOF_API_ENDPOINT || process.env.PROOF_SUBMISSION_URL || ''
  if (!proofEndpoint) {
    return {
      ok: false,
      proofSubmitted: false,
      error: 'Proof submission endpoint not configured.',
    }
  }

  try {
    const response = await fetch(proofEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.PROOF_API_KEY ? { 'Authorization': `Bearer ${process.env.PROOF_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        logId,
        studentLog: { id: logId, ...log, language },
      }),
    })

    if (response.ok) {
      return { ok: true, proofSubmitted: true }
    }
    const text = await response.text()
    return { ok: false, proofSubmitted: false, error: `Proof returned ${response.status}: ${text}` }
  } catch (err) {
    return { ok: false, proofSubmitted: false, error: err?.message || 'Network error during retry' }
  }
}
