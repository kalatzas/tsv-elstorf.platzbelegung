// Cloud Function für E-Mail-Benachrichtigungen des Platzbelegungsplaners.
//
// Ablauf:
//   1. Die App legt bei Ereignissen ein Dokument in der Sammlung
//      "notifications" an (neuer Antrag, Entscheidung, DFBNet-Schritt,
//      Termin-Absage …).
//   2. Diese Funktion reagiert auf jedes neue notifications-Dokument,
//      ermittelt die E-Mail-Adresse + Mail-Opt-out des Empfängers aus
//      der "users"-Sammlung und schickt die Mail über die Brevo API
//      (https://api.brevo.com/v3/smtp/email).
//
// Konfiguration (per `firebase functions:secrets:set <NAME>`):
//   BREVO_API_KEY    – v3 API-Key aus dem Brevo-Dashboard
//   MAIL_FROM        – Absenderadresse (Domain in Brevo authentifiziert),
//                      z. B. platzmanager.tsvelstorf@alatzas.de
//   MAIL_FROM_NAME   – Anzeigename im Mailclient

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret, defineString } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

const BREVO_API_KEY  = defineSecret('BREVO_API_KEY');
const MAIL_FROM      = defineSecret('MAIL_FROM');
const MAIL_FROM_NAME = defineSecret('MAIL_FROM_NAME');
const APP_URL        = defineString('APP_URL', { default: 'https://kalatzas.github.io/tsv-elstorf.platzbelegung/' });

// Welche Notification-Typen lösen eine E-Mail aus
// (Trainings-Edits durch andere Trainer bleiben nur in der App-Inbox).
const MAIL_TYPES = new Set([
  'request_new',
  'request_approved',
  'request_rejected',
  'request_update',
  'event_cancelled',
  'event_deleted',
  'welcome',
]);

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function buildHtml(payload, appUrl) {
  const link = appUrl
    ? `<p style="margin-top:24px"><a href="${escapeHtml(appUrl)}" style="color:#15803d">Zum Platzmanager</a></p>`
    : '';
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;color:#111;max-width:560px">
  <h2 style="margin:0 0 12px;font-size:18px">${escapeHtml(payload.title || 'Platzmanager')}</h2>
  <p style="margin:0;white-space:pre-wrap;font-size:14px;line-height:1.5">${escapeHtml(payload.body || '')}</p>
  ${link}
  <hr style="margin-top:24px;border:none;border-top:1px solid #eee" />
  <p style="font-size:12px;color:#888">Automatisch verschickt vom Platzmanager. E-Mails kannst du im Benutzerprofil ausschalten.</p>
</body></html>`;
}

exports.sendNotificationEmail = onDocumentCreated(
  {
    document: 'notifications/{id}',
    secrets: [BREVO_API_KEY, MAIL_FROM, MAIL_FROM_NAME],
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const n = snap.data() || {};
    if (!n.recipientUid) return;
    // Audit-Trail: nur Benachrichtigungen mit identifizierbarem Absender
    // werden per Mail verschickt. Schützt vor Mail-Versand aus
    // gefälschten Notifications.
    if (!n.createdBy) {
      console.warn('Notification ohne createdBy übersprungen', event.params?.id);
      return;
    }
    if (n.type && !MAIL_TYPES.has(n.type)) return;

    const userSnap = await db.collection('users').doc(n.recipientUid).get();
    if (!userSnap.exists) return;
    const u = userSnap.data() || {};
    if (!u.email) return;
    if (u.notifyEmail === false) return;

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': BREVO_API_KEY.value(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: MAIL_FROM_NAME.value(), email: MAIL_FROM.value() },
        to: [{ email: u.email, name: u.name || u.firstName || '' }],
        subject: '[Platzmanager] ' + (n.title || 'Benachrichtigung'),
        htmlContent: buildHtml(n, APP_URL.value()),
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      console.error('Brevo sendMail fehlgeschlagen', res.status, txt);
      throw new Error(`Brevo sendMail ${res.status}`);
    }
  }
);
