const admin = require("firebase-admin");

export default async function handler(req, res) {
  // --- 1. Initialisierung ---
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
    // --- 2. Rohdaten holen ---
    const todayString = new Date().toISOString().split('T')[0];
    const snapshot = await db.collection("zeiterfassung").get();
    
    let rawEvents = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.zeitstempel && typeof data.zeitstempel.toDate === 'function') {
        const dateObj = data.zeitstempel.toDate();
        if (dateObj.toISOString().startsWith(todayString)) {
          rawEvents.push({
            id: doc.id,
            status: data.status, // "KOMMEN" oder "GEHEN"
            time: dateObj,
            millis: dateObj.getTime()
          });
        }
      }
    });

    // Chronologisch sortieren
    rawEvents.sort((a, b) => a.millis - b.millis);

    // --- NEU: DER "BUS-FILTER" (Liste bereinigen) ---
    // Wir bauen eine neue Liste "cleanEvents". 
    // Wenn ein Event das vorherige extrem schnell aufhebt, löschen wir beide.
    
    const FILTER_THRESHOLD_MIN = 2.0; // Toleranz in Minuten (Busfahrt etc.)
    let cleanEvents = [];

    for (const event of rawEvents) {
      // Wenn Liste leer, erst mal hinzufügen (z.B. das erste KOMMEN)
      if (cleanEvents.length === 0) {
        cleanEvents.push(event);
        continue;
      }

      const lastValidEvent = cleanEvents[cleanEvents.length - 1];
      const diffMin = (event.millis - lastValidEvent.millis) / 1000 / 60;

      // PRÜFUNG: Ist das neue Event sehr kurz nach dem letzten?
      // UND: Ist es ein Gegenteil? (Also KOMMEN->GEHEN oder GEHEN->KOMMEN)
      if (diffMin < FILTER_THRESHOLD_MIN && event.status !== lastValidEvent.status) {
        
        // JA! Das war eine "Vorbeifahrt" oder ein GPS-Fehler.
        // Strategie: Wir tun so, als wären BEIDE nie passiert.
        
        // 1. Wir entfernen das letzte Event aus der sauberen Liste (Pop)
        cleanEvents.pop();
        
        // 2. Wir fügen das aktuelle Event ("event") gar nicht erst hinzu.
        // -> Ergebnis: Beide löschen sich gegenseitig aus.

      } else {
        // Nein, alles normal (oder Zeitabstand groß genug). Hinzufügen.
        cleanEvents.push(event);
      }
    }

    // Checken ob nach dem Filtern noch was übrig ist
    if (cleanEvents.length === 0) {
      return res.status(200).json({ message: "Keine validen Daten für heute (alles ausgefiltert)." });
    }

    // --- HELFER: Uhrzeit formatieren ---
    function formatTime(dateObj) {
      return dateObj.toLocaleTimeString('de-DE', { 
        hour: '2-digit', 
        minute: '2-digit', 
        timeZone: 'Europe/Berlin'
      });
    }

    // --- 3. Berechnungen (jetzt mit der SAUBEREN Liste) ---
    let workMinutes = 0;
    let breakMinutes = 0;
    let breaksList = []; 
    let lastEvent = null;

    for (const event of cleanEvents) {
      if (lastEvent) {
        const diffMin = (event.millis - lastEvent.millis) / 1000 / 60;
        
        if (lastEvent.status === "KOMMEN" && event.status === "GEHEN") {
          workMinutes += diffMin;
        } else if (lastEvent.status === "GEHEN" && event.status === "KOMMEN") {
          breakMinutes += diffMin;
          breaksList.push({
            start: formatTime(lastEvent.time),
            end: formatTime(event.time)
          });
        }
      }
      lastEvent = event;
    }

    // --- 4. Speichern ---
    const summaryV1 = {
      datum: todayString,
      arbeitszeit_min: Math.round(workMinutes),
      pausen_min: Math.round(breakMinutes),
      start: cleanEvents[0].time.toISOString(),
      ende: cleanEvents[cleanEvents.length - 1].time.toISOString(),
      eintraege: cleanEvents.length,
      erstellt_am: admin.firestore.FieldValue.serverTimestamp()
    };
    
    await db.collection("tagesberichte").doc(todayString).set(summaryV1);

    const summaryV2 = {
      work_start: formatTime(cleanEvents[0].time),
      work_end: formatTime(cleanEvents[cleanEvents.length - 1].time),
      breaks: breaksList
    };

    await db.collection("JSON").doc(todayString).set(summaryV2);

    return res.status(200).json({
      success: true,
      message: "Bus-Filter aktiv (" + FILTER_THRESHOLD_MIN + " Min)",
      gefilterte_events: cleanEvents.length,
      original_events: rawEvents.length,
      format_2: summaryV2
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message, stack: error.stack });
  }
}
