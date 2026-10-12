// RanjanSoft contact API: saves contact form submissions to MongoDB and emails a notification.
// nginx proxies /api/* here; this service is not exposed to the host directly.
// Pages served from another origin (e.g. GitHub Pages) must be listed in ALLOWED_ORIGINS.

const express = require('express');
const { MongoClient } = require('mongodb');
const nodemailer = require('nodemailer');

// `||` rather than destructuring defaults: compose passes unset variables as empty strings.
const env = process.env;
const PORT = Number(env.PORT) || 3000;
// MongoDB on the stock-market server (reached over Tailscale). MONGODB_URI, if set, overrides the DB_* parts.
const DB_HOST = env.DB_HOST || 'localhost';
const DB_PORT = Number(env.DB_PORT) || 27017;
const DB_AUTH = env.DB_USER
  ? `${encodeURIComponent(env.DB_USER)}:${encodeURIComponent(env.DB_PASSWORD || '')}@`
  : '';
const MONGODB_URI = env.MONGODB_URI
  || `mongodb://${DB_AUTH}${DB_HOST}:${DB_PORT}/${DB_AUTH ? '?authSource=' + (env.DB_AUTH_SOURCE || 'admin') : ''}`;
const MONGODB_DB = env.DB_NAME || 'ranjansoft';
const SMTP_HOST = env.SMTP_HOST;
const SMTP_PORT = Number(env.SMTP_PORT) || 587;
const SMTP_USER = env.SMTP_USER;
const SMTP_PASS = env.SMTP_PASS;
const MAIL_TO = env.MAIL_TO || 'hr.ranjansoft@gmail.com';
const MAIL_FROM = env.MAIL_FROM || SMTP_USER;
const ALLOWED_ORIGINS = (env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim().replace(/\/$/, '')).filter(Boolean);

// Must match the <option>s in index.html's contact form.
const SERVICES = [
  'Cloud Architecture & Migration',
  'Cybersecurity & Compliance',
  'DevOps & Platform Engineering',
  'System & Application Architecture',
  'Data Engineering & Analytics',
  'AI / ML & Intelligent Automation',
  'IT Strategy Consulting',
  'Other',
];

// field -> [required, max length]
const FIELDS = {
  firstName: [true, 80],
  lastName:  [false, 80],
  email:     [true, 254],
  company:   [false, 160],
  service:   [true, 80],
  message:   [true, 5000],
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validate(body) {
  const data = {};
  const errors = {};
  for (const [field, [required, max]] of Object.entries(FIELDS)) {
    const raw = body[field];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) { if (required) errors[field] = 'This field is required.'; continue; }
    if (value.length > max) { errors[field] = `Keep this under ${max} characters.`; continue; }
    // Single-line fields must not carry line breaks (they end up in email headers/subjects).
    data[field] = field === 'message' ? value : value.replace(/[\r\n]+/g, ' ');
  }
  if (data.email && !EMAIL_RE.test(data.email)) errors.email = 'Enter a valid email address.';
  if (data.service && !SERVICES.includes(data.service)) errors.service = 'Choose a service from the list.';
  return { data, errors };
}

// In-memory rate limits. Keyed by sender email plus a global cap rather than by IP:
// behind rootless podman's port forwarding every visitor arrives from the same address.
const hits = new Map();
function overLimit(key, limit, windowMs) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter(t => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > limit;
}
function rateLimited(email) {
  const perEmail = overLimit('email:' + email.toLowerCase(), 3, 10 * 60 * 1000);
  const global = overLimit('global', 60, 60 * 60 * 1000);
  return perEmail || global;
}
setInterval(() => {
  const now = Date.now();
  for (const [key, times] of hits) if (times.every(t => now - t >= 60 * 60 * 1000)) hits.delete(key);
}, 10 * 60 * 1000).unref();

const mailer = SMTP_HOST
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    })
  : null;

function notify(doc) {
  if (!mailer) return;
  const name = [doc.firstName, doc.lastName].filter(Boolean).join(' ');
  const text = [
    `Name:    ${name}`,
    `Email:   ${doc.email}`,
    `Company: ${doc.company || '-'}`,
    `Service: ${doc.service}`,
    `Received: ${doc.createdAt.toISOString()}`,
    '',
    doc.message,
  ].join('\n');
  mailer.sendMail({
    from: MAIL_FROM,
    to: MAIL_TO,
    replyTo: doc.email,
    subject: `New enquiry: ${doc.service} from ${name}`,
    text,
  }).catch(err => console.error('Notification email failed:', err.message));
}

async function main() {
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  console.log(`Connected to MongoDB at ${DB_HOST}:${DB_PORT}, database ${MONGODB_DB}`);
  const submissions = client.db(MONGODB_DB).collection('contact_submissions');
  await submissions.createIndex({ createdAt: -1 });

  const app = express();
  app.set('trust proxy', 1); // real client IP from nginx's X-Forwarded-For
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      res.set({ 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' });
      if (req.method === 'OPTIONS') {
        res.set({ 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' });
        return res.sendStatus(204);
      }
    }
    next();
  });
  app.use(express.json({ limit: '20kb' }));

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.post('/api/contact', async (req, res) => {
    const body = req.body || {};
    // Honeypot: the hidden "website" field is only ever filled in by bots. Pretend it worked.
    if (body.website) return res.status(201).json({ ok: true });
    const { data, errors } = validate(body);
    if (Object.keys(errors).length) return res.status(400).json({ ok: false, errors });
    if (rateLimited(data.email)) {
      return res.status(429).json({ ok: false, error: 'Too many messages. Try again in a few minutes.' });
    }

    const doc = { ...data, ip: req.ip, userAgent: req.get('user-agent') || '', createdAt: new Date() };
    try {
      await submissions.insertOne(doc);
    } catch (err) {
      console.error('Saving submission failed:', err.message);
      return res.status(500).json({ ok: false, error: 'Your message could not be saved. Email us at hr.ranjansoft@gmail.com instead.' });
    }
    notify(doc);
    res.status(201).json({ ok: true });
  });

  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
      return res.status(400).json({ ok: false, error: 'Invalid request.' });
    }
    next(err);
  });

  const server = app.listen(PORT, () => console.log(`Contact API listening on :${PORT}`));
  const shutdown = () => server.close(() => client.close().then(() => process.exit(0)));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(err => { console.error(err); process.exit(1); });
