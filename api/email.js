export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url, hunterKey } = req.query;
  if (!url) return res.status(400).json({ error: 'url required' });

  const results = { emails: [], source: null, method: null };

  // ① Hunter.io domain search
  if (hunterKey) {
    try {
      let domain;
      try { domain = new URL(url).hostname.replace('www.', ''); } catch { domain = null; }
      if (domain) {
        const r = await fetch(
          `https://api.hunter.io/v2/domain-search?domain=${domain}&api_key=${hunterKey}&limit=5`,
          { signal: AbortSignal.timeout(6000) }
        );
        if (r.ok) {
          const d = await r.json();
          const emails = (d.data?.emails || []).map(e => e.value).filter(Boolean);
          if (emails.length > 0) {
            results.emails = emails;
            results.source = 'hunter';
            results.method = 'Hunter.io';
            return res.status(200).json(results);
          }
        }
      }
    } catch {}
  }

  // ② Scrape HP for email
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
  const HEADERS = { 'User-Agent': UA, 'Accept': 'text/html,*/*', 'Accept-Language': 'ja,en;q=0.9' };

  const VALID_TLDS = /\.(jp|com|net|org|co\.jp|or\.jp|ne\.jp|ac\.jp|go\.jp|io|info|biz|tokyo|osaka)$/i;

  function extractEmails(text) {
    const found = new Set();
    (text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || []).forEach(e => found.add(e.toLowerCase()));
    (text.match(/[a-zA-Z0-9._%+\-]+\s*[\[\(]?at[\]\)]?\s*[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/gi) || [])
      .forEach(e => found.add(e.replace(/\s*[\[\(]?at[\]\)]?\s*/i, '@').toLowerCase()));
    (text.match(/[a-zA-Z0-9._%+\-]+＠[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || [])
      .forEach(e => found.add(e.replace('＠', '@').toLowerCase()));
    const decoded = text.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
                        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    (decoded.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || []).forEach(e => found.add(e.toLowerCase()));
    (text.match(/mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi) || [])
      .forEach(e => found.add(e.replace(/^mailto:/i, '').toLowerCase()));

    const JUNK_DOMAINS = [
      'example.com','yourdomain','sentry.io','alayer','wixpress',
      'cloudflare','cloudflarein','addtoany','googleapis','gstatic',
      'fonts.gst','ic.com','w3.org','schema.org','jquery',
      'bootstrapcdn','fontawesome','unpkg.com','jsdelivr',
      'gravatar','wordpress.com','wp.com','shopify.com',
      'squarespace.com','wix.com','jimdo.com','amazonaws',
      'sentry','bugsnag','datadog','newrelic','segment.io',
    ];
    return [...found].filter(e => {
      if (!e.includes('@') || e.length > 80 || e.length < 6) return false;
      const [local, domain] = e.split('@');
      if (!domain || !local || !domain.includes('.')) return false;
      if (!VALID_TLDS.test(domain)) return false;
      if (e.match(/\.(png|jpg|gif|svg|webp|ico|css|js|ts|jsx|tsx|vue|php|html)(@|$)/i)) return false;
      if (JUNK_DOMAINS.some(x => domain.includes(x))) return false;
      if (local.length < 2 || local.match(/^[0-9]/)) return false;
      // local part should look like a real email (not random chars)
      if (local.length <= 2 && !['pr','hr','cs','biz','web','info','mail','contact','support','admin','sales','hello','hi','we','me','ko'].includes(local)) return false;
      return true;
    }).slice(0, 5);
  }

  async function fetchPage(url, timeout = 7000) {
    try {
      const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeout), redirect: 'follow' });
      if (!r.ok) return null;
      return r.text();
    } catch { return null; }
  }

  try {
    let targetUrl;
    try { targetUrl = new URL(url); } catch { return res.status(200).json({ emails: [], error: 'Invalid URL' }); }

    const mainHtml = await fetchPage(targetUrl.toString());
    if (!mainHtml) return res.status(200).json({ emails: [], error: 'ページ取得失敗' });

    let emails = extractEmails(mainHtml);

    if (emails.length === 0) {
      const paths = ['/contact','/contact.html','/contact/','/inquiry','/inquiry.html','/about','/about.html','/company','/company.html','/toiawase','/toiawase.html','/access','/access.html'];
      for (const path of paths) {
        const html = await fetchPage(new URL(path, targetUrl.origin).toString(), 5000);
        if (!html) continue;
        emails = extractEmails(html);
        if (emails.length > 0) break;
      }
    }

    if (emails.length === 0) {
      const links = (mainHtml.match(/href=["']([^"']*(?:contact|inquiry|toiawase|about|company)[^"']*)["']/gi) || []).slice(0, 5);
      for (const lm of links) {
        const href = lm.match(/href=["']([^"']+)["']/i)?.[1];
        if (!href) continue;
        try {
          const html = await fetchPage(new URL(href, targetUrl.origin).toString(), 5000);
          if (!html) continue;
          emails = extractEmails(html);
          if (emails.length > 0) break;
        } catch { continue; }
      }
    }

    results.emails = emails;
    results.source = 'scrape';
    results.method = emails.length > 0 ? 'HP解析' : null;
    return res.status(200).json(results);
  } catch (err) {
    return res.status(200).json({ emails: [], error: err.message });
  }
}
