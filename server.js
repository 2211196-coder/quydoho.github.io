const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Phục vụ các file tĩnh trong thư mục public
app.use(express.static(path.join(__dirname, 'public')));

// Cấu hình để parse JSON body
app.use(express.json());

// Proxy cho API lấy config OTA
app.use(
  '/api/ota',
  createProxyMiddleware({
    target: 'https://api.tenclass.net',
    changeOrigin: true,
    pathRewrite: {
      '^/api/ota': '/xiaozhi/ota/',
    },
    onProxyReq: (proxyReq, req, res) => {
      // Bổ sung các header cần thiết (forward từ client)
      if (req.headers['device-id']) proxyReq.setHeader('Device-Id', req.headers['device-id']);
      if (req.headers['client-id']) proxyReq.setHeader('Client-Id', req.headers['client-id']);
      if (req.headers['activation-version']) proxyReq.setHeader('Activation-Version', req.headers['activation-version']);
    }
  })
);

// Proxy cho API kích hoạt (Activate)
app.use(
  '/api/activate',
  createProxyMiddleware({
    target: 'https://api.tenclass.net',
    changeOrigin: true,
    pathRewrite: {
      '^/api/activate': '/xiaozhi/ota/activate',
    },
    onProxyReq: (proxyReq, req, res) => {
      if (req.headers['device-id']) proxyReq.setHeader('Device-Id', req.headers['device-id']);
      if (req.headers['client-id']) proxyReq.setHeader('Client-Id', req.headers['client-id']);
      if (req.headers['activation-version']) proxyReq.setHeader('Activation-Version', req.headers['activation-version']);
    }
  })
);

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
      
      // If Unauthorized (401), it's an API Key issue. Don't retry.
      if (lastStatus === 401) {
         throw new Error(`Groq API Key không hợp lệ hoặc đã bị khóa. Vui lòng vào Cài đặt để cập nhật API Key mới.`);
      }
      
      // Also if rate limit is reached for the whole org, not just the model, we might want to stop. But Groq limits are per model usually.
    } catch (err) {
      console.error(`[Groq Fallback] Fetch error for model ${model}:`, err.message);
      if (err.message.includes('API Key không hợp lệ')) throw err;
      lastErrorText = err.message;
    }
  }

  throw new Error(`Tất cả các model fallback đều gặp lỗi. Lỗi cuối cùng: Status ${lastStatus} - ${lastErrorText}`);
}

// API gợi ý câu trả lời từ Groq API
app.post('/api/suggest', async (req, res) => {
  const { messages, role, apiKey: clientApiKey, model: clientModel } = req.body;
  const apiKey = clientApiKey || process.env.GROQ_API_KEY || '';
  let initialModel = clientModel || process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
  if (initialModel === 'mixtral-8x7b-32768') {
    initialModel = 'llama-3.1-8b-instant';
  }

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Messages array is required' });
  }

  const systemPrompt = `You are an English conversation practice assistant.
Analyze the current conversation history between an English learner (user) and an AI chatbot acting as a ${role || 'partner'}.
Based on the context, provide between 3 and 5 natural, varied English response suggestions that the learner could say next.
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
    
    // Parse JSON từ response
    let parsedResult;
    try {
      parsedResult = JSON.parse(content);
    } catch (parseErr) {
      console.error('Failed to parse Groq response content:', content);
      parsedResult = { suggestions: [] };
    }

    res.json(parsedResult);
  } catch (error) {
    console.error('Error in /api/suggest:', error.message);
    res.status(502).json({ error: 'Failed to fetch suggestions from Groq API', details: error.message });
  }
});

// API dịch thuật từ Groq API
app.post('/api/translate', async (req, res) => {
  const { text, direction, apiKey: clientApiKey, model: clientModel } = req.body;
  const apiKey = clientApiKey || process.env.GROQ_API_KEY || '';
  let initialModel = clientModel || process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
  if (initialModel === 'mixtral-8x7b-32768') {
    initialModel = 'llama-3.1-8b-instant';
  }

  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }

  const systemPrompt = direction === 'vi2en' 
    ? "You are an expert English translator. Translate the following Vietnamese text to English accurately and naturally. Respond ONLY with the direct translation, nothing else. Do not use quotes, notes, or explanations."
    : "You are an expert Vietnamese translator. Translate the following English text to Vietnamese. The translation MUST be extremely natural, conversational, and context-appropriate (e.g., translate 'Good evening' as 'Chào buổi tối' instead of 'Tối tốt', 'check out' as 'trả phòng'). ABSOLUTELY DO NOT use any Chinese characters (Hanzi). Respond ONLY with the direct translation, nothing else. Do not use quotes, notes, or explanations.";

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
    res.json({ translation });
  } catch (error) {
    console.error('Error in /api/translate:', error.message);
    res.status(502).json({ error: 'Failed to translate', details: error.message });
  }
});


app.listen(PORT, () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}`);
});
