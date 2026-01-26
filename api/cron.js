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
    // --- 2. Daten holen ---
    const todayString = new Date().toISOString().split('T')[0];
    
    const snapshot = await db.collection("zeiterfassung").get();
    
    let events = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.zeitstempel && typeof data.zeitstempel.toDate === 'function') {
        const dateObj = data.zeitstempel.toDate();
        if (dateObj.toISOString().startsWith(todayString)) {
          events.push({
            id: doc.id,
            status: data.status,
            time: dateObj,
            millis: dateObj.getTime()
          });
        }
      }
    });

    events.sort((a, b) => a.millis - b.millis);

    if (events.length === 0) {
      return res.status(200).json({ message: "Keine Daten für heute." });
    }

    // --- HELFER: Uhrzeit formatieren (HH:MM) für Deutschland ---
    function formatTime(dateObj) {
      return dateObj.toLocaleTimeString('de-DE', { 
        hour: '2-digit', 
        minute: '2-digit', 
        timeZone: 'Europe/Berlin' // Wichtig, damit es deutsche Zeit ist!
      });
    }

    // --- 3. Berechnungen & Listen bauen ---
    let workMinutes = 0;
    let breakMinutes = 0;
    let lastEvent = null;
    let breaksList = []; // Hier sammeln wir die Pausenzeiten für Format 2

    for (const event of events) {
      if (lastEvent) {
        const diffMin = (event.millis - lastEvent.millis) / 1000 / 60;
        
        if (lastEvent.status === "KOMMEN" && event.status === "GEHEN") {
          workMinutes += diffMin;
        } else if (lastEvent.status === "GEHEN" && event.status === "KOMMEN") {
          breakMinutes += diffMin;
          
          // Für Format 2: Pause erfassen
          breaksList.push({
            start: formatTime(lastEvent.time),
            end: formatTime(event.time)
          });
        }
      }
      lastEvent = event;
    }

    // --- 4. Speichern: Format 1 (Tagesbericht) ---
    const summaryV1 = {
      datum: todayString,
      arbeitszeit_min: Math.round(workMinutes),
      pausen_min: Math.round(breakMinutes),
      start: events[0].time.toISOString(),
      ende: events[events.length - 1].time.toISOString(),
      eintraege: events.length,
      erstellt_am: admin.firestore.FieldValue.serverTimestamp()
    };
    
    await db.collection("tagesberichte").doc(todayString).set(summaryV1);

    // --- 5. Speichern: Format 2 (Dein JSON-Wunsch) ---
    // Wir nehmen die Zeit vom allerersten Event als Arbeitsbeginn
    // und die Zeit vom allerletzten als Arbeitsende
    const summaryV2 = {
      work_start: formatTime(events[0].time),
      work_end: formatTime(events[events.length - 1].time),
      breaks: breaksList
    };

    // Speichern in Collection "JSON" unter dem Dokument "2026-01-26"
    await db.collection("JSON").doc(todayString).set(summaryV2);

    // --- 6. Antwort ---
    return res.status(200).json({
      success: true,
      message: "Beide Formate gespeichert",
      format_1: summaryV1,
      format_2: summaryV2
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message, stack: error.stack });
  }
}
