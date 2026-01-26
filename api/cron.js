const admin = require("firebase-admin");

export default async function handler(req, res) {
  // 1. Initialisierung (Standard Vercel/Firebase Setup)
  if (!admin.apps.length) {
    try {
      if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error("Key fehlt");
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } catch (e) {
      return res.status(500).json({ error: "Init Fehler", details: e.message });
    }
  }

  const db = admin.firestore();

  try {
    // 2. Datum von heute bestimmen (Serverzeit)
    const todayString = new Date().toISOString().split('T')[0]; // "2026-01-26"
    
    // 3. Alle Daten holen (wir filtern gleich im Code)
    const snapshot = await db.collection("zeiterfassung").get();
    
    let events = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      
      // WICHTIG: Prüfung, ob das Feld existiert und ein Timestamp-Objekt ist
      if (data.zeitstempel && typeof data.zeitstempel.toDate === 'function') {
        const dateObj = data.zeitstempel.toDate();
        const dateIso = dateObj.toISOString(); // z.B. "2026-01-26T12:31:17.000Z"

        // Nur Einträge von HEUTE behalten
        if (dateIso.startsWith(todayString)) {
          events.push({
            id: doc.id,
            status: data.status, // Ist direkt "KOMMEN" oder "GEHEN"
            time: dateObj,
            millis: dateObj.getTime()
          });
        }
      }
    });

    // 4. Sortieren (Chronologisch: Morgens -> Abends)
    events.sort((a, b) => a.millis - b.millis);

    if (events.length === 0) {
      return res.status(200).json({ message: "Keine Daten für heute (" + todayString + ") gefunden." });
    }

    // 5. Berechnung der Zeiten
    let workMinutes = 0;
    let breakMinutes = 0;
    let lastEvent = null;
    let log = []; // Für Debugging-Zwecke im JSON

    for (const event of events) {
      if (lastEvent) {
        const diffMin = (event.millis - lastEvent.millis) / 1000 / 60;
        
        if (lastEvent.status === "KOMMEN" && event.status === "GEHEN") {
          // Das war Arbeitszeit
          workMinutes += diffMin;
          log.push(`Arbeit: ${diffMin.toFixed(1)} Min`);
        } else if (lastEvent.status === "GEHEN" && event.status === "KOMMEN") {
          // Das war Pause
          breakMinutes += diffMin;
          log.push(`Pause: ${diffMin.toFixed(1)} Min`);
        }
      }
      lastEvent = event;
    }

    // 6. Das Ergebnis speichern (in neue Collection 'tagesberichte')
    const summary = {
      datum: todayString,
      arbeitszeit_min: Math.round(workMinutes),
      pausen_min: Math.round(breakMinutes),
      start: events[0].time.toISOString(),
      ende: events[events.length - 1].time.toISOString(),
      eintraege: events.length,
      erstellt_am: admin.firestore.FieldValue.serverTimestamp()
    };

    // Wir nutzen .set(), das überschreibt den Eintrag für heute, falls man das Skript 2x aufruft
    await db.collection("tagesberichte").doc(todayString).set(summary);

    // 7. Antwort an den Browser senden
    return res.status(200).json({
      success: true,
      ergebnis: summary,
      debug_ablauf: log
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message, stack: error.stack });
  }
}
