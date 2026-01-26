const admin = require("firebase-admin");

export default async function handler(req, res) {
  // Initialisierung (wie gehabt)
  if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }

  const db = admin.firestore();

  try {
    // Wir holen einfach ALLE Daten (oder die letzten 10)
    const snapshot = await db.collection("zeiterfassung").limit(10).get();

    const debugInfos = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      
      // Wir analysieren das Feld "zeitstempel"
      let zeitstempelWert = data.zeitstempel;
      let zeitstempelTyp = typeof data.zeitstempel;
      let isFirestoreTimestamp = false;

      // Prüfung: Ist es ein spezielles Firestore Timestamp Objekt?
      if (data.zeitstempel && typeof data.zeitstempel.toDate === 'function') {
        zeitstempelWert = data.zeitstempel.toDate().toISOString(); // Umwandeln in lesbaren String
        zeitstempelTyp = "Firestore Object (Class)";
        isFirestoreTimestamp = true;
      }

      debugInfos.push({
        id: doc.id,
        status: data.status,
        zeitstempel_roh: data.zeitstempel, // Was sieht Node.js wirklich?
        zeitstempel_typ: zeitstempelTyp,
        zeitstempel_konvertiert: zeitstempelWert
      });
    });

    // Wir geben das Ergebnis zurück, damit du es im Browser lesen kannst
    return res.status(200).json({
      nachricht: "Debug Modus - Zeige Rohdaten",
      anzahl_gefunden: snapshot.size,
      server_zeit_heute: new Date().toISOString().split('T')[0],
      daten: debugInfos
    });

  } catch (error) {
    return res.status(500).json({ error: error.message, stack: error.stack });
  }
}
