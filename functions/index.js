// Cloud Function für E-Mail-Benachrichtigungen des Platzbelegungsplaners.
//
// Ablauf:
//   1. Die App legt bei Ereignissen ein Dokument in der Sammlung
//      "notifications" an (neuer Antrag, Entscheidung, DFBNet-Schritt,
//      Termin-Absage …).
//   2. Diese Funktion reagiert auf jedes neue notifications-Dokument,
//      ermittelt die E-Mail-Adresse + Mail-Opt-out des Empfängers aus
//      der "users"-Sammlung und schickt die Mail über die Microsoft
//      Graph API (Client-Credentials, ohne Nutzerinteraktion).
//   3. Absender ist eine Shared Mailbox im M365-Tenant; der Versand
//      ist per ApplicationAccessPolicy auf genau dieses Postfach
//      eingeschränkt.
//
// Konfiguration (per `firebase functions:secrets:set <NAME>`):
//   M365_TENANT  – Verzeichnis-(Tenant-)ID aus Entra ID
//   M365_CLIENT  – Anwendungs-(Client-)ID der App-Registrierung
//   M365_SECRET  – Client-Secret der App-Registrierung
//   M365_FROM    – Absenderadresse (Shared Mailbox), z. B.
//                  platzmanager@dein-verein.de

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret, defineString } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

const M365_TENANT = defineSecret('M365_TENANT');
const M365_CLIENT = defineSecret('M365_CLIENT');
const M365_SECRET = defineSecret('M365_SECRET');
const M365_FROM   = defineSecret('M365_FROM');
const APP_URL     = defineString('APP_URL', { default: 'https://kalatzas.github.io/tsv-elstorf.platzbelegung/' });

// Welche Notification-Typen lösen eine E-Mail aus
// (Trainings-Edits durch andere Trainer bleiben nur in der App-Inbox).
const MAIL_TYPES = new Set([
  'request_new',
  'request_approved',
  'request_rejected',
  'request_update',
  'event_cancelled',
  'event_deleted',
]);

// Token-Cache pro Instanz (Graph-Token lebt 60–75 min)
let tokenCache = null;

async function getGraphToken(tenant, clientId, clientSecret) {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) throw new Error(`Token-Anforderung fehlgeschlagen: ${res.status} ${await res.text()}`);
  const j = await res.json();
  tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  return tokenCache.token;
}

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
    secrets: [M365_TENANT, M365_CLIENT, M365_SECRET, M365_FROM],
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const n = snap.data() || {};
    if (!n.recipientUid) return;
    if (n.type && !MAIL_TYPES.has(n.type)) return;

    const userSnap = await db.collection('users').doc(n.recipientUid).get();
    if (!userSnap.exists) return;
    const u = userSnap.data() || {};
    if (!u.email) return;
    if (u.notifyEmail === false) return;

    const token = await getGraphToken(M365_TENANT.value(), M365_CLIENT.value(), M365_SECRET.value());
    const from = M365_FROM.value();
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            subject: '[Platzmanager] ' + (n.title || 'Benachrichtigung'),
            body: { contentType: 'HTML', content: buildHtml(n, APP_URL.value()) },
            toRecipients: [{ emailAddress: { address: u.email } }],
          },
          saveToSentItems: false,
        }),
      }
    );

    if (!res.ok) {
      const txt = await res.text();
      console.error('Graph sendMail fehlgeschlagen', res.status, txt);
      throw new Error(`Graph sendMail ${res.status}`);
    }
  }
);
