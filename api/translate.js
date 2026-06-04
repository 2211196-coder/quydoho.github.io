// Vercel Serverless Function — Translate text via Groq API

const FALLBACK_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'llama3-8b-8192',
  'llama3-70b-8192'
];

async function fetchGroqWithFallback(apiKey, initialModel, requestBodyBase) {
  let modelsToTry = [initialModel, ...FALLBACK_MODELS.filter(m => m !== initialModel)];
  let lastErrorText = "";
  let lastStatus = 500;

  for (const model of modelsToTry) {
    const requestBody = { ...requestBodyBase, model: model };
    try {
      const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (groqResponse.ok) {
        return await groqResponse.json();
      }

      lastStatus = groqResponse.status;
      lastErrorText = await groqResponse.text();
      console.warn(`[Groq Fallback] Model ${model} failed with ${lastStatus}: ${lastErrorText}`);
      
      if (lastStatus === 401) {
        throw new Error(`Groq API Key không hợp lệ hoặc đã bị khóa. Vui lòng vào Cài đặt để cập nhật API Key mới.`);
      }
    } catch (err) {
      console.error(`[Groq Fallback] Fetch error for model ${model}:`, err.message);
      if (err.message.includes('API Key không hợp lệ')) throw err;
      lastErrorText = err.message;
    }
  }

  throw new Error(`Tất cả các model fallback đều gặp lỗi. Lỗi cuối cùng: Status ${lastStatus} - ${lastErrorText}`);
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text, direction, apiKey: clientApiKey, model: clientModel } = req.body;
  const apiKey = clientApiKey || process.env.GROQ_API_KEY || '';
  let initialModel = clientModel || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  if (initialModel === 'mixtral-8x7b-32768') {
    initialModel = 'llama-3.3-70b-versatile';
  }

  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }

  const systemPrompt = direction === 'vi2en' 
    ? "You are an expert English translator. Translate the following Vietnamese text to English accurately and naturally. Respond ONLY with the direct translation, nothing else. Do not use quotes, notes, or explanations."
    : "You are an expert Vietnamese translator. Translate the following English text to Vietnamese. The translation MUST be extremely natural, conversational, and context-appropriate. ABSOLUTELY DO NOT use any Chinese characters (Hanzi). Respond ONLY with the direct translation, nothing else. Do not use quotes, notes, or explanations.";

  const requestBodyBase = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text }
    ],
    temperature: 0.2
  };

  try {
    const data = await fetchGroqWithFallback(apiKey, initialModel, requestBodyBase);
    const translation = data.choices[0].message.content.trim();
    
    res.status(200).json({ translation });
  } catch (error) {
    console.error('Error in Vercel translate function:', error.message);
    res.status(502).json({ error: 'Failed to translate', details: error.message });
  }
}
