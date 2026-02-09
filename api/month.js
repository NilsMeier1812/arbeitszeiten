const admin = require("firebase-admin");

export default async function handler(req, res) {
  // 1. Init
  if (!admin.apps.length) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } catch (e) {
      return res.status(500).json({ error: "Init Fehler" });
    }
  }

  // 2. Parameter lesen (z.B. ?year=2026&month=02)
  const { year, month } = req.query;
  
  if (!year || !month) {
    // Fallback: Aktueller Monat
    const now = new Date();
    return res.redirect(`/api/month?year=${now.getFullYear()}&month=${String(now.getMonth() + 1).padStart(2, '0')}`);
  }

  const startDate = `${year}-${month}-01`;
  const endDate = `${year}-${month}-31`; // Firestore ist das egal, wenn der Tag nicht existiert

  const db = admin.firestore();

  try {
    // 3. Range Query: Hole alle Berichte zwischen 01. und 31.
    // Da unsere Doc-IDs das Datum sind (YYYY-MM-DD), können wir direkt darauf filtern!
    const snapshot = await db.collection("tagesberichte")
      .where(admin.firestore.FieldPath.documentId(), '>=', startDate)
      .where(admin.firestore.FieldPath.documentId(), '<=', endDate)
      .get();

    const data = [];
    snapshot.forEach(doc => data.push(doc.data()));

    // Sortieren nach Datum
    data.sort((a, b) => a.datum.localeCompare(b.datum));

    return res.status(200).json(data);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
