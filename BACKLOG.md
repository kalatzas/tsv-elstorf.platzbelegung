# Backlog

Offene Aufgaben und Feature-Wünsche für den Platzbelegungsplaner.
Noch nicht umgesetzt – als Planung festgehalten.

## Einrichtung / Betrieb

- [ ] **Mailversand einrichten**
  - „Trigger Email"-Erweiterung installieren, Cloud Function deployen,
    Firestore-Regeln veröffentlichen.
  - Anleitung: `README.md`, Abschnitt „E-Mail-Benachrichtigungen
    einrichten".

## Anträge (Trainer / Co-Trainer)

- [ ] **Antragsformular überarbeiten**
  - Eingabereihenfolge: zuerst **Datum** auswählen, dann **Uhrzeit**,
    dann **Dauer**.
  - **Team nicht mehr abfragen** – ergibt sich aus dem angemeldeten
    Profil. (Offen: Verhalten, wenn ein Trainer mehreren Teams
    zugewiesen ist.)
  - Reihenfolge der Antragsart:
    1. Freundschaftsspiel
    2. Spielverlegung – **Begründung verpflichtend**
    3. Zusätzliches Training
    4. Turnier / Leistungsvergleich
    5. Trainingslager

- [ ] **Beantragte Termine im Plan anzeigen**
  - Beantragte Termine (jeder Art) sind für **alle sichtbar**, auch
    bevor sie freigegeben wurden.
  - Deutlich als **„Antrag"** gekennzeichnet, klar unterscheidbar von
    bereits freigegebenen Terminen.

- [ ] **Genehmigen / Ablehnen direkt in der Plan-Ansicht (Admin)**
  - Admin klickt im normalen Plan auf einen beantragten Termin → Popup.
  - Im Popup: genehmigen oder ablehnen.
  - Beim Genehmigen: **Kabinen zuweisen**, ggf. **Platz anpassen**.

## Ansicht / Bedienung

- [ ] **„Meine Einheiten" als Filter statt Popup**
  - Klick auf „Meine Einheiten" filtert die **gesamte Ansicht** auf die
    eigenen Einheiten (Training und alle anderen Arten).
  - Kein eigenes Popup mehr.

- [ ] **Icons oben rechts platzieren**
  - Personen-Icon (An-/Abmelden) und Glocken-Icon **ganz oben rechts**
    platzieren – nicht in der Button-Zeile mit Filter, „Meine
    Einheiten" usw.
