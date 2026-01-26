const admin = require("firebase-admin");

export default async function handler(req, res) {
  // 1. Initialisierung (Exakt wie beim cron.js)
  if (!admin.apps.length) {
    try {
      if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error("Key fehlt");
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } catch (e) {
      return res.status(500).json({ error: "Init Fehler" });
    }
  }

  const db = admin.firestore();

  // 2. Welchen Tag wollen wir? (Per URL-Parameter ?date=2026-01-26)
  // Wenn kein Datum kommt, nehmen wir "heute"
  const dateParam = req.query.date || new Date().toISOString().split('T')[0];

  try {
    // 3. Aus der "JSON" Collection lesen
    const doc = await db.collection("JSON").doc(dateParam).get();

    if (!doc.exists) {
      return res.status(404).json({ error: "Keine Daten für diesen Tag gefunden." });
    }

    // 4. Das saubere JSON zurückgeben
    return res.status(200).json(doc.data());

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
