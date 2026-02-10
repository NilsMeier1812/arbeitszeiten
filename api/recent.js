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

  const db = admin.firestore();

  try {
    // 2. Die letzten 10 Einträge holen (Sortierung: zeitstempel absteigend)
    const snapshot = await db.collection("zeiterfassung")
      .orderBy("zeitstempel", "desc")
      .limit(10)
      .get();

    const logs = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      let isoTime = null;

      // Zeitstempel sicher umwandeln
      if (data.zeitstempel && typeof data.zeitstempel.toDate === 'function') {
        isoTime = data.zeitstempel.toDate().toISOString();
      } else if (typeof data.zeitstempel === 'string') {
        isoTime = data.zeitstempel; // Falls es mal als String gespeichert wurde (alt)
      }

      logs.push({
        id: doc.id,
        status: data.status, // "KOMMEN" oder "GEHEN"
        time: isoTime
      });
    });

    return res.status(200).json(logs);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
