import OpenAI from 'openai'

/**
 * Generates an intelligent, contextual fallback question when OpenAI API key is unavailable or fails.
 */
function getFallbackQuestion({ transcript = '', _question = '', language = 'en-IN', phase = 'WHAT_TRIED' }) {
  const isTamil = (language || '').toLowerCase().startsWith('ta')
  const clean = transcript.replace(/\s+/g, ' ').trim()
  const snippet = clean.length > 45 ? clean.slice(0, 42).trim() + '…' : clean

  if (isTamil) {
    if (phase === 'WHAT_BROKE') {
      return snippet
        ? `"${snippet}" — இதில் என்ன error message அல்லது பிரச்சனை வந்தது?`
        : `இதில் என்ன error message அல்லது பிரச்சனை வந்தது?`
    }
    if (phase === 'WHY') {
      return `புரிகிறது! இதை சரிசெய்ய அடுத்ததாக என்ன முயற்சி செய்ய திட்டமிட்டுள்ளீர்கள்?`
    }
    // WHAT_TRIED or default
    return snippet
      ? `"${snippet}" — இதை செய்யும்போது என்ன specific tool அல்லது method பயன்படுத்தினீர்கள்?`
      : `இதை செய்யும்போது என்ன specific tool அல்லது method பயன்படுத்தினீர்கள்?`
  }

  // English fallback
  if (phase === 'WHAT_BROKE') {
    return snippet
      ? `When "${snippet}" happened, what specific error message or symptom did you see?`
      : `What specific error message or unexpected symptom did you see?`
  }
  if (phase === 'WHY') {
    return `Got it. Knowing that now, what will you try differently next?`
  }
  // WHAT_TRIED or default
  return snippet
    ? `You mentioned "${snippet}" — what specific tool or library did you use?`
    : `What specific tool or library did you use for that?`
}

/**
 * Main handler for generating one follow-up question.
 */
export async function handleFollowUp({
  transcript = '',
  question = '',
  language = 'en-IN',
  phase = 'WHAT_TRIED',
  customApiKey = '',
  envApiKey = '',
}) {
  const apiKey = customApiKey || envApiKey || process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY
  const isTamil = (language || '').toLowerCase().startsWith('ta')

  if (!transcript || !transcript.trim()) {
    return {
      success: true,
      followUp: isTamil
        ? 'கொஞ்சம் தெளிவாக சொல்ல முடியுமா?'
        : 'Could you tell me a little more about that?',
      source: 'fallback',
      reason: 'empty_transcript',
    }
  }

  if (apiKey) {
    try {
      const openai = new OpenAI({ apiKey })

      const systemPrompt = isTamil
        ? `You are an empathetic, curious voice assistant for engineering students in Tamil Nadu recording a daily 2-minute "SpeakLog".
The student answered in Tamil / Tanglish:
Question: "${question}"
Student answer: "${transcript}"

Task: Ask EXACTLY ONE concise, insightful follow-up question in Tamil (conversational Tamil or Tanglish as spoken by students in Tamil Nadu).
RULES:
1. Output ONLY the single follow-up question text.
2. Ask EXACTLY ONE question. Never ask multiple questions.
3. Keep it brief (under 18 words) so text-to-speech reads it smoothly.
4. NEVER summarize, rewrite, or alter the student's words.
5. Probe deeper into their experience (e.g. what specific tool, error, reason, or next step).
6. Do NOT include quotes, "Assistant:", greetings, or commentary.`
        : `You are an empathetic, curious voice assistant for engineering students recording a daily 2-minute "SpeakLog".
The student answered:
Question: "${question}"
Student answer: "${transcript}"

Task: Ask EXACTLY ONE concise, insightful follow-up question in English directly based on what they just said.
RULES:
1. Output ONLY the single follow-up question text.
2. Ask EXACTLY ONE question. Never ask multiple questions.
3. Keep it brief (under 18 words) so text-to-speech reads it smoothly.
4. NEVER summarize, rewrite, or alter the student's words.
5. Probe deeper into their experience (e.g. what specific tool, error, reason, or next step).
6. Do NOT include quotes, "Assistant:", greetings, or commentary.`

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a concise voice assistant. Output only the single question.' },
          { role: 'user', content: systemPrompt },
        ],
        max_tokens: 60,
        temperature: 0.7,
      })

      let text = completion.choices[0]?.message?.content?.trim() || ''
      text = text.replace(/^["'`]+|["'`]+$/g, '').trim()

      if (text) {
        return {
          success: true,
          followUp: text,
          source: 'openai',
          model: 'gpt-4o-mini',
        }
      }
    } catch (err) {
      console.warn('[followUpHandler] OpenAI request failed, using intelligent fallback:', err?.message || err)
      const fallback = getFallbackQuestion({ transcript, question, language, phase })
      return {
        success: true,
        followUp: fallback,
        source: 'fallback',
        error: err?.message || 'OpenAI error',
      }
    }
  }

  // No API key provided — return high quality contextual fallback
  const fallback = getFallbackQuestion({ transcript, question, language, phase })
  return {
    success: true,
    followUp: fallback,
    source: 'fallback',
    note: 'Provide OPENAI_API_KEY in .env.local to enable live GPT-4o-mini generation.',
  }
}
