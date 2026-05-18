# tsv-elstorf.platzbelegung

Platzbelegungsplaner für Fußballvereine — ein geteilter Belegungsplan für
Trainings- und Spielzeiten, nutzbar auf Handy und Desktop.

## Funktionen

- 5 Plätze, Zeitslots, Teams (U8–U19) mit anpassbaren Teamfarben, Kabinen
- 3 Ansichten: Tabelle, Kalender, Plätze
- Termintypen (Training, Pflichtspiel, Pokal …) und Serientermine
- CSV-/JSON-Export, JSON-Import, Drucken
- **Geteilter Cloud-Plan** über Firebase — alle Geräte sehen denselben Stand,
  Änderungen synchronisieren in Echtzeit
- **Lesen für alle offen; Benutzerkonten mit Rollen (Admin / Trainer / Co-Trainer)**
- **Trainer** können eigene Trainingseinheiten absagen („fällt aus") oder löschen
- **Antrags-Workflow**: Trainer beantragen Training, Trainingslager, Turnier,
  Freundschaftsspiel oder Spielverlegung — der Admin genehmigt oder lehnt ab
- **Benachrichtigungen** mit Glocken-Postfach (neue Anträge, Entscheidungen,
  abgesagte Einheiten) — optional als Browser-Hinweis und als E-Mail
- **Installierbar als App (PWA)** auf Handy-Homescreen und Desktop

## Bedienung

- Die App ist eine einzelne `index.html` und braucht keinen Build-Schritt.
- Solange Firebase nicht konfiguriert ist (`HIER_EINTRAGEN` in `index.html`),
  läuft die App im **lokalen Modus** — Daten nur auf dem jeweiligen Gerät.
- Nach der Firebase-Einrichtung (siehe unten) wird der Plan geteilt und
  synchronisiert.

## Firebase einrichten (geteilter Cloud-Plan)

Einmalig nötig, ca. 10 Minuten. Alle Schritte sind kostenlos (Gratis-Stufe).

### 1. Projekt anlegen

1. [console.firebase.google.com](https://console.firebase.google.com) öffnen,
   mit Google-Konto anmelden.
2. **„Projekt hinzufügen"** → Name vergeben (z. B. `tsv-elstorf-platzplan`) →
   Google Analytics kann deaktiviert werden → **„Projekt erstellen"**.

### 2. Firestore-Datenbank erstellen

1. Linke Leiste → **„Erstellen" → „Firestore Database"**.
2. **„Datenbank erstellen"** → Standort `eur3 (europe-west)` wählen.
3. Im **Produktionsmodus** starten (Regeln setzen wir in Schritt 5).

### 3. Web-App registrieren und Konfiguration kopieren

1. Projektübersicht → Symbol **`</>`** („Web-App hinzufügen").
2. Spitzname vergeben → **„App registrieren"**.
3. Es erscheint ein Block `const firebaseConfig = { ... }` mit `apiKey`,
   `authDomain`, `projectId` usw. **Diese Werte kopieren.**
   (Diese Werte sind nicht geheim — der Schutz läuft über die Regeln in
   Schritt 5.)

### 4. Konfiguration in `index.html` eintragen

In `index.html` oben im Skriptbereich den Block `firebaseConfig` durch die
kopierten Werte ersetzen. Außerdem `EDITOR_EMAIL` auf die gewünschte
Bearbeiter-E-Mail setzen:

```js
const firebaseConfig = {
    apiKey: "...",
    authDomain: "...",
    projectId: "...",
    storageBucket: "...",
    messagingSenderId: "...",
    appId: "..."
};
const BOOTSTRAP_ADMIN_EMAIL = "kosta@alatzas.de";
```

### 5. Anmeldung & Benutzerrollen einrichten

Die App nutzt echte Benutzerkonten mit Rollen (**Admin / Trainer /
Co-Trainer**) statt eines gemeinsamen Passworts.

1. Firebase-Konsole → **„Authentication" → „Erste Schritte"**.
2. Reiter **„Sign-in method"** → **„E-Mail/Passwort"** aktivieren.
3. Reiter **„Users" → „Nutzer hinzufügen"**:
   - E-Mail: exakt dieselbe wie `BOOTSTRAP_ADMIN_EMAIL` in `index.html`
   - Passwort: das persönliche Passwort des ersten Admins
4. Dieser erste Login legt automatisch das Admin-Profil an. Alle
   weiteren Trainer-/Co-Trainer-Konten werden danach **in der App**
   über **„Benutzer"** angelegt (Name, E-Mail, Start-Passwort, Rolle,
   Teams).

### 6. Sicherheitsregeln setzen

Firebase-Konsole → **„Firestore Database" → Reiter „Regeln"** — Inhalt durch
Folgendes ersetzen und **veröffentlichen** (E-Mail ggf. anpassen):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null; }
    function hasProfile() {
      return signedIn() &&
        exists(/databases/$(database)/documents/users/$(request.auth.uid));
    }
    function role() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role;
    }
    function isAdmin() { return hasProfile() && role() == 'admin'; }

    match /plans/{planId} {
      allow read: if true;
      // Admins ändern alles; Trainer/Co-Trainer dürfen nur Termine
      // ändern (Absagen/Löschen eigener Einheiten), nicht Sperren/Trainer.
      allow write: if isAdmin()
        || (hasProfile()
            && request.resource.data.closures == resource.data.closures
            && request.resource.data.trainers == resource.data.trainers);
    }
    match /users/{uid} {
      allow read: if signedIn();
      allow write: if isAdmin()
        || (signedIn() && request.auth.uid == uid
            && request.resource.data.role == 'admin'
            && request.resource.data.email == 'kosta@alatzas.de'
            && !exists(/databases/$(database)/documents/users/$(uid)));
    }
    match /requests/{id} {
      allow read: if signedIn();
      allow create: if hasProfile()
        && request.resource.data.requestedBy == request.auth.uid
        && request.resource.data.status == 'pending';
      allow update: if isAdmin();
      allow delete: if isAdmin()
        || (signedIn() && resource.data.requestedBy == request.auth.uid
            && resource.data.status == 'pending');
    }
    match /notifications/{id} {
      allow read: if signedIn() && resource.data.recipientUid == request.auth.uid;
      allow create: if signedIn();
      allow update, delete: if signedIn()
        && resource.data.recipientUid == request.auth.uid;
    }
    match /mail/{id} {
      // Nur die Cloud Function / die Trigger-Email-Erweiterung
      // (Admin-SDK) schreiben hier – Clients haben keinen Zugriff.
      allow read, write: if false;
    }
  }
}
```

Damit gilt: Der Plan ist für alle lesbar. Admins ändern alles;
Trainer/Co-Trainer dürfen ihre eigenen Trainingseinheiten absagen oder
löschen (Sperren und die Trainerliste bleiben Admins vorbehalten).
Anträge dürfen alle angemeldeten Nutzer stellen; entscheiden (genehmigen/
ablehnen) kann nur ein Admin. Benutzerprofile sind für angemeldete
Nutzer lesbar und nur von Admins veränderbar; die Sonderbedingung
erlaubt einmalig dem Bootstrap-Admin, sein Profil beim ersten Login
anzulegen. Benachrichtigungen kann jeder angemeldete Nutzer für andere
erstellen; lesen, als gelesen markieren und löschen kann sie nur der
jeweilige Empfänger.

## E-Mail-Benachrichtigungen einrichten (Firebase Trigger Email)

Zusätzlich zum Glocken-Postfach kann die App E-Mails verschicken
(neuer Antrag, Entscheidung, abgesagte/gelöschte Einheit, neues Konto).

Der Versand läuft **serverseitig** und ist so aufgebaut:

1. Die App legt bei einem Ereignis ein Dokument in der Sammlung
   `notifications` an (macht sie ohnehin für das Glocken-Postfach).
2. Eine **Cloud Function** (`functions/index.js`) reagiert darauf,
   ermittelt die E-Mail-Adresse aus dem `users`-Profil und schreibt ein
   Dokument in die Sammlung `mail`.
3. Die Firebase-Erweiterung **„Trigger Email"** verschickt dieses
   Dokument per SMTP über ein **Microsoft-Postfach**.

Die SMTP-Zugangsdaten liegen damit serverseitig, und die App-Clients
können weder Empfänger noch Inhalt der Mails frei bestimmen.

**Voraussetzung:** Das Firebase-Projekt muss im **Blaze-Tarif** sein
(Erweiterungen und Functions laufen über Cloud Functions). Bei diesem
Mail-Volumen entstehen praktisch keine Kosten – ein Budget-Alarm in der
Google Cloud Console wird trotzdem empfohlen.

### 1. Erweiterung „Trigger Email" installieren

1. Firebase-Konsole → **„Extensions"** → nach **„Trigger Email from
   Firestore"** suchen → **Installieren**.
2. Im Einrichtungsassistenten:
   - **SMTP-Verbindung:** Server `smtp.office365.com` (Microsoft 365)
     bzw. `smtp-mail.outlook.com` (privates Outlook.com), **Port 587**.
     Benutzername und Passwort des Microsoft-Postfachs angeben.
   - **Email documents collection:** `mail` (Standard so lassen).
   - **Default FROM address:** die Microsoft-Adresse, von der gesendet
     werden soll.
3. Installation abschließen.

Hinweis Microsoft: Für Microsoft 365 muss für das Postfach **„SMTP
AUTH" aktiviert** sein; für privates Outlook.com ein **App-Passwort**
(2-Faktor-Anmeldung vorausgesetzt) verwenden. Am besten ein eigenes,
nur dafür gedachtes Postfach nutzen.

### 2. Cloud Function bereitstellen

Die Function liegt im Ordner `functions/` dieses Repos.

1. Firebase-CLI installieren: `npm install -g firebase-tools`
2. Anmelden: `firebase login`
3. Abhängigkeiten installieren: `cd functions && npm install && cd ..`
4. Bereitstellen: `firebase deploy --only functions`

Die `APP_URL` in `functions/index.js` ggf. auf die echte Adresse der
App anpassen.

### 3. Firestore-Regeln

Die `mail`-Sammlung ist in den Sicherheitsregeln (Schritt 6) bereits
für Clients gesperrt – nur die Function und die Erweiterung (Admin-SDK)
schreiben dort. Sicherstellen, dass die aktuellen Regeln veröffentlicht
sind.

Solange die Erweiterung nicht installiert bzw. die Function nicht
bereitgestellt ist, funktioniert die App normal weiter – es werden dann
nur keine E-Mails versendet.

## Als App installieren (PWA)

Die App wird über eine HTTPS-URL aufgerufen (z. B. GitHub Pages: in den
Repository-Einstellungen unter **Pages** den Branch als Quelle wählen).

- **Android (Chrome):** Menü → „App installieren" / „Zum Startbildschirm".
- **iPhone (Safari):** Teilen-Symbol → „Zum Home-Bildschirm".
- **Desktop (Chrome/Edge):** Installations-Symbol in der Adressleiste.

## Ausblick: Echte Store-App

Diese Web-App lässt sich später mit [Capacitor](https://capacitorjs.com/) für
Google Play und Apple App Store verpacken — dieselbe Codebasis, ohne
Neuentwicklung.
