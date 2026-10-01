import OpenAI from 'openai'

/**
 * Intelligent fallback analysis when OpenAI API is not configured or offline.
 */
function getFallbackAnalysis({ log = {}, language = 'en-IN' }) {
  const isTamil = (language || '').toLowerCase().startsWith('ta')
  const triedText = [log.tried, log.triedFollowUp].filter(Boolean).join(' ') || 'General engineering tasks'
  const brokeText = [log.broke, log.brokeFollowUp].filter(Boolean).join(' ') || 'No critical blockers reported'
  const whyText = [log.why, log.whyFollowUp].filter(Boolean).join(' ') || 'Work in progress investigation'

  const words = `${triedText} ${brokeText}`.toLowerCase().match(/\b[a-zA-Z]{3,}\b/g) || []
  const techKeywords = ['react', 'node', 'api', 'css', 'javascript', 'python', 'database', 'sql', 'bug', 'git', 'vite', 'server', 'ui', 'state', 'auth', 'build', 'npm']
  const matchedTags = [...new Set(words.filter(w => techKeywords.includes(w)))].slice(0, 4)
  const defaultTags = matchedTags.length > 0 ? matchedTags.map(t => t.toUpperCase()) : ['ENGINEERING', 'PROBLEM-SOLVING', 'DEV-LOG']

  return {
    success: true,
    source: 'fallback',
    summary: isTamil
      ? `இன்றைய பணி: ${triedText.slice(0, 100)}… இதில் ஏற்பட்ட சவால்கள் பகுப்பாய்வு செய்யப்பட்டன.`
      : `Today's effort focused on ${triedText.slice(0, 120)}. Handled challenges and identified potential improvement areas.`,
    blockerAnalysis: brokeText !== 'No critical blockers reported'
      ? `Main issue: ${brokeText.slice(0, 140)}. Root cause relates to: ${whyText.slice(0, 120)}.`
      : `Smooth progress today with no blockers halting workflow.`,
    keyLearnings: `Gained practical hands-on experience debugging through ${triedText.slice(0, 60)}.`,
    nextSteps: [
      'Isolate the failing module or error log to verify assumptions.',
      'Document the fix and test edge cases before moving forward.',
    ],
    tags: defaultTags,
    momentum: brokeText.length > 30 ? 'Overcoming Obstacles' : 'Steady Progress',
    feedback: isTamil
      ? 'தொடர்ந்து முயற்சி செய்யுங்கள்! பிழைகளை ஆராய்வது ஒரு நல்ல பொறியாளரின் முக்கிய அடையாளம்.'
      : 'Solid effort today. Diagnosing blockers systematically will make your next iteration much faster!',
    note: 'Provide an OPENAI_API_KEY in .env.local or UI Settings to enable live GPT-4o-mini deep analysis.',
  }
}

/**
 * Generates an engineering mentor analysis of the student's SpeakLog entry using gpt-4o-mini.
 */
export async function handleAnalysis({
  log = {},
  language = 'en-IN',
  customApiKey = '',
  envApiKey = '',
}) {
  const apiKey = customApiKey || envApiKey || process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY
  const isTamil = (language || '').toLowerCase().startsWith('ta')

  const triedCombined = [log.tried, log.triedFollowUp].filter(Boolean).join('\nFollow-up: ')
  const brokeCombined = [log.broke, log.brokeFollowUp].filter(Boolean).join('\nFollow-up: ')
  const whyCombined = [log.why, log.whyFollowUp].filter(Boolean).join('\nFollow-up: ')

  if (!triedCombined.trim() && !brokeCombined.trim() && !whyCombined.trim()) {
    return {
      success: true,
      source: 'fallback',
      summary: 'No spoken log recorded yet.',
      blockerAnalysis: 'N/A',
      keyLearnings: 'N/A',
      nextSteps: ['Start recording your daily log to get AI analysis.'],
      tags: ['EMPTY-LOG'],
      momentum: 'Idle',
      feedback: 'Record your 2-minute log to receive mentor feedback.',
    }
  }

  if (apiKey) {
    try {
      const openai = new OpenAI({ apiKey })

      const prompt = `You are an expert senior engineering mentor reviewing a student's daily 2-minute "SpeakLog" entry.
The student answered these 3 questions (and follow-up questions):
1. What did you try?
${triedCombined || '(No response)'}

2. What broke or didn't work?
${brokeCombined || '(No response)'}

3. Why do you think that happened?
${whyCombined || '(No response)'}

Language of recording: ${language} ${isTamil ? '(Tamil/Tanglish context)' : ''}

TASK:
Provide an encouraging, technically sharp engineering mentor breakdown.
Return ONLY valid JSON matching this exact structure:
{
  "summary": "Crisp 1-2 sentence overview of what the student accomplished or attempted.",
  "blockerAnalysis": "Insightful breakdown of the blocker or bug they faced and why it likely occurred.",
  "keyLearnings": "The key engineering lesson or takeaway from today's work.",
  "nextSteps": [
    "Specific actionable next step 1",
    "Specific actionable next step 2"
  ],
  "tags": ["TECH1", "TECH2", "CONCEPT"],
  "momentum": "Steady Progress" | "High Momentum" | "Debugging Deep-Dive" | "Overcoming Obstacles",
  "feedback": "1-2 sentences of encouraging, mentor advice to boost confidence and clarity."
}`

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are an engineering mentor. Respond ONLY with a valid JSON object matching the requested schema.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.6,
        response_format: { type: 'json_object' },
      })

      const rawContent = completion.choices[0]?.message?.content?.trim() || '{}'
      const parsed = JSON.parse(rawContent)

      return {
        success: true,
        source: 'openai',
        model: 'gpt-4o-mini',
        summary: parsed.summary || 'Summary unavailable',
        blockerAnalysis: parsed.blockerAnalysis || 'Blocker analysis unavailable',
        keyLearnings: parsed.keyLearnings || 'Key learnings unavailable',
        nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : ['Continue iterative testing.'],
        tags: Array.isArray(parsed.tags) ? parsed.tags : ['ENGINEERING'],
        momentum: parsed.momentum || 'Steady Progress',
        feedback: parsed.feedback || 'Great job reflecting on your engineering day.',
      }
    } catch (err) {
      console.warn('[analysisHandler] OpenAI request failed, using intelligent fallback:', err?.message || err)
      const fallback = getFallbackAnalysis({ log, language })
      return {
        ...fallback,
        error: err?.message || 'OpenAI error',
      }
    }
  }

  // Fallback when no API key
  return getFallbackAnalysis({ log, language })
}
