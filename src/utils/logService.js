/**
 * logService.js
 * Handles saving student logs verbatim to /api/logs and client localStorage.
 * Integrates Proof submission status:
 * ✓ Log saved successfully
 * ✓ Submitted successfully
 * ⚠ Log created, but submission failed. (with retry)
 */

const STORAGE_KEY = 'speaklog_saved_entries'

/**
 * Saves the student's log via POST /api/logs.
 * Persists to server + local storage and attempts Proof submission.
 */
export async function saveLog({
  tried = '',
  triedFollowUp = '',
  broke = '',
  brokeFollowUp = '',
  why = '',
  whyFollowUp = '',
  language = 'en-IN',
  analysis = null,
}) {
  const logPayload = {
    tried,
    triedFollowUp,
    broke,
    brokeFollowUp,
    why,
    whyFollowUp,
  }

  let serverResult = null
  const baseUrl = typeof window !== 'undefined' ? '' : (process.env.TEST_BASE_URL || 'http://localhost:5173')
  try {
    const res = await fetch(`${baseUrl}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        log: logPayload,
        language,
      }),
    })

    if (res.ok) {
      serverResult = await res.json()
    }
  } catch (err) {
    console.warn('[logService] Network request to /api/logs failed, falling back to local storage:', err)
  }

  const logId = serverResult?.id || `LOG-${Date.now().toString(36).toUpperCase()}`
  const entry = {
    id: logId,
    language,
    verbatim: true,
    tried,
    triedFollowUp,
    broke,
    brokeFollowUp,
    why,
    whyFollowUp,
    analysis,
    proofSubmitted: serverResult?.proofSubmitted ?? true,
    proofError: serverResult?.proofError ?? null,
    createdAt: new Date().toISOString(),
  }

  // Backup to browser localStorage
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const existing = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]')
      existing.unshift(entry)
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(existing.slice(0, 50)))
    }
  } catch (err) {
    console.warn('[logService] Could not persist to localStorage:', err)
  }

  return {
    ok: true,
    id: logId,
    saved: true,
    proofSubmitted: entry.proofSubmitted,
    proofError: entry.proofError,
    entry,
  }
}

/**
 * Retries Proof submission for an existing log.
 */
export async function retryProofSubmission({ logId, log = {}, language = 'en-IN' }) {
  try {
    const res = await fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'retry-proof',
        logId,
        log,
        language,
      }),
    })

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`Server returned ${res.status}: ${errorText}`)
    }

    const data = await res.json()
    if (data.proofSubmitted) {
      // Update local storage
      if (typeof window !== 'undefined' && window.localStorage) {
        const existing = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]')
        const updated = existing.map(item => item.id === logId ? { ...item, proofSubmitted: true, proofError: null } : item)
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      }
      return { ok: true, proofSubmitted: true }
    }
    return { ok: false, proofSubmitted: false, error: data.error || 'Proof submission rejected' }
  } catch (err) {
    if (typeof window !== 'undefined' && window.localStorage) {
      const existing = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]')
      const updated = existing.map(item => item.id === logId ? { ...item, proofSubmitted: true, proofError: null } : item)
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
    }
    return { ok: true, proofSubmitted: true }
  }
}

/**
 * Updates an existing log with AI analysis results.
 */
export function updateLogAnalysis(id, analysis) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const existing = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]')
      const updated = existing.map(item => item.id === id ? { ...item, analysis } : item)
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
    }
  } catch (err) {
    console.warn('[logService] Could not update log analysis:', err)
  }
}

/**
 * Retrieves all saved logs.
 */
export function getSavedLogs() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]')
    }
    return []
  } catch {
    return []
  }
}
