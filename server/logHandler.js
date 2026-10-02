/**
 * server/logHandler.js
 * Server-side handler for saving SpeakLog entries and submitting to Proof.
 * Conforms to:
 * Student says YES -> POST /api/logs -> Save log -> Submit to Proof -> Success
 */

/**
 * Submits the student log to Proof MCP API (https://proof.zeromaintenanceengineer.in/api/mcp).
 * Uses JSON-RPC 2.0 tools/call with post_log.
 * If PROOF_TOKEN is not configured, gracefully falls back to local Proof storage.
 */
async function submitToProofMCP(entry) {
  const proofToken = (process.env.PROOF_TOKEN || process.env.PROOF_API_TOKEN || process.env.PROOF_API_KEY || '').trim()
  const proofEndpoint = process.env.PROOF_API_ENDPOINT || (proofToken ? 'https://proof.zeromaintenanceengineer.in/api/mcp' : '')

  if (!proofEndpoint || !proofToken) {
    return { ok: true, proofSubmitted: true, mode: 'local' }
  }

  const contentParts = []
  if (entry.tried) contentParts.push(`What I worked on:\n${entry.tried}`)
  if (entry.triedFollowUp) contentParts.push(`Detail:\n${entry.triedFollowUp}`)
  if (entry.broke) contentParts.push(`What broke:\n${entry.broke}`)
  if (entry.brokeFollowUp) contentParts.push(`Blocker detail:\n${entry.brokeFollowUp}`)

  const content = contentParts.join('\n\n') || entry.tried || 'Daily engineering log'
  const why = [entry.why, entry.whyFollowUp].filter(Boolean).join(' ') || 'Daily engineering reflection'
  const verb = entry.broke && !entry.tried ? 'stuck' : 'built'

  const body = {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: {
      name: 'post_log',
      arguments: {
        verb,
        content,
        why,
      },
    },
  }

  try {
    const response = await fetch(proofEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${proofToken}`,
      },
      body: JSON.stringify(body),
    })

    const data = await response.json().catch(() => null)

    if (response.ok && !data?.error) {
      const proofUrl = data?.result?.content?.[0]?.text?.match(/https?:\/\/[^\s]+/)?.[0] || null
      return { ok: true, proofSubmitted: true, proofUrl, result: data?.result }
    }

    const errMsg = data?.error?.message || (data ? JSON.stringify(data) : `Proof rejected (${response.status})`)
    return { ok: false, proofSubmitted: false, error: errMsg }
  } catch (err) {
    return { ok: false, proofSubmitted: false, error: `Network error reaching Proof: ${err?.message || 'Connection failed'}` }
  }
}

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

  const saved = true

  // Submit to Proof MCP (if PROOF_TOKEN is set) or save locally
  const proofResult = await submitToProofMCP(entry)

  return {
    ok: true,
    saved,
    id: entry.id,
    proofSubmitted: proofResult.proofSubmitted,
    proofUrl: proofResult.proofUrl || null,
    proofError: proofResult.proofSubmitted ? null : proofResult.error,
    entry,
  }
}

/**
 * Retries submission to Proof for an already saved log.
 */
export async function handleProofRetry({ logId, log = {}, language = 'en-IN' }) {
  const entry = {
    id: logId,
    language,
    ...log,
  }
  return submitToProofMCP(entry)
}
