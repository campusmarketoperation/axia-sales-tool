import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function initFirebase() {
  if (getApps().length > 0) return;
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    })
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { uid, action, plan } = req.method === 'GET' ? req.query : (req.body || {});
  if (!uid) return res.status(400).json({ error: 'uid required' });

  try {
    initFirebase();
    const db = getFirestore();
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const ref = db.collection('usage').doc(`${uid}_${monthKey}`);

    if (req.method === 'GET') {
      const doc = await ref.get();
      const data = doc.exists ? doc.data() : { searches: 0, generations: 0 };
      const isPro = plan === 'pro';
      const limit = isPro ? Infinity : 30;
      return res.status(200).json({
        searches: data.searches || 0,
        generations: data.generations || 0,
        limit,
        searchesLeft: isPro ? 999 : Math.max(0, limit - (data.searches || 0)),
        generationsLeft: isPro ? 999 : Math.max(0, limit - (data.generations || 0)),
      });
    }

    if (req.method === 'POST' && action) {
      const doc = await ref.get();
      const data = doc.exists ? doc.data() : { searches: 0, generations: 0 };
      const isPro = plan === 'pro';
      const limit = 30;

      if (!isPro) {
        const current = action === 'search' ? (data.searches || 0) : (data.generations || 0);
        if (current >= limit) {
          return res.status(429).json({ error: 'LIMIT_EXCEEDED', message: '月間利用上限に達しました。Proプランにアップグレードしてください。' });
        }
      }

      await ref.set({
        searches: action === 'search' ? (data.searches || 0) + 1 : (data.searches || 0),
        generations: action === 'generate' ? (data.generations || 0) + 1 : (data.generations || 0),
        uid, monthKey, updatedAt: now.toISOString()
      }, { merge: true });

      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Invalid request' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
