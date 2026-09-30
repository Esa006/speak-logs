/**
 * conversationFlow.js
 * Defines the three required questions, follow-up logic, and confirmation flow.
 * The student's exact words are preserved — never summarised.
 */

export const PHASES = {
  INTRO:        'INTRO',
  WHAT_TRIED:   'WHAT_TRIED',
  FOLLOWUP_1:   'FOLLOWUP_1',
  WHAT_BROKE:   'WHAT_BROKE',
  FOLLOWUP_2:   'FOLLOWUP_2',
  WHY:          'WHY',
  FOLLOWUP_3:   'FOLLOWUP_3',
  CONFIRM:      'CONFIRM',
  DONE:         'DONE',
}

export const QUESTIONS = {
  [PHASES.INTRO]: `Hi! I'm your SpeakLog assistant. I'll ask you three quick questions about today's work. It'll take about two minutes. Ready? Let's start.`,
  [PHASES.WHAT_TRIED]: `What did you try today?`,
  [PHASES.WHAT_BROKE]: `Got it. Now — what broke or didn't work the way you expected?`,
  [PHASES.WHY]:        `Interesting. And why do you think that happened?`,
  [PHASES.CONFIRM]:    (log) =>
    `Here's your log:\n\n${formatLog(log)}\n\nShould I post this? Say "yes, post it" to confirm, or say "no" to cancel.`,
}

/**
 * Build one follow-up question from the student's raw answer.
 * NEVER rephrase their words — only probe deeper.
 */
export function buildFollowUp(phase, answer) {
  const starters = [
    `You mentioned "${truncate(answer, 60)}" — can you tell me a bit more about that?`,
    `That's helpful. When you say "${truncate(answer, 50)}", what specifically did you notice?`,
    `Interesting — could you walk me through exactly what happened when you tried that?`,
    `You said "${truncate(answer, 50)}" — was that the first time you saw that, or had it happened before?`,
  ]
  // Rotate starters by phase so it doesn't feel repetitive
  const idx = [PHASES.FOLLOWUP_1, PHASES.FOLLOWUP_2, PHASES.FOLLOWUP_3].indexOf(phase)
  return starters[Math.max(0, idx)] ?? starters[0]
}

function truncate(str, maxLen) {
  return str.length > maxLen ? str.slice(0, maxLen).trimEnd() + '…' : str
}

export function formatLog({ tried, broke, why }) {
  return [
    tried ? `What I tried:\n${tried}` : '',
    broke ? `What broke:\n${broke}` : '',
    why   ? `Why:\n${why}`          : '',
  ].filter(Boolean).join('\n\n')
}

/** Returns true if the student confirmed saving/posting */
export function isConfirmation(text = '') {
  const t = text.trim().toLowerCase()
  return (
    /yes[,\s]*(save|post|submit|go|do it|it|please)/i.test(t) ||
    /^(yes|yeah|yep|sure|confirm|save|save it|post it|do it|okay|ok)$/i.test(t) ||
    /(ஆம்|சரி|சேவ்|போஸ்ட்|பண்ணு|செய்)/i.test(t)
  )
}

/** Returns true if the student cancelled */
export function isCancellation(text = '') {
  const t = text.trim().toLowerCase()
  return /^no\b/i.test(t) || /(வேண்டாம்|இல்லை|cancel)/i.test(t)
}

