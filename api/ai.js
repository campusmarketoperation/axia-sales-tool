export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (!body) body = {};
  const { promptData } = body;
  if (!promptData) return res.status(400).json({ error: 'promptData required' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server API key not configured' });

  const { name, category, address, issues, memo, co, senderName, email, tel, svc, strengths } = promptData;

  const prompt = `法人向け営業メールと営業ツールを日本語で生成してください。

送り先企業: ${name}（${category}、${address || '大阪'}）
推定課題: ${issues}
自社情報: ${co} / 担当: ${senderName} / ${email} / ${tel}
提供サービス: ${svc}
強み: ${strengths}
補足: ${memo || 'なし'}

【重要なルール】
- 相手の課題や欠点を直接指摘しない（「〜が不足している」「〜の遅れ」などはNG）
- 「貴社のさらなる発展に貢献できれば」という前向きな表現を使う
- 飲食店・個人店には「貴社」ではなく「貴店」を使う
- メール本文の最後に必ず署名を入れる（${senderName} / ${co} / ${email} / ${tel}）
- カジュアルすぎず、丁寧すぎず、自然な敬語

以下のJSON形式で返してください（改行は\\nで表現・説明不要）:
{"s":"件名20字以内","b":"本文200字・敬語・署名込み","d":"DM60字・カジュアル","t":"電話トークスクリプト100字・話し言葉"}

JSONのみ返してください。`;

  const models = ['gemini-2.5-flash', 'gemini-2.5-flash-8b'];
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
              generationConfig: { temperature: 0.7, maxOutputTokens: 2000 }
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
          const jsonStr = clean.slice(st, en + 1);
          // Fix unescaped newlines inside JSON string values
          const fixedJson = jsonStr.replace(/:\s*"([\s\S]*?)"/g, (match, p1) => {
            const escaped = p1.replace(/\n/g, '\\n').replace(/\r/g, '').replace(/\t/g, '\\t');
            return ': "' + escaped + '"';
          });
          const parsed = JSON.parse(fixedJson);
          return res.status(200).json({
            subject: parsed.s || parsed.subject || '',
            body: (parsed.b || parsed.body || '').replace(/\\n/g, '\n'),
            dm: (parsed.d || parsed.dm || '').replace(/\\n/g, '\n'),
            tel: (parsed.t || parsed.tel || '').replace(/\\n/g, '\n')
          });
        } catch (parseErr) {
          // Last resort: return raw text
          console.error('Parse error:', parseErr.message, text.slice(0, 200));
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
