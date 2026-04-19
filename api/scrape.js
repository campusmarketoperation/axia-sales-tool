export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url required' });

  let targetUrl;
  try {
    targetUrl = new URL(url);
    if (!['http:', 'https:'].includes(targetUrl.protocol)) throw new Error('invalid');
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
  const HEADERS = { 'User-Agent': UA, 'Accept': 'text/html,*/*', 'Accept-Language': 'ja,en;q=0.9' };

  function extractEmails(text) {
    const found = new Set();

    // 1. Standard
    (text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || [])
      .forEach(e => found.add(e.toLowerCase()));

    // 2. Obfuscated [at] (at)
    (text.match(/[a-zA-Z0-9._%+\-]+\s*[\[\(]?at[\]\)]?\s*[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/gi) || [])
      .forEach(e => found.add(e.replace(/\s*[\[\(]?at[\]\)]?\s*/i, '@').toLowerCase()));

    // 3. Full-width @
    (text.match(/[a-zA-Z0-9._%+\-]+＠[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || [])
      .forEach(e => found.add(e.replace('＠', '@').toLowerCase()));

    // 4. HTML entity decoded
    const decoded = text
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    (decoded.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || [])
      .forEach(e => found.add(e.toLowerCase()));

    // 5. mailto href
    (text.match(/mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi) || [])
      .forEach(e => found.add(e.replace(/^mailto:/i, '').toLowerCase()));

    return [...found].filter(e =>
      e.includes('@') && e.length < 80 &&
      !e.match(/\.(png|jpg|gif|svg|webp|ico|css|js)$/i) &&
      !e.includes('example.com') && !e.includes('yourdomain') &&
      !e.includes('sentry') && !e.match(/^[0-9]/)
    ).slice(0, 5);
  }

  async function fetchPage(url, timeout = 8000) {
    try {
      const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeout), redirect: 'follow' });
      if (!r.ok) return null;
      return r.text();
    } catch { return null; }
  }

  try {
    const mainHtml = await fetchPage(targetUrl.toString());
    if (!mainHtml) return res.status(200).json({ emails: [], error: 'ページ取得失敗' });

    let emails = extractEmails(mainHtml);

    // Try contact/inquiry pages if no email found
    if (emails.length === 0) {
      const paths = [
        '/contact', '/contact.html', '/contact/',
        '/inquiry', '/inquiry.html',
        '/about', '/about.html',
        '/company', '/company.html',
        '/toiawase', '/toiawase.html',
        '/access', '/access.html',
      ];
      for (const path of paths) {
        const html = await fetchPage(new URL(path, targetUrl.origin).toString(), 5000);
        if (!html) continue;
        const found = extractEmails(html);
        if (found.length > 0) { emails = found; break; }
      }
    }

    // Try links containing contact-related keywords
    if (emails.length === 0) {
      const links = (mainHtml.match(/href=["']([^"']*(?:contact|inquiry|toiawase|about|company)[^"']*)["']/gi) || []).slice(0, 5);
      for (const lm of links) {
        const href = lm.match(/href=["']([^"']+)["']/i)?.[1];
        if (!href) continue;
        try {
          const html = await fetchPage(new URL(href, targetUrl.origin).toString(), 5000);
          if (!html) continue;
          const found = extractEmails(html);
          if (found.length > 0) { emails = found; break; }
        } catch { continue; }
      }
    }

    return res.status(200).json({ emails, count: emails.length, source: targetUrl.hostname });
  } catch (err) {
    return res.status(200).json({ emails: [], error: err.message });
  }
}
