const admin = require("firebase-admin");

export default async function handler(req, res) {
  // 1. Initialisierung
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
    // 2. ALLE Daten aus der Zeiterfassung holen
    console.log("Lade alle Einträge...");
    const snapshot = await db.collection("zeiterfassung").get();
    
    // Wir gruppieren die Events erst mal nach Datum (YYYY-MM-DD)
    // Damit wir jeden Tag einzeln berechnen können.
    const eventsByDate = {};

    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.zeitstempel && typeof data.zeitstempel.toDate === 'function') {
        const dateObj = data.zeitstempel.toDate();
        // Wir nutzen das UTC-Datum als Schlüssel (wie im Cron-Job)
        const dateKey = dateObj.toISOString().split('T')[0];

        if (!eventsByDate[dateKey]) {
          eventsByDate[dateKey] = [];
        }

        eventsByDate[dateKey].push({
          id: doc.id,
          status: data.status,
          time: dateObj,
          millis: dateObj.getTime()
        });
      }
    });

    const results = [];
    const batchPromises = [];

    // 3. Jetzt jeden Tag einzeln durchgehen und berechnen
    for (const [dateString, rawEvents] of Object.entries(eventsByDate)) {
      
      // A) Sortieren
      rawEvents.sort((a, b) => a.millis - b.millis);

      // B) Der "Bus-Filter" (Identisch zum Cron-Script)
      const FILTER_THRESHOLD_MIN = 3.0;
      let cleanEvents = [];

      for (const event of rawEvents) {
        if (cleanEvents.length === 0) {
          cleanEvents.push(event);
          continue;
        }

        const lastValidEvent = cleanEvents[cleanEvents.length - 1];
        const diffMin = (event.millis - lastValidEvent.millis) / 1000 / 60;

        if (diffMin < FILTER_THRESHOLD_MIN && event.status !== lastValidEvent.status) {
          cleanEvents.pop(); // Letztes Event löschen (es war ungültig)
          // Das aktuelle Event ignorieren wir auch -> beide weg.
        } else {
          cleanEvents.push(event);
        }
      }

      // Wenn nach dem Filtern nichts übrig bleibt (z.B. nur Busfahrt an einem Samstag), überspringen
      if (cleanEvents.length === 0) continue;

      // C) Berechnung der Zeiten
      let workMinutes = 0;
      let breakMinutes = 0;
      let breaksList = [];
      let lastEvent = null;

      // Helfer für Formatierung (Deutsch)
      function formatTime(dateObj) {
        return dateObj.toLocaleTimeString('de-DE', { 
          hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin'
        });
      }

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

      // D) Datenpakete schnüren
      const summaryV1 = {
        datum: dateString,
        arbeitszeit_min: Math.round(workMinutes),
        pausen_min: Math.round(breakMinutes),
        start: cleanEvents[0].time.toISOString(),
        ende: cleanEvents[cleanEvents.length - 1].time.toISOString(),
        eintraege: cleanEvents.length,
        erstellt_am: admin.firestore.FieldValue.serverTimestamp(),
        // Markierung, dass es durch Recalc entstand
        via: "recalc_script"
      };

      const summaryV2 = {
        work_start: formatTime(cleanEvents[0].time),
        work_end: formatTime(cleanEvents[cleanEvents.length - 1].time),
        breaks: breaksList
      };

      // E) Speichern vorbereiten (Parallel für Speed)
      const p1 = db.collection("tagesberichte").doc(dateString).set(summaryV1);
      const p2 = db.collection("JSON").doc(dateString).set(summaryV2);
      
      batchPromises.push(p1, p2);

      results.push({
        datum: dateString,
        arbeit: Math.round(workMinutes),
        events_raw: rawEvents.length,
        events_clean: cleanEvents.length
      });
    }

    // 4. Alles auf einmal speichern warten
    await Promise.all(batchPromises);

    return res.status(200).json({
      success: true,
      message: `Habe ${Object.keys(eventsByDate).length} Tage analysiert und aktualisiert.`,
      details: results
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
