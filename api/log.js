const admin = require("firebase-admin");

export default async function handler(req, res) {
  // 1. Init (wie gehabt)
  if (!admin.apps.length) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } catch (e) {
      return res.status(500).json({ error: "Init Error" });
    }
  }

  // 2. Sicherheit
  if (req.query.secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // 3. Daten empfangen (Wir erwarten einfaches JSON)
  const { status, timestamp } = req.body;

  if (!status || !timestamp) {
    return res.status(400).json({ error: "Missing data" });
  }

  try {
    const db = admin.firestore();
    
    // In Firestore speichern (wir wandeln den String wieder in ein Date-Objekt um)
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
