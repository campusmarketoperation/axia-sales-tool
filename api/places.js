export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { query } = req.body || {};
  if (!query) return res.status(400).json({ error: 'query required' });

  const apiKey = process.env.PLACES_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server API key not configured' });

  try {
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.businessStatus'
      },
      body: JSON.stringify({ textQuery: query, languageCode: 'ja', maxResultCount: 10 })
    });
    if (!r.ok) { const t = await r.text(); throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`); }
    const d = await r.json();
    const places = (d.places || [])
      .filter(p => p.businessStatus === 'OPERATIONAL' || !p.businessStatus)
      .map(p => ({
        name: p.displayName?.text || '',
        address: p.formattedAddress || '',
        tel: p.nationalPhoneNumber || '',
        url: p.websiteUri || '',
        rating: p.rating || null,
        reviewCount: p.userRatingCount || 0
      }));
    return res.status(200).json({ places });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
