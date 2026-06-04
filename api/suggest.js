// Vercel Serverless Function — Suggest English replies via Groq API

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

  const { messages, role, apiKey: clientApiKey, model: clientModel } = req.body;
  const apiKey = clientApiKey || process.env.GROQ_API_KEY || '';
  let initialModel = clientModel || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  if (initialModel === 'mixtral-8x7b-32768') {
    initialModel = 'llama-3.3-70b-versatile';
  }

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Messages array is required' });
  }

  const systemPrompt = `You are an English conversation practice assistant.
Analyze the current conversation history between an English learner (user) and an AI chatbot acting as a ${role || 'partner'}.
Based on the context, provide exactly 3 natural, varied English response suggestions that the learner could say next.
Each suggestion must:
1. Be grammatically correct and natural for the context.
2. Help advance the conversation in a meaningful way.
3. Include a Vietnamese translation for the learner.

Respond ONLY with a JSON object in this exact schema:
{
  "suggestions": [
    { "en": "English response suggestion", "vi": "Bản dịch tiếng Việt tương ứng" }
  ]
}`;

  const requestBodyBase = {
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages
    ],
    temperature: 0.7,
    response_format: { type: 'json_object' }
  };

  try {
    const data = await fetchGroqWithFallback(apiKey, initialModel, requestBodyBase);
    const content = data.choices[0].message.content;
    
    let parsedResult;
    try {
      parsedResult = JSON.parse(content);
    } catch (parseErr) {
      console.error('Failed to parse Groq content (Vercel):', content);
      parsedResult = { suggestions: [] };
    }

    res.status(200).json(parsedResult);
  } catch (error) {
    console.error('Error in Vercel suggest function:', error.message);
    res.status(502).json({ error: 'Failed to fetch suggestions from Groq API', details: error.message });
  }
}
