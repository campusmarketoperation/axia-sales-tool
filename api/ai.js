export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt, uid, plan } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server API key not configured' });

  const models = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
  let lastErr;

  for (const model of models) {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.8, maxOutputTokens: 1500 }
            })
          }
        );
        if (r.status === 503 || r.status === 429) {
          await new Promise(res => setTimeout(res, (i + 1) * 3000));
          lastErr = new Error(`HTTP ${r.status}`);
          continue;
        }
        if (!r.ok) { const t = await r.text(); throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`); }
        const d = await r.json();
        const text = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return res.status(200).json({ text });
      } catch (e) {
        if (e.message.startsWith('HTTP 503') || e.message.startsWith('HTTP 429')) {
          lastErr = e;
          await new Promise(res => setTimeout(res, (i + 1) * 3000));
          continue;
        }
        throw e;
      }
    }
  }
  return res.status(503).json({ error: lastErr?.message || 'AI service unavailable' });
}
