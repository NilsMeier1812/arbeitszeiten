const admin = require("firebase-admin");

export default async function handler(req, res) {
  // 1. Init
  if (!admin.apps.length) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } catch (e) {
      return res.status(500).json({ error: "Init Error: " + e.message });
    }
  }

  // 2. Daten empfangen
  // WICHTIG: Wir holen Daten aus req.body
  const { status, timestamp } = req.body;

  if (!status || !timestamp) {
    return res.status(400).json({ error: "Daten fehlen (status oder timestamp)" });
  }

  try {
    const db = admin.firestore();
    
    // 3. Speichern
    await db.collection("zeiterfassung").add({
      status: status,
      zeitstempel: admin.firestore.Timestamp.fromDate(new Date(timestamp)),
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
