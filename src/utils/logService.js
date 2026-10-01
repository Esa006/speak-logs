/**
 * logService.js
 * Handles saving student logs verbatim to local storage.
 */

const STORAGE_KEY = 'speaklog_saved_entries'

/**
 * Saves the student's log verbatim and returns confirmation details.
 */
export async function saveLog({ tried = '', broke = '', why = '', language = 'en-IN', analysis = null }) {
  const entry = {
    id: `LOG-${Date.now().toString(36).toUpperCase()}`,
    language,
    verbatim: true, // exact words of the student
    tried,
    broke,
    why,
    analysis,
    createdAt: new Date().toISOString(),
  }

  try {
    const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    existing.unshift(entry)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing.slice(0, 50)))
  } catch (err) {
    console.warn('[logService] Could not persist to localStorage:', err)
  }

  // Artificial async delay to simulate saving cleanly
  await new Promise(resolve => setTimeout(resolve, 350))

  return { ok: true, id: entry.id, entry }
}

/**
 * Updates an existing log with AI analysis results.
 */
export function updateLogAnalysis(id, analysis) {
  try {
    const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    const updated = existing.map(item => item.id === id ? { ...item, analysis } : item)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  } catch (err) {
    console.warn('[logService] Could not update log analysis:', err)
  }
}

/**
 * Retrieves all saved logs.
 */
export function getSavedLogs() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

// Named alias for smooth backwards compatibility
export const postLog = saveLog
