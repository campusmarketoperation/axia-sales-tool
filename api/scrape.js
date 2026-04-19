export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url parameter required' });

  // Validate URL
  let targetUrl;
  try {
    targetUrl = new URL(url);
    if (!['http:', 'https:'].includes(targetUrl.protocol)) throw new Error('invalid protocol');
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(targetUrl.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ja,en;q=0.9',
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(200).json({ emails: [], error: `HTTP ${response.status}` });
    }

    const html = await response.text();

    // Extract emails with multiple patterns
    const emailPatterns = [
      // Standard email pattern
      /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
      // mailto: links
      /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi,
      // Obfuscated with spaces (e.g. "info @ example.com")
      /[a-zA-Z0-9._%+\-]+\s*[@＠]\s*[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    ];

    const found = new Set();

    for (const pattern of emailPatterns) {
      const matches = html.match(pattern) || [];
      matches.forEach(m => {
        // Clean up
        const clean = m.replace(/^mailto:/i, '').replace(/\s/g, '').toLowerCase();
        // Filter out common false positives
        if (
          clean.includes('@') &&
          !clean.includes('example.com') &&
          !clean.includes('sentry.io') &&
          !clean.includes('@2x') &&
          !clean.includes('.png') &&
          !clean.includes('.jpg') &&
          !clean.includes('.gif') &&
          !clean.includes('.svg') &&
          !clean.match(/^\d/) &&
          clean.length < 80
        ) {
          found.add(clean);
        }
      });
    }

    // Also try contact/inquiry page if no emails found
    let contactEmails = [];
    if (found.size === 0) {
      const contactPaths = ['/contact', '/contact.html', '/inquiry', '/お問い合わせ', '/toiawase'];
      for (const path of contactPaths) {
        try {
          const contactUrl = new URL(path, targetUrl.origin);
          const cr = await fetch(contactUrl.toString(), {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(4000),
          });
          if (cr.ok) {
            const ch = await cr.text();
            const cm = ch.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || [];
            cm.forEach(m => {
              const clean = m.toLowerCase();
              if (!clean.includes('example') && clean.length < 80) contactEmails.push(clean);
            });
            if (contactEmails.length > 0) break;
          }
        } catch {}
      }
    }

    const allEmails = [...new Set([...found, ...contactEmails])].slice(0, 5);

    return res.status(200).json({
      emails: allEmails,
      count: allEmails.length,
      source: targetUrl.hostname,
    });

  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(200).json({ emails: [], error: 'タイムアウト（8秒）' });
    }
    return res.status(200).json({ emails: [], error: err.message });
  }
}
