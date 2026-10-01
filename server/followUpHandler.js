import OpenAI from 'openai'

/**
 * Generates an intelligent, natural contextual fallback question when OpenAI API is unavailable or fails.
 */
function getFallbackQuestion({ transcript = '', _question = '', language = 'en-IN', phase = 'WHAT_TRIED' }) {
  const isTamil = (language || '').toLowerCase().startsWith('ta')
  const clean = transcript.replace(/\s+/g, ' ').trim()
  const snippet = clean.length > 50 ? clean.slice(0, 46).trim() + '…' : clean

  if (isTamil) {
    if (phase === 'WHAT_BROKE') {
      return snippet
        ? `சரி. "${snippet}" நடந்தபோது என்ன error message அல்லது பிரச்சனை வந்தது?`
        : `சரி. இதில் என்ன specific error message அல்லது பிரச்சனை வந்தது?`
    }
    if (phase === 'WHY') {
      return snippet
        ? `புரிகிறது! "${snippet}" என்று சொன்னீர்கள் — இதை சரிசெய்ய அடுத்ததாக என்ன முயற்சி செய்ய போகிறீர்கள்?`
        : `புரிகிறது! இதை சரிசெய்ய அடுத்ததாக என்ன முயற்சி செய்ய திட்டமிட்டுள்ளீர்கள்?`
    }
    // WHAT_TRIED or default
    return snippet
      ? `புரிகிறது! "${snippet}" செய்யும்போது என்ன specific tool அல்லது method பயன்படுத்தினீர்கள்?`
      : `புரிகிறது! இதை செய்யும்போது என்ன specific tool அல்லது framework பயன்படுத்தினீர்கள்?`
  }

  // English fallback
  if (phase === 'WHAT_BROKE') {
    return snippet
      ? `I see. When "${snippet}" happened, what specific error message or symptom did you see?`
      : `I see. What specific error message or unexpected symptom did you notice?`
  }
  if (phase === 'WHY') {
    return snippet
      ? `Understood. Knowing "${snippet}", what will you try differently next to solve it?`
      : `Understood. Knowing that now, what will you try differently next to resolve it?`
  }
  // WHAT_TRIED or default
  return snippet
    ? `Got it! When working on "${snippet}", what specific tool, library, or method did you use?`
    : `Got it! What specific tool, framework, or approach did you use for that?`
}

/**
 * Main handler for generating one natural follow-up question.
 * Only uses server-side OPENAI_API_KEY.
 */
export async function handleFollowUp({
  transcript = '',
  question = '',
  language = 'en-IN',
  phase = 'WHAT_TRIED',
  envApiKey = '',
}) {
  const apiKey = envApiKey || process.env.OPENAI_API_KEY
  const isTamil = (language || '').toLowerCase().startsWith('ta')

  if (!transcript || !transcript.trim()) {
    return {
      success: true,
      followUp: isTamil
        ? 'கொஞ்சம் விவரமாக சொல்ல முடியுமா?'
        : 'Could you share a little more detail about that?',
      source: 'fallback',
      reason: 'empty_transcript',
    }
  }

  if (apiKey) {
    try {
      const openai = new OpenAI({ apiKey })

      const systemPrompt = isTamil
        ? `You are a warm, supportive voice mentor for engineering students in Tamil Nadu recording a daily 2-minute "SpeakLog".
The student was asked: "${question}"
The student answered: "${transcript}"
Current Phase: ${phase}

Task: Ask a natural, conversational follow-up question in spoken Tamil or Tanglish (as commonly spoken by college engineering students in Tamil Nadu).
RULES:
1. Output ONLY the single follow-up question text.
2. Ask EXACTLY ONE question (under 20 words) so browser text-to-speech reads it smoothly and naturally.
3. Start naturally with a brief conversational acknowledgment if appropriate (e.g. "புரிகிறது —", "அருமை —", "சரி —").
4. Probe into practical engineering details: what specific tool, API, error message, root cause, or next fix.
5. NEVER summarize or critique the student's words.
6. Do NOT include quotes, "Assistant:", or markdown formatting.`
        : `You are a warm, supportive senior engineering mentor listening to a student's daily 2-minute "SpeakLog" check-in.
The student was asked: "${question}"
The student answered: "${transcript}"
Current Phase: ${phase}

Task: Ask a natural, conversational follow-up question directly based on what they just shared.
RULES:
1. Output ONLY the single follow-up question text.
2. Ask EXACTLY ONE question (under 20 words) so browser text-to-speech reads it smoothly and naturally.
3. Start naturally with a brief conversational acknowledgment (e.g. "Got it —", "That's interesting —", "I see —").
4. Probe into practical technical details: tools used, specific error messages, unexpected symptoms, root cause, or next fix.
5. NEVER summarize, critique, or alter the student's words.
6. Do NOT include quotes, "Assistant:", or markdown formatting.`

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a concise, warm voice assistant. Output only the single question.' },
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
    note: 'Provide OPENAI_API_KEY in environment variables to enable live GPT-4o-mini generation.',
  }
}
