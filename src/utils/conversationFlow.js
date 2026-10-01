/**
 * conversationFlow.js
 * Defines the structured conversation phases, bilingual prompts,
 * natural follow-up logic, and voice confirmation detection.
 * The student's exact words are preserved verbatim — never summarised.
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
  'en-IN': {
    [PHASES.INTRO]: "Hi! Welcome to SpeakLog. Let's do a quick two-minute check-in on your work today. To start — what did you work on today?",
    [PHASES.WHAT_TRIED]: "What did you work on today?",
    [PHASES.WHAT_BROKE]: "Got it! Now — what broke, gave an error, or didn't work the way you expected?",
    [PHASES.WHY]: "Understood. And why do you think that happened?",
    [PHASES.CONFIRM]: "Here is your log in your own words. Should I save this log? Say 'yes, save it' to confirm, or click Save Log.",
    [PHASES.DONE]: "Awesome! Your log has been saved.",
  },
  'ta-IN': {
    [PHASES.INTRO]: "வணக்கம்! SpeakLog-க்கு வரவேற்கிறோம். இன்று நீங்கள் செய்த பணிகளைப் பற்றி ஒரு 2 நிமிடம் பேசலாம். முதலில் — இன்று என்ன work பண்ணினீர்கள் அல்லது என்ன try பண்ணினீர்கள்?",
    [PHASES.WHAT_TRIED]: "நீங்கள் இன்று என்ன work பண்ணினீர்கள் அல்லது என்ன try பண்ணினீர்கள்?",
    [PHASES.WHAT_BROKE]: "சரி. அடுத்ததாக — என்ன சரியாக வரவில்லை, என்ன error அல்லது என்ன பிரச்சனை வந்தது?",
    [PHASES.WHY]: "புரிகிறது. ஏன் அப்படி நடந்தது என்று நினைக்கிறீர்கள்?",
    [PHASES.CONFIRM]: "உங்கள் log உங்கள் சொந்த வார்த்தைகளில் திரையில் தயாராக உள்ளது. இதை save செய்யவா? உறுதிப்படுத்த 'yes, save it' அல்லது 'சரி சேவ் பண்ணு' என்று சொல்லவும்.",
    [PHASES.DONE]: "அருமை! உங்கள் log வெற்றிகரமாக save செய்யப்பட்டது.",
  },
}

export const GREETINGS = {
  'ta-IN': {
    main: 'வணக்கம்! உங்கள் நாளைப் பற்றி பேசலாம்',
    sub: '2 நிமிட தினசரி பொறியியல் குரல் பதிவு',
  },
  'en-IN': {
    main: "👋 Let's talk about your day",
    sub: '2-minute voice reflection for your engineering log',
  },
}

/**
 * Build one natural fallback follow-up question from the student's raw answer.
 * NEVER rephrase their words — only probe deeper with curiosity.
 */
export function buildFollowUp(phase, answer, lang = 'en-IN') {
  const isTamil = (lang || '').toLowerCase().startsWith('ta')
  const clean = (answer || '').replace(/\s+/g, ' ').trim()
  const snippet = clean.length > 50 ? clean.slice(0, 46).trim() + '…' : clean

  if (isTamil) {
    if (phase === PHASES.FOLLOWUP_1) {
      return snippet
        ? `புரிகிறது! "${snippet}" செய்யும்போது என்ன specific tool அல்லது method பயன்படுத்தினீர்கள்?`
        : `புரிகிறது! இதை செய்யும்போது என்ன specific tool அல்லது method பயன்படுத்தினீர்கள்?`
    }
    if (phase === PHASES.FOLLOWUP_2) {
      return snippet
        ? `சரி. "${snippet}" நடந்தபோது என்ன specific error message அல்லது பிரச்சனை வந்தது?`
        : `சரி. இதில் என்ன specific error message அல்லது பிரச்சனை வந்தது?`
    }
    if (phase === PHASES.FOLLOWUP_3) {
      return `புரிகிறது! இதை சரிசெய்ய அடுத்ததாக என்ன முயற்சி செய்ய திட்டமிட்டுள்ளீர்கள்?`
    }
    return `இதைப் பற்றி இன்னும் கொஞ்சம் விவரமாக சொல்ல முடியுமா?`
  }

  // English natural starters
  if (phase === PHASES.FOLLOWUP_1) {
    return snippet
      ? `Got it! When working on "${snippet}", what specific tool, library, or method did you use?`
      : `Got it! What specific tool, library, or approach did you use for that?`
  }
  if (phase === PHASES.FOLLOWUP_2) {
    return snippet
      ? `I see. When "${snippet}" happened, what specific error message or symptom did you see?`
      : `I see. What specific error message or unexpected symptom did you notice?`
  }
  if (phase === PHASES.FOLLOWUP_3) {
    return snippet
      ? `Understood. Knowing "${snippet}", what will you try differently next to solve it?`
      : `Understood. Knowing that now, what will you try differently next to resolve it?`
  }

  return `Could you tell me a little more detail about that?`
}

export function formatLog({ tried, broke, why }) {
  return [
    tried ? `What I worked on / tried:\n${tried}` : '',
    broke ? `What broke:\n${broke}` : '',
    why   ? `Why:\n${why}`          : '',
  ].filter(Boolean).join('\n\n')
}

/**
 * Returns true if the student confirmed saving/posting
 * Handles natural English & Tamil spoken confirmations
 */
export function isConfirmation(text = '') {
  const t = text.trim().toLowerCase()
  return (
    /yes[,\s]*(save|post|submit|go|do it|it|please|sure)/i.test(t) ||
    /^(yes|yeah|yep|sure|confirm|save|save it|post it|submit|submit it|save log|submit log|do it|okay|ok|looks good|perfect|correct)$/i.test(t) ||
    /(ஆம்|சரி|சேவ்|போஸ்ட்|சப்மிட்|பண்ணு|செய்|ஆமா|ஆமாம்|சரிங்க|சேவ் பண்ணு|save பண்ணு)/i.test(t)
  )
}

/**
 * Returns true if the student cancelled
 */
export function isCancellation(text = '') {
  const t = text.trim().toLowerCase()
  return (
    /^no\b/i.test(t) ||
    /^(cancel|stop|don't save|dont save|cancel log)$/i.test(t) ||
    /(வேண்டாம்|இல்லை|ரத்து|cancel)/i.test(t)
  )
}
