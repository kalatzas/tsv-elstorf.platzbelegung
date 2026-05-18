// Cloud Function für E-Mail-Benachrichtigungen des Platzbelegungsplaners.
//
// Ablauf:
//   1. Die App legt bei Ereignissen ein Dokument in der Sammlung
//      "notifications" an (neuer Antrag, Entscheidung, Absage, Konto …).
//   2. Diese Funktion reagiert auf jedes neue notifications-Dokument,
//      ermittelt die E-Mail-Adresse des Empfängers aus der "users"-
//      Sammlung und schreibt ein Dokument in die "mail"-Sammlung.
//   3. Die Firebase-Erweiterung "Trigger Email" verschickt dieses
//      "mail"-Dokument per SMTP (Microsoft).
//
// Vorteil: Die App-Clients haben keinen Zugriff auf "mail" und können
// weder Empfänger noch Inhalt frei wählen – das macht ausschließlich
// diese serverseitige Funktion.

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

// Basis-URL der App – wird ans Ende jeder E-Mail gehängt.
const APP_URL = 'https://kalatzas.github.io/tsv-elstorf.platzbelegung/';

exports.emailOnNotification = onDocumentCreated('notifications/{id}', async (event) => {
  const snap = event.data;
  if (!snap) return;
  const n = snap.data() || {};
  if (!n.recipientUid) return;

  // E-Mail-Adresse des Empfängers aus dem Profil ermitteln
  const userSnap = await db.collection('users').doc(n.recipientUid).get();
  if (!userSnap.exists) return;
  const email = userSnap.data().email;
  if (!email) return;

  // Auftrag für die "Trigger Email"-Erweiterung anlegen
  await db.collection('mail').add({
    to: email,
    message: {
      subject: '[Platzbelegungsplaner] ' + (n.title || 'Benachrichtigung'),
      text: (n.body || '') + '\n\nZum Plan: ' + APP_URL,
    },
  });
});
