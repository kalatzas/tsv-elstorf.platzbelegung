// Cloud Function für E-Mail-Benachrichtigungen des Platzbelegungsplaners.
//
// Ablauf:
//   1. Die App legt bei Ereignissen ein Dokument in der Sammlung
//      "notifications" an (neuer Antrag, Entscheidung, DFBNet-Schritt,
//      Termin-Absage …). Sie füllt dabei ein `data`-Objekt mit
//      strukturierten Feldern, aus dem die Mail gerendert wird.
//   2. Diese Funktion reagiert auf jedes neue notifications-Dokument,
//      ermittelt die E-Mail-Adresse + Mail-Opt-out des Empfängers aus
//      der "users"-Sammlung und schickt die Mail über die Brevo API
//      (https://api.brevo.com/v3/smtp/email).
//
// Konfiguration (per `firebase functions:secrets:set <NAME>`):
//   BREVO_API_KEY    – v3 API-Key aus dem Brevo-Dashboard
//   MAIL_FROM        – Absenderadresse (Domain in Brevo authentifiziert)
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
  'request_received',
  'request_approved',
  'request_rejected',
  'request_update',
  'event_cancelled',
  'event_deleted',
  'training_displaced',
  'welcome',
]);

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Entfernt CR/LF aus dem Subject — defensiv gegen SMTP-Header-Injection,
// falls Brevo den Wert ungeprüft in den Subject-Header schreibt.
function sanitizeSubject(s) {
  return String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').slice(0, 200);
}

const WEEKDAYS_DE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

function formatLongDate(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso);
  const [, y, mo, d] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d));
  if (Number.isNaN(dt.getTime())) return `${d}.${mo}.${y}`;
  return `${WEEKDAYS_DE[dt.getDay()]}, ${d}.${mo}.${y}`;
}

function formatDuration(h) {
  const n = Number(h);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `${String(n).replace('.', ',')} Std`;
}

function firstName(u) {
  if (u && u.firstName) return String(u.firstName);
  if (u && u.name) return String(u.name).split(/\s+/)[0];
  return '';
}

// Baut HTML + Plaintext aus strukturierten Bausteinen, damit jede
// Template-Funktion sich nur um die Inhalte kümmert.
// `sections` rendert mehrere Tabellen mit Zwischenüberschriften
// (z. B. bei der Konflikt-Mail "Betroffenes Training" + "Verdrängt durch").
function renderEmail({ subject, greeting, intro, rows, sections, notes, footer, cta }) {
  const cleanRows = (rows || []).filter((r) => Array.isArray(r) && r[1] != null && r[1] !== '');
  const cleanSections = (sections || []).map((s) => ({
    heading: s.heading || '',
    rows: (s.rows || []).filter((r) => Array.isArray(r) && r[1] != null && r[1] !== ''),
  })).filter((s) => s.rows.length > 0);
  const cleanNotes = (notes || []).filter((n) => n && n.text);

  const rowsToHtml = (rs) => rs.map(([label, value]) => `<tr>
      <td style="padding:6px 18px 6px 0;color:#666;font-size:13px;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td>
      <td style="padding:6px 0;font-size:14px;color:#111">${escapeHtml(value)}</td>
    </tr>`).join('');
  const hRows = rowsToHtml(cleanRows);
  const hSections = cleanSections.map((s) => `${s.heading
    ? `<p style="margin:18px 0 4px;font-size:13px;color:#555;font-weight:600">${escapeHtml(s.heading)}</p>`
    : ''}<table style="border-collapse:collapse;margin:4px 0">${rowsToHtml(s.rows)}</table>`).join('');
  const hNotes = cleanNotes.map((n) => `<div style="margin:16px 0;padding:12px 14px;background:#f7f7f5;border-left:3px solid #15803d;border-radius:4px">
      <div style="font-size:12px;color:#666;margin-bottom:4px">${escapeHtml(n.label)}</div>
      <div style="font-size:14px;color:#111;white-space:pre-wrap">${escapeHtml(n.text)}</div>
    </div>`).join('');
  const hCta = cta && cta.url
    ? `<p style="margin:24px 0 0"><a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:10px 18px;background:#15803d;color:#fff;text-decoration:none;border-radius:6px;font-size:14px">${escapeHtml(cta.label || 'Zum Platzmanager')}</a></p>`
    : '';
  const hFooter = footer ? `<p style="margin:16px 0 0;font-size:13px;color:#444">${escapeHtml(footer)}</p>` : '';

  const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;color:#111;max-width:580px;margin:0;padding:0">
  <div style="padding:20px 0">
    <h2 style="margin:0 0 16px;font-size:18px">${escapeHtml(subject)}</h2>
    ${greeting ? `<p style="margin:0 0 12px;font-size:14px">${escapeHtml(greeting)}</p>` : ''}
    ${intro ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.5">${escapeHtml(intro)}</p>` : ''}
    ${hRows ? `<table style="border-collapse:collapse;margin:8px 0">${hRows}</table>` : ''}
    ${hSections}
    ${hNotes}
    ${hFooter}
    ${hCta}
    <hr style="margin-top:28px;border:none;border-top:1px solid #eee" />
    <p style="font-size:12px;color:#888;margin:8px 0 0">Automatisch verschickt vom Platzmanager TSV Elstorf. E-Mails kannst du im Benutzerprofil ausschalten.</p>
  </div>
</body></html>`;

  const tLines = [];
  if (greeting) tLines.push(greeting, '');
  if (intro) tLines.push(intro, '');
  cleanRows.forEach(([l, v]) => tLines.push(`  ${String(l).padEnd(14)}${v}`));
  if (cleanRows.length) tLines.push('');
  cleanSections.forEach((s) => {
    if (s.heading) tLines.push(s.heading, '');
    s.rows.forEach(([l, v]) => tLines.push(`  ${String(l).padEnd(14)}${v}`));
    tLines.push('');
  });
  cleanNotes.forEach((n) => { tLines.push(`${n.label}:`, n.text, ''); });
  if (footer) tLines.push(footer, '');
  if (cta && cta.url) tLines.push(`${cta.label || 'Zum Platzmanager'}: ${cta.url}`);
  const text = `${subject}\n\n${tLines.join('\n')}\n`;

  return { subject, html, text };
}

// Gemeinsamer Zeilensatz für Termin-Details — wird von mehreren
// Templates verwendet, damit Antrags-Mails ein einheitliches Layout haben.
function eventRows(d) {
  const rows = [
    d.requestTypeLabel && ['Art', d.requestTypeLabel],
    d.team && ['Mannschaft', d.team],
    d.opponent && ['Gegner', d.opponent],
    d.date && (d.dateEnd
      ? ['Zeitraum', `${formatLongDate(d.date)} – ${formatLongDate(d.dateEnd)}`]
      : ['Datum', formatLongDate(d.date)]),
    d.time && ['Uhrzeit', `${d.time} Uhr${d.duration ? ` (Dauer: ${formatDuration(d.duration)})` : ''}`],
    d.fieldName && ['Platz', d.fieldName],
  ];
  // Kabinen: konkrete Zuteilung (nach Genehmigung) hat Vorrang vor
  // dem reinen Anzahl-Wunsch (vor Genehmigung).
  if (d.cabins) {
    rows.push(['Kabinen', d.cabins]);
  } else if (d.cabinCount != null && d.cabinCount !== '') {
    rows.push(['Anzahl Kabinen', String(d.cabinCount)]);
  }
  // Bei Spielverlegung: bisherigen Termin als Vergleich darstellen.
  if (d.oldDate || d.oldTime) {
    const old = `${d.oldDate ? formatLongDate(d.oldDate) : ''}${d.oldTime ? ` ${d.oldTime} Uhr` : ''}`.trim();
    if (old) rows.push(['Bisher', old]);
  }
  return rows;
}

function greet(u) {
  const f = firstName(u);
  return f ? `Hallo ${f},` : 'Hallo,';
}

// ---- Template-Funktionen pro Notification-Typ ----

function tmplRequestNew(n, u, _appUrl) {
  const d = n.data || {};
  const subject = `Neuer Antrag: ${d.requestTypeLabel || 'Antrag'}${d.team ? ` ${d.team}` : ''}`;
  const requesterLine = d.requesterEmail
    ? `${d.requesterName || ''} <${d.requesterEmail}>`.trim()
    : (d.requesterName || '');
  return renderEmail({
    subject,
    greeting: greet(u),
    intro: `${d.requesterName || 'Ein Benutzer'} hat einen neuen Antrag eingereicht und bittet um Prüfung.`,
    rows: eventRows(d),
    notes: [d.note && { label: 'Anmerkung des Antragstellers', text: d.note }],
    footer: requesterLine ? `Antragsteller: ${requesterLine}` : '',
  });
}

function tmplRequestReceived(n, u, _appUrl) {
  const d = n.data || {};
  const subject = `Antrag eingegangen: ${d.requestTypeLabel || 'Antrag'}`;
  return renderEmail({
    subject,
    greeting: greet(u),
    intro: 'dein Antrag wurde aufgenommen und liegt jetzt den Admins zur Prüfung vor.',
    rows: eventRows(d),
    notes: [d.note && { label: 'Deine Anmerkung', text: d.note }],
    footer: 'Du erhältst eine weitere Mail, sobald über deinen Antrag entschieden wurde.',
  });
}

function tmplRequestApproved(n, u, _appUrl) {
  const d = n.data || {};
  const subject = `Antrag genehmigt: ${d.requestTypeLabel || 'Antrag'}${d.team ? ` ${d.team}` : ''}`;
  const intro = d.decidedBy
    ? `dein Antrag wurde von ${d.decidedBy} genehmigt. Der Termin ist fest im Belegungsplan eingetragen.`
    : 'dein Antrag wurde genehmigt. Der Termin ist fest im Belegungsplan eingetragen.';
  return renderEmail({
    subject,
    greeting: greet(u),
    intro,
    rows: eventRows(d),
    notes: [d.adminNote && { label: 'Anmerkung zur Genehmigung', text: d.adminNote }],
  });
}

function tmplRequestRejected(n, u, _appUrl) {
  const d = n.data || {};
  const subject = `Antrag abgelehnt: ${d.requestTypeLabel || 'Antrag'}${d.team ? ` ${d.team}` : ''}`;
  const intro = d.decidedBy
    ? `dein Antrag wurde von ${d.decidedBy} leider abgelehnt.`
    : 'dein Antrag wurde leider abgelehnt.';
  return renderEmail({
    subject,
    greeting: greet(u),
    intro,
    rows: eventRows(d),
    notes: [d.adminNote && { label: 'Begründung', text: d.adminNote }],
  });
}

function tmplRequestUpdate(n, u, _appUrl) {
  const d = n.data || {};
  const subject = `DFBNet-Antrag gestellt${d.team ? `: ${d.team}` : ''}`;
  return renderEmail({
    subject,
    greeting: greet(u),
    intro: 'für deine Spielverlegung wurde der DFBNet-Antrag gestellt. Die endgültige Freigabe erfolgt nach DFBNet-Bestätigung.',
    rows: eventRows(d),
    footer: d.decidedBy ? `Eingereicht durch: ${d.decidedBy}` : '',
  });
}

function tmplEventCancelled(n, u, _appUrl) {
  const d = n.data || {};
  const heading = [d.team, d.eventTypeLabel].filter(Boolean).join(' ');
  const subject = `Einheit fällt aus${heading ? `: ${heading}` : ''}`;
  return renderEmail({
    subject,
    greeting: greet(u),
    intro: `${d.actorName || 'Jemand'} hat folgenden Termin abgesagt — Platz und Kabine sind wieder frei:`,
    rows: [
      d.eventTypeLabel && ['Art', d.eventTypeLabel],
      d.team && ['Mannschaft', d.team],
      d.date && ['Datum', formatLongDate(d.date)],
      d.day && !d.date && ['Wochentag', d.day],
      d.time && ['Uhrzeit', `${d.time} Uhr`],
      d.fieldName && ['Platz', d.fieldName],
      d.cabins && ['Kabinen', d.cabins],
    ],
  });
}

function tmplEventDeleted(n, u, _appUrl) {
  const d = n.data || {};
  const heading = [d.team, d.eventTypeLabel].filter(Boolean).join(' ');
  const subject = `Einheit gelöscht${heading ? `: ${heading}` : ''}`;
  return renderEmail({
    subject,
    greeting: greet(u),
    intro: `${d.actorName || 'Jemand'} hat folgenden Termin endgültig gelöscht:`,
    rows: [
      d.eventTypeLabel && ['Art', d.eventTypeLabel],
      d.team && ['Mannschaft', d.team],
      d.date && ['Datum', formatLongDate(d.date)],
      d.day && !d.date && ['Wochentag', d.day],
      d.time && ['Uhrzeit', `${d.time} Uhr`],
      d.fieldName && ['Platz', d.fieldName],
      d.cabins && ['Kabinen', d.cabins],
    ],
  });
}

// Wenn ein Termin ein bestehendes Training überlagert, werden die
// Trainer der verdrängten Einheit benachrichtigt. Pflichtspiele haben
// echten Vorrang ("Pflichtspiel hat Vorrang"), bei anderen Terminarten
// wurde der Konflikt vom Admin bewusst akzeptiert — die Wortwahl passt
// sich entsprechend an.
function tmplTrainingDisplaced(n, u, _appUrl) {
  const d = n.data || {};
  const subject = `Trainingstermin überschnitten: ${d.trainingTeam || ''}`.trim();
  const matchTimeEnd = d.matchTime && d.matchDuration
    ? `${d.matchTime}–${addHoursToTime(d.matchTime, d.matchDuration)} Uhr`
    : (d.matchTime ? `${d.matchTime} Uhr` : '');
  const isPflichtspiel = d.displacerType === 'match';
  const displacerLabel = d.displacerTypeLabel || (isPflichtspiel ? 'Pflichtspiel' : 'Termin');
  const intro = isPflichtspiel
    ? `${d.actorName || 'Ein Admin'} hat ein Pflichtspiel angelegt, das sich mit eurem Training überschneidet. Pflichtspiele haben Vorrang — bitte plant den Trainingstermin um.`
    : `${d.actorName || 'Ein Admin'} hat einen Termin (${displacerLabel}) angelegt, der sich mit eurem Training überschneidet. Bitte plant den Trainingstermin um oder stimmt euch mit der Vereinsleitung ab.`;
  const matchRows = [
    d.matchTeam && ['Mannschaft', d.matchTeam],
    d.matchOpponent && ['Gegner', d.matchOpponent],
    d.matchDate && ['Datum', formatLongDate(d.matchDate)],
    matchTimeEnd && ['Uhrzeit', matchTimeEnd],
    d.matchFieldName && ['Platz', d.matchFieldName],
  ];
  return renderEmail({
    subject,
    greeting: greet(u),
    intro,
    sections: [
      {
        heading: 'Betroffenes Training',
        rows: [
          d.trainingTeam && ['Mannschaft', d.trainingTeam],
          d.trainingDate && ['Datum', formatLongDate(d.trainingDate)],
          d.trainingDay && !d.trainingDate && ['Wochentag', d.trainingDay],
          d.trainingTime && ['Uhrzeit', `${d.trainingTime} Uhr${d.trainingDuration ? ` (Dauer: ${formatDuration(d.trainingDuration)})` : ''}`],
          d.trainingFieldName && ['Platz', d.trainingFieldName],
        ],
      },
      {
        heading: `Verdrängt durch ${displacerLabel}`,
        rows: matchRows,
      },
    ],
  });
}

function tmplWelcome(n, u, appUrl) {
  const d = n.data || {};
  return renderEmail({
    subject: 'Willkommen beim Platzbelegungsplaner',
    greeting: greet(u),
    intro: 'für dich wurde ein Zugang zum Platzbelegungsplaner des TSV Elstorf angelegt. Du kannst dich ab sofort einloggen.',
    rows: [
      d.email && ['E-Mail (Login)', d.email],
      d.roleLabel && ['Rolle', d.roleLabel],
    ],
    notes: [{ label: 'Passwort', text: 'Das Start-Passwort teilt dir der Administrator persönlich mit. Nach dem ersten Login kannst du es jederzeit über „Passwort vergessen" zurücksetzen.' }],
    cta: { label: 'Zum Platzmanager', url: appUrl },
  });
}

// Hilfsfunktion: addiert Stunden (z. B. 1.5) zu einer "HH:MM"-Zeit.
function addHoursToTime(hhmm, hours) {
  const m = String(hhmm).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const total = Number(m[1]) * 60 + Number(m[2]) + Math.round(Number(hours) * 60);
  const h = Math.floor(total / 60) % 24;
  const mi = total % 60;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

const TEMPLATES = {
  request_new: tmplRequestNew,
  request_received: tmplRequestReceived,
  request_approved: tmplRequestApproved,
  request_rejected: tmplRequestRejected,
  request_update: tmplRequestUpdate,
  event_cancelled: tmplEventCancelled,
  event_deleted: tmplEventDeleted,
  training_displaced: tmplTrainingDisplaced,
  welcome: tmplWelcome,
};

// Fallback für Notifications ohne data-Objekt (z. B. ältere, vor dem
// Template-Refactor erzeugte Dokumente): einfache Darstellung aus
// title + body, damit nichts verloren geht.
function renderLegacy(n, _u, appUrl) {
  return renderEmail({
    subject: n.title || 'Benachrichtigung',
    intro: n.body || '',
    cta: { label: 'Zum Platzmanager', url: appUrl },
  });
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
    if (!MAIL_TYPES.has(n.type)) return;

    const userSnap = await db.collection('users').doc(n.recipientUid).get();
    if (!userSnap.exists) return;
    const u = userSnap.data() || {};
    if (!u.email) return;
    if (u.notifyEmail === false) return;

    const appUrl = APP_URL.value();
    const tmpl = TEMPLATES[n.type];
    const mail = (tmpl && n.data) ? tmpl(n, u, appUrl) : renderLegacy(n, u, appUrl);

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
        subject: sanitizeSubject(mail.subject),
        htmlContent: mail.html,
        textContent: mail.text,
      }),
    });

    if (!res.ok) {
      // PII-arm loggen: nur Status + ggf. Brevo-Errorcode, nicht den
      // ganzen Errorbody (der oft die Empfängeradresse echo't).
      let code = '';
      try { code = (await res.json())?.code || ''; } catch (_) { /* ignore */ }
      console.error('Brevo sendMail fehlgeschlagen', { status: res.status, code, notificationId: event.params?.id });
      // Bewusst kein throw: bei 4xx wäre Retry sinnlos, bei 5xx ist
      // Mail-Verlust besser als Duplikate ohne Idempotenz-Marker.
    }
  }
);
