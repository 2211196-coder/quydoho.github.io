// Vercel Serverless Function — Translate text via Groq API
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text, direction, apiKey: clientApiKey, model: clientModel } = req.body;
  const apiKey = clientApiKey || process.env.GROQ_API_KEY || '';
  const model = clientModel || process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }

  const systemPrompt = direction === 'vi2en' 
    ? "You are an expert English translator. Translate the following Vietnamese text to English accurately and naturally. Respond ONLY with the direct translation, nothing else. Do not use quotes, notes, or explanations."
    : "You are an expert Vietnamese translator. Translate the following English text to Vietnamese. The translation MUST be extremely natural, conversational, and context-appropriate. ABSOLUTELY DO NOT use any Chinese characters (Hanzi). Respond ONLY with the direct translation, nothing else. Do not use quotes, notes, or explanations.";

  const requestBody = {
    model: model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text }
    ],
    temperature: 0.2
  };

  try {
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!groqResponse.ok) {
      const errText = await groqResponse.text();
      console.error('Groq API Error (Vercel Translate):', groqResponse.status, errText);
      throw new Error(`Groq API returned ${groqResponse.status}: ${errText}`);
    }

    const data = await groqResponse.json();
    const translation = data.choices[0].message.content.trim();
    
    res.status(200).json({ translation });
  } catch (error) {
    console.error('Error in Vercel translate function:', error.message);
    res.status(502).json({ error: 'Failed to translate', details: error.message });
  }
}
