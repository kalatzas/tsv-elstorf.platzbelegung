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
  abgesagte Einheiten) — optional als Browser-Hinweis und als E-Mail (EmailJS)
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
const BOOTSTRAP_ADMIN_EMAIL = "bearbeiter@tsv-elstorf.de";
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
            && request.resource.data.email == 'bearbeiter@tsv-elstorf.de'
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

## E-Mail-Benachrichtigungen einrichten (optional, EmailJS)

Zusätzlich zum Glocken-Postfach kann die App E-Mails verschicken
(neuer Antrag, Entscheidung, abgesagte/gelöschte Einheit, neues Konto).
Der Versand läuft über **EmailJS** mit einem **Outlook/Microsoft-Konto**.
Solange unten `HIER_EINTRAGEN` steht, werden einfach keine Mails
verschickt – die App funktioniert unverändert weiter.

### 1. EmailJS-Konto und Outlook verbinden

1. Auf [emailjs.com](https://www.emailjs.com) kostenlos registrieren.
2. **„Email Services" → „Add New Service" → „Outlook"** wählen, mit dem
   Microsoft-Konto anmelden und die Freigabe erteilen. Mails werden
   später von der Adresse dieses Kontos versendet.
3. Die **Service-ID** notieren.

### 2. Vorlage (Template) anlegen

**„Email Templates" → „Create New Template"** und folgende Felder setzen:

- **To Email:** `{{to_email}}`
- **Subject:** `{{subject}}`
- **Content:** `{{message}}` (als reinen Text belassen; bei einer
  HTML-Vorlage `{{message}}` mit doppelten Klammern verwenden – so wird
  der Inhalt automatisch escaped)

Die **Template-ID** notieren.

### 3. Public Key und Missbrauchsschutz

1. Unter **„Account"** den **Public Key** kopieren.
2. Unter **„Account" → „Security"** bei **„Allowed Origins"** die
   Adresse der App eintragen (z. B. die GitHub-Pages-URL). **Wichtig:**
   Das verhindert, dass Fremde über das Konto Mails versenden.

### 4. Werte in `index.html` eintragen

Im Block `emailjsConfig` die drei Werte eintragen und `APP_URL` auf die
echte Adresse der App setzen:

```js
const emailjsConfig = {
    publicKey:  "dein_public_key",
    serviceId:  "dein_service_id",
    templateId: "dein_template_id"
};
const APP_URL = "https://.../tsv-elstorf.platzbelegung/";
```

Hinweis: Public Key, Service- und Template-ID stehen sichtbar in der
`index.html`. Die Beschränkung der „Allowed Origins" (Schritt 3) ist
deshalb der wichtigste Schutz gegen Missbrauch.

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
