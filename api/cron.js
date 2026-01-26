const admin = require("firebase-admin");

// Wir lesen den Key aus den Vercel Environment Variables
// (Dazu kommen wir gleich in Schritt 3)
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (error) {
    console.error("Firebase Init Error:", error);
  }
}

const db = admin.firestore();

export default async function handler(req, res) {
  // 1. Sicherheit: Kleiner Schutz, damit nicht jeder die Berechnung auslöst
  if (req.query.secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const today = new Date().toISOString().split('T')[0]; // "2026-01-26"
  
  try {
    // 2. Rohdaten holen (Logik wie besprochen)
    // Wir holen alle Dokumente und filtern im Code nach Datum (String-Vergleich)
    const snapshot = await db.collection("zeiterfassung").get();
    
    let events = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      // Prüfen, ob der Zeitstempel-String mit dem heutigen Datum beginnt
      // Format in DB: "2026-01-26T14:00:00Z"
      const tsValue = data.zeitstempel.timestampValue || data.zeitstempel; // Fallback
      
      if (typeof tsValue === 'string' && tsValue.startsWith(today)) {
        events.push({
           status: data.status.stringValue || data.status, // Fallback je nach Speicherformat
           time: new Date(tsValue),
           id: doc.id
        });
      }
    });

    // Chronologisch sortieren
    events.sort((a, b) => a.time - b.time);

    if (events.length === 0) {
      return res.status(200).json({ message: "Keine Daten für heute." });
    }

    // 3. Pausen berechnen
    let workMinutes = 0;
    let breakMinutes = 0;
    let lastEvent = null;

    for (const event of events) {
      if (lastEvent) {
        const diffMin = (event.time - lastEvent.time) / 1000 / 60;
        
        if (lastEvent.status === "KOMMEN" && event.status === "GEHEN") {
          workMinutes += diffMin;
        } else if (lastEvent.status === "GEHEN" && event.status === "KOMMEN") {
          breakMinutes += diffMin;
        }
      }
      lastEvent = event;
    }

    // 4. Ergebnis speichern
    const summary = {
      datum: today,
      arbeitszeit_min: Math.round(workMinutes),
      pausen_min: Math.round(breakMinutes),
      start: events[0].time.toISOString(),
      ende: events[events.length - 1].time.toISOString(),
      calculated_at: new Date().toISOString()
    };

    await db.collection("tagesberichte").doc(today).set(summary);

    return res.status(200).json({ success: true, data: summary });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
