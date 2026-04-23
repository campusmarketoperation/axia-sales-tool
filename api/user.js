import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    initFirebase();
    const auth = getAuth();
    const db = getFirestore();
    const decoded = await auth.verifyIdToken(token);
    const uid = decoded.uid;

    if (req.method === 'GET') {
      const doc = await db.collection('users').doc(uid).get();
      const data = doc.exists ? doc.data() : { plan: 'starter', email: decoded.email };
      return res.status(200).json({ uid, plan: data.plan || 'starter', email: data.email || decoded.email });
    }

    if (req.method === 'POST') {
      const { pros, cfg } = req.body || {};
      const updates = {};
      if (pros !== undefined) updates.pros = pros;
      if (cfg !== undefined) updates.cfg = cfg;
      updates.updatedAt = new Date().toISOString();
      await db.collection('users').doc(uid).set(updates, { merge: true });
      return res.status(200).json({ success: true });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
