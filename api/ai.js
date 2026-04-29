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

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server API key not configured' });

  const { name, category, address, issues, memo, co, senderName, email, tel, svc, strengths } = promptData;

  const prompt = `法人向け営業コンテンツを日本語で生成してください。

送り先: ${name}（${category}、${address || '大阪'}）
推定課題: ${issues}
補足: ${memo || 'なし'}
自社: ${co} / 担当: ${senderName} / ${email} / ${tel}
サービス: ${svc}
強み: ${strengths}

【ルール】
- 相手の課題を直接指摘しない（「〜が不足」「〜の遅れ」はNG）
- 飲食・小売の個人店には「貴店」、それ以外は「貴社」を使う
- メール本文の末尾に必ず署名を入れる

以下のJSON形式のみで返してください:
{"s":"件名20字以内","b":"メール本文200字・敬語・署名込み","d":"SNS DM60字・カジュアル","t":"電話スクリプト100字・話し言葉"}`;

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'あなたは法人営業の専門家です。指定されたJSON形式のみで返答してください。説明文・コードブロック不要。' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 1000,
        response_format: { type: 'json_object' }
      })
    });

    if (!r.ok) {
      const t = await r.text();
      throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`);
    }

    const d = await r.json();
    const text = d.choices?.[0]?.message?.content || '';

    try {
      const parsed = JSON.parse(text);
      return res.status(200).json({
        subject: parsed.s || parsed.subject || '',
        body: parsed.b || parsed.body || '',
        dm: parsed.d || parsed.dm || '',
        tel: parsed.t || parsed.tel || ''
      });
    } catch {
      return res.status(200).json({ text, raw: true });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
