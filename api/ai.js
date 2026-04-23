export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { promptData } = req.body || {};
  if (!promptData) return res.status(400).json({ error: 'promptData required' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server API key not configured' });

  const { name, category, address, issues, memo, co, senderName, email, tel, svc, strengths } = promptData;

  const prompt = `あなたは法人営業の専門家です。以下の企業への営業コンテンツを日本語で生成してください。

企業名: ${name}
業種: ${category}
住所: ${address || '大阪'}
課題: ${issues}
補足: ${memo || 'なし'}
自社名: ${co} / 担当: ${senderName} / ${email} / ${tel}
サービス: ${svc}
強み: ${strengths}

以下の4つをそれぞれ生成してください:
1. メール件名（25字以内・自然な日本語）
2. メール本文（250字前後・丁寧な敬語・末尾に署名）
3. SNS DM文（80字以内・カジュアル）
4. 電話トークスクリプト（150字前後・話し言葉・冒頭の挨拶から）

必ずこのJSON形式のみで返してください（説明文・コードブロック不要）:
{"s":"件名","b":"本文","d":"DM","t":"電話スクリプト"}`;

  const models = ['gemini-2.5-flash', 'gemini-2.0-flash'];
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
              generationConfig: { 
                temperature: 0.7, 
                maxOutputTokens: 2000,
                responseMimeType: 'application/json'
              }
            })
          }
        );
        if (r.status === 503 || r.status === 429) {
          await new Promise(resolve => setTimeout(resolve, (i + 1) * 3000));
          lastErr = new Error(`HTTP ${r.status}`);
          continue;
        }
        if (!r.ok) { const t = await r.text(); throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`); }
        const d = await r.json();
        const text = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
        
        // Parse JSON on server side
        try {
          const clean = text.replace(/```json|```/g, '').trim();
          const st = clean.indexOf('{'), en = clean.lastIndexOf('}');
          const parsed = JSON.parse(clean.slice(st, en + 1));
          return res.status(200).json({
            subject: parsed.s || parsed.subject || '',
            body: parsed.b || parsed.body || '',
            dm: parsed.d || parsed.dm || '',
            tel: parsed.t || parsed.tel || ''
          });
        } catch (parseErr) {
          return res.status(200).json({ text, raw: true });
        }
      } catch (e) {
        if (e.message.startsWith('HTTP 503') || e.message.startsWith('HTTP 429')) {
          lastErr = e;
          await new Promise(resolve => setTimeout(resolve, (i + 1) * 3000));
          continue;
        }
        throw e;
      }
    }
  }
  return res.status(503).json({ error: lastErr?.message || 'AI service unavailable' });
}
