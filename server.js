require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Persistent storage root.
// On Render, set PERSIST_DIR=/data (matches the mounted disk).
// Locally, this falls back to the project folder so nothing changes for development.
const PERSIST_ROOT = process.env.PERSIST_DIR || __dirname;

const DATA_DIR = path.join(PERSIST_ROOT, 'data');
const VAULT_DIR = path.join(PERSIST_ROOT, 'vault');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });

// First-run seed: if the persistent dir is empty, copy bundled fallback files
// from the repo so master codes / demo codes / access codes aren't lost on a
// fresh Render disk. Only copies files that don't already exist on disk.
(function seedPersistentStorage() {
  if (PERSIST_ROOT === __dirname) return; // local dev — nothing to seed
  const bundledData = path.join(__dirname, 'data');
  const bundledVault = path.join(__dirname, 'vault');
  function copyIfMissing(srcDir, dstDir) {
    if (!fs.existsSync(srcDir)) return;
    for (const file of fs.readdirSync(srcDir)) {
      const src = path.join(srcDir, file);
      const dst = path.join(dstDir, file);
      try {
        if (fs.statSync(src).isFile() && !fs.existsSync(dst)) {
          fs.copyFileSync(src, dst);
          console.log('[seed] copied', file, '->', dstDir);
        }
      } catch (e) { console.warn('[seed] skip', file, e.message); }
    }
  }
  copyIfMissing(bundledData, DATA_DIR);
  copyIfMissing(bundledVault, VAULT_DIR);
})();

const DB_PATH = path.join(DATA_DIR, 'vault.json');
const CODES_PATH = path.join(VAULT_DIR, 'access_codes.json');

function load() {
  if (!fs.existsSync(DB_PATH)) return { keys: [], attempts: [] };
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch (e) { return { keys: [], attempts: [] }; }
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function loadCodes() {
  if (!fs.existsSync(CODES_PATH)) return { codes: [] };
  try { return JSON.parse(fs.readFileSync(CODES_PATH, 'utf8')); }
  catch (e) { return { codes: [] }; }
}

function saveCodes(data) {
  fs.writeFileSync(CODES_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// Master codes
const MASTER_PATH = path.join(VAULT_DIR, 'master_codes.json');

function loadMaster() {
  if (!fs.existsSync(MASTER_PATH)) return { codes: [] };
  try { return JSON.parse(fs.readFileSync(MASTER_PATH, 'utf8')); }
  catch (e) { return { codes: [] }; }
}

function saveMaster(data) {
  fs.writeFileSync(MASTER_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// Demo codes
const DEMO_PATH = path.join(VAULT_DIR, 'demo_codes.json');

function loadDemo() {
  if (!fs.existsSync(DEMO_PATH)) return { codes: [] };
  try { return JSON.parse(fs.readFileSync(DEMO_PATH, 'utf8')); }
  catch (e) { return { codes: [] }; }
}

function saveDemo(data) {
  fs.writeFileSync(DEMO_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// Validate code format: letter + 8 digits + letter
function isValidCodeFormat(code) {
  return /^[A-Za-z]\d{8}[A-Za-z]$/.test(code);
}

// Middleware
app.use(express.json());

// Security headers — purely additive, does not change any response body
app.use(function(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Log admin auth failures — passive observer, does not change any response
app.use(function(req, res, next) {
  res.on('finish', function() {
    if (res.statusCode === 401 && req.path.indexOf('/api/admin') === 0) {
      var ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
      console.warn('[auth-fail]', new Date().toISOString(), ip, req.method, req.path);
    }
  });
  next();
});

app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: false }));

// The correct code - atomic weights
const CORRECT_CODE = {
  iron: 7.87,
  copper: 8.96,
  silver: 10.49,
  gold: 19.32
};

// Leads data
const LEADS_PATH = path.join(DATA_DIR, 'leads.json');

function loadLeads() {
  if (!fs.existsSync(LEADS_PATH)) return { leads: {} };
  try { return JSON.parse(fs.readFileSync(LEADS_PATH, 'utf8')); }
  catch (e) { return { leads: {} }; }
}

function saveLeads(data) {
  fs.writeFileSync(LEADS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function getOrCreateLead(code, phone) {
  const data = loadLeads();
  if (!data.leads[code]) {
    data.leads[code] = {
      code,
      phone: phone || '',
      firstEntry: new Date().toISOString(),
      lastEntry: new Date().toISOString(),
      gateEntry: true,
      vaultOpened: false,
      printedLetter: false,
      gotCertificate: false,
      printedCertificate: false,
      events: []
    };
  } else {
    data.leads[code].lastEntry = new Date().toISOString();
    if (phone && !data.leads[code].phone) data.leads[code].phone = phone;
  }
  saveLeads(data);
  return data.leads[code];
}

// Send a WhatsApp message to the site admin via Green API (same provider as batumionline-biz).
async function sendAdminWhatsApp(message) {
  const url = process.env.GREEN_API_URL;
  const instance = process.env.GREEN_API_INSTANCE;
  const token = process.env.GREEN_API_TOKEN;
  const admin = (process.env.ADMIN_PHONE || '').replace(/\D/g, '');
  if (!url || !instance || !token || !admin) {
    console.warn('[contact] WhatsApp not configured — message not sent');
    return false;
  }
  try {
    const endpoint = `${url}/waInstance${instance}/sendMessage/${token}`;
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: `${admin}@c.us`, message }),
    });
    return r.ok;
  } catch (e) {
    console.warn('[contact] WhatsApp send failed:', e.message);
    return false;
  }
}

// API: Contact form -> notify admin on WhatsApp (visitor just sees a normal form)
app.post('/api/contact', async (req, res) => {
  const name = (req.body.name || '').toString().trim().slice(0, 120);
  const email = (req.body.email || '').toString().trim().slice(0, 160);
  const message = (req.body.message || '').toString().trim().slice(0, 2000);
  if (!name || !message) return res.json({ success: false, error: 'missing_fields' });

  const when = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
  const text = `📩 פנייה חדשה מאתר הצופן הסודי\n\n👤 שם: ${name}\n✉️ אימייל: ${email || '-'}\n🕒 ${when}\n\n💬 הודעה:\n${message}`;

  // Persist a copy too (so nothing is lost if WhatsApp fails)
  try {
    const p = path.join(DATA_DIR, 'contact.json');
    const arr = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : [];
    arr.unshift({ name, email, message, at: new Date().toISOString() });
    fs.writeFileSync(p, JSON.stringify(arr.slice(0, 500), null, 2));
  } catch (e) { /* non-fatal */ }

  sendAdminWhatsApp(text).catch(() => {});
  res.json({ success: true });
});

// ── Public feedback wall (Facebook-style comments) ──────────
const FEEDBACK_PATH = path.join(DATA_DIR, 'feedback.json');
function loadFeedback() {
  if (!fs.existsSync(FEEDBACK_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(FEEDBACK_PATH, 'utf8')); } catch (e) { return []; }
}
function saveFeedback(arr) {
  fs.writeFileSync(FEEDBACK_PATH, JSON.stringify(arr.slice(0, 1000), null, 2));
}

// List public comments (newest first)
app.get('/api/feedback', (req, res) => {
  const arr = loadFeedback().filter(c => !c.hidden);
  res.json({ success: true, comments: arr.map(c => ({ id: c.id, name: c.name, message: c.message, at: c.at })) });
});

// Add a public comment
app.post('/api/feedback', (req, res) => {
  const name = (req.body.name || '').toString().trim().slice(0, 60);
  const message = (req.body.message || '').toString().trim().slice(0, 1000);
  if (!name || !message) return res.json({ success: false, error: 'missing_fields' });
  const arr = loadFeedback();
  const comment = { id: 'c_' + Date.now() + '_' + Math.floor(Math.random() * 1e4), name, message, at: new Date().toISOString() };
  arr.unshift(comment);
  saveFeedback(arr);
  res.json({ success: true, comment: { id: comment.id, name, message, at: comment.at } });
});

// Admin: hide/delete a comment
app.post('/api/admin/feedback/delete', (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ success: false });
  const id = req.body.id;
  const arr = loadFeedback().filter(c => c.id !== id);
  saveFeedback(arr);
  res.json({ success: true });
});

// API: Track user activity
app.post('/api/track', (req, res) => {
  const { code, event } = req.body;
  if (!code || !event) return res.json({ success: false });

  const data = loadLeads();
  const lead = data.leads[code];
  if (!lead) return res.json({ success: false });

  lead.events.push({ event, timestamp: new Date().toISOString() });
  lead.lastEntry = new Date().toISOString();

  if (event === 'vault_opened') lead.vaultOpened = true;
  if (event === 'print_letter') lead.printedLetter = true;
  if (event === 'envelope_extracted') lead.printedLetter = true;
  if (event === 'got_certificate') lead.gotCertificate = true;
  if (event === 'print_certificate') lead.printedCertificate = true;

  saveLeads(data);
  res.json({ success: true });
});

// API: Verify access code (gate)
app.post('/api/gate/verify', (req, res) => {
  const { code, phone } = req.body;

  if (!code || !isValidCodeFormat(code)) {
    return res.json({ success: false, message: 'פורמט הקוד אינו תקין' });
  }

  const upperCode = code.toUpperCase();

  // Block trashed leads from re-entering (Recycle Bin semantics)
  const leadsCheck = loadLeads();
  const existingLead = leadsCheck.leads[upperCode];
  if (existingLead && existingLead.status === 'trashed') {
    return res.json({ success: false, message: 'קוד זה אינו זמין, פנה למנהל' });
  }

  // Check demo codes first
  const demoData = loadDemo();
  const demoEntry = demoData.codes.find(c => c.code === upperCode && c.active);
  if (demoEntry) {
    demoEntry.lastUsed = new Date().toISOString();
    demoEntry.uses = (demoEntry.uses || 0) + 1;
    saveDemo(demoData);
    getOrCreateLead(upperCode, phone);
    return res.json({ success: true, master: true, message: 'ברוכים הבאים! (דמו)' });
  }

  // Check master codes
  const masterData = loadMaster();
  const masterEntry = masterData.codes.find(c => c.code === upperCode && c.active);
  if (masterEntry) {
    masterEntry.lastUsed = new Date().toISOString();
    masterEntry.uses = (masterEntry.uses || 0) + 1;
    saveMaster(masterData);
    getOrCreateLead(upperCode, phone);
    return res.json({ success: true, master: true, message: 'ברוכים הבאים! (מאסטר)' });
  }

  // Regular codes
  const codesData = loadCodes();
  const entry = codesData.codes.find(c => c.code === upperCode);

  if (!entry) {
    return res.json({ success: false, message: 'הקוד אינו קיים במערכת' });
  }

  if (!entry.active) {
    return res.json({ success: false, message: 'קוד זה אינו פעיל יותר' });
  }

  // Mark usage
  entry.lastUsed = new Date().toISOString();
  entry.uses = (entry.uses || 0) + 1;
  saveCodes(codesData);

  // Create/update lead
  getOrCreateLead(upperCode, phone);

  return res.json({ success: true, master: false, message: 'ברוכים הבאים!' });
});

// API: Verify vault code
app.post('/api/vault/open', (req, res) => {
  const { key, iron, copper, silver, gold } = req.body;

  // Check code
  const isCorrect = (
    parseFloat(iron) === CORRECT_CODE.iron &&
    parseFloat(copper) === CORRECT_CODE.copper &&
    parseFloat(silver) === CORRECT_CODE.silver &&
    parseFloat(gold) === CORRECT_CODE.gold
  );

  // Log attempt
  const db = load();
  db.attempts.push({
    key: key || 'anonymous',
    iron, copper, silver, gold,
    correct: isCorrect,
    timestamp: new Date().toISOString()
  });
  save(db);

  if (isCorrect) {
    return res.json({ success: true, message: 'הכספת נפתחה!' });
  }

  return res.json({ success: false, message: 'הקוד שגוי, נסה שנית' });
});

// Admin auth helper
const PASS_PATH = path.join(DATA_DIR, 'admin_pass.json');

function getAdminPass() {
  if (fs.existsSync(PASS_PATH)) {
    try { return JSON.parse(fs.readFileSync(PASS_PATH, 'utf8')).password; }
    catch (e) { /* fall through */ }
  }
  return process.env.ADMIN_PASSWORD || 'admin123';
}

function checkAdmin(req) {
  const pass = req.headers['x-admin-token'] || req.query.token;
  return pass === getAdminPass();
}

// API: Admin - get all attempts
app.get('/api/admin/attempts', (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const db = load();
  res.json({ success: true, attempts: db.attempts });
});

// API: Admin - get codes
app.get('/api/admin/codes', (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const data = loadCodes();
  res.json({ success: true, codes: data.codes });
});

// API: Admin - toggle code active/inactive
app.post('/api/admin/codes/toggle', (req, res) => {
  const { token, code } = req.body;
  if (token !== getAdminPass()) return res.status(401).json({ error: 'Unauthorized' });
  const data = loadCodes();
  const entry = data.codes.find(c => c.code === code);
  if (!entry) return res.json({ success: false, message: 'קוד לא נמצא' });
  entry.active = !entry.active;
  saveCodes(data);
  res.json({ success: true, active: entry.active });
});

// API: Admin - get demo codes
app.get('/api/admin/demo', (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const data = loadDemo();
  res.json({ success: true, codes: data.codes });
});

// API: Admin - get master codes
app.get('/api/admin/master', (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const data = loadMaster();
  res.json({ success: true, codes: data.codes });
});

// API: Admin - get stats
app.get('/api/admin/stats', (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  const allLeads = Object.values(loadLeads().leads);
  const activeLeads = allLeads.filter(l => (l.status || 'active') === 'active');
  const archivedCount = allLeads.filter(l => l.status === 'archived').length;
  const trashedCount = allLeads.filter(l => l.status === 'trashed').length;
  const codes = loadCodes().codes;
  const masterCodes = loadMaster().codes;

  // Count events across active leads only
  let totalEvents = {};
  activeLeads.forEach(l => {
    (l.events || []).forEach(e => {
      totalEvents[e.event] = (totalEvents[e.event] || 0) + 1;
    });
  });

  res.json({
    success: true,
    stats: {
      siteEntries: totalEvents['gate_entry'] || 0,
      codesGenerated: codes.length,
      masterCodes: masterCodes.length,
      enteredVault: activeLeads.filter(l => l.vaultOpened).length,
      openedVault: activeLeads.filter(l => l.vaultOpened).length,
      printedLetter: activeLeads.filter(l => l.printedLetter).length,
      printedCertificate: activeLeads.filter(l => l.printedCertificate).length,
      clickPurchase: totalEvents['click_purchase'] || 0,
      clickGift: totalEvents['click_gift'] || 0,
      totalLeads: activeLeads.length,
      archivedLeads: archivedCount,
      trashedLeads: trashedCount
    }
  });
});

// API: Admin - get leads (supports ?status=active|archived|trashed, default=active)
app.get('/api/admin/leads', (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const data = loadLeads();
  const statusFilter = req.query.status || 'active';
  let leads;
  if (statusFilter === 'all') {
    leads = Object.values(data.leads).map(l => Object.assign({}, l, { status: l.status || 'active' }));
  } else {
    leads = Object.values(data.leads).filter(l => (l.status || 'active') === statusFilter);
  }
  res.json({ success: true, leads });
});

// API: Admin - change lead status (archive / trash / restore)
app.post('/api/admin/leads/status', (req, res) => {
  const { token, code, status } = req.body;
  if (token !== getAdminPass()) return res.status(401).json({ error: 'Unauthorized' });
  if (!code || !['active', 'archived', 'trashed'].includes(status)) {
    return res.json({ success: false, message: 'פרמטרים לא תקינים' });
  }
  const data = loadLeads();
  const lead = data.leads[code];
  if (!lead) return res.json({ success: false, message: 'ליד לא נמצא' });
  lead.status = status;
  saveLeads(data);
  res.json({ success: true, status });
});

// API: Admin - permanently delete a lead (only allowed if it's in trash)
app.post('/api/admin/leads/delete', (req, res) => {
  const { token, code } = req.body;
  if (token !== getAdminPass()) return res.status(401).json({ error: 'Unauthorized' });
  if (!code) return res.json({ success: false, message: 'קוד חסר' });
  const data = loadLeads();
  const lead = data.leads[code];
  if (!lead) return res.json({ success: false, message: 'ליד לא נמצא' });
  if (lead.status !== 'trashed') {
    return res.json({ success: false, message: 'ניתן למחוק לצמיתות רק לידים שבפח' });
  }
  delete data.leads[code];
  saveLeads(data);
  res.json({ success: true, deleted: code });
});

// Code generation - no O/I letters
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I, O

function generateCode() {
  const first = CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
  const last = CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
  let digits = '';
  for (let i = 0; i < 8; i++) digits += Math.floor(Math.random() * 10);
  return first + digits + last;
}

// API: Admin - generate batch of codes
app.post('/api/admin/codes/generate', (req, res) => {
  const { token, batch, count } = req.body;
  if (token !== getAdminPass()) return res.status(401).json({ error: 'Unauthorized' });

  const batchNum = parseInt(batch) || 1;
  const codeCount = Math.min(parseInt(count) || 1000, 10000);
  const data = loadCodes();
  const existingCodes = new Set(data.codes.map(c => c.code));
  // Cross-pool uniqueness guard — prevents collision with master/demo codes
  loadMaster().codes.forEach(c => existingCodes.add(c.code));
  loadDemo().codes.forEach(c => existingCodes.add(c.code));

  const newCodes = [];
  let attempts = 0;
  const maxAttempts = codeCount * 50;
  while (newCodes.length < codeCount && attempts < maxAttempts) {
    attempts++;
    const code = generateCode();
    if (!existingCodes.has(code)) {
      existingCodes.add(code);
      newCodes.push({
        code,
        active: true,
        uses: 0,
        batch: batchNum,
        createdAt: new Date().toISOString()
      });
    }
  }

  // Fail loudly if we couldn't generate the full requested count
  if (newCodes.length < codeCount) {
    return res.json({
      success: false,
      message: 'לא ניתן היה לייצר את מלוא הקודים המבוקשים. לא בוצעה שמירה.',
      requested: codeCount,
      generated: newCodes.length
    });
  }

  data.codes.push(...newCodes);
  saveCodes(data);
  res.json({ success: true, generated: newCodes.length, batch: batchNum, requested: codeCount });
});

// API: Admin - get codes by batch
app.get('/api/admin/codes/batch/:batch', (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const batchNum = parseInt(req.params.batch);
  const data = loadCodes();
  const batchCodes = data.codes.filter(c => c.batch === batchNum);
  res.json({ success: true, codes: batchCodes, batch: batchNum });
});

// API: Admin - change password
app.post('/api/admin/password', (req, res) => {
  const { token, currentPassword, newPassword } = req.body;
  if (token !== getAdminPass()) return res.status(401).json({ error: 'Unauthorized' });
  if (currentPassword !== getAdminPass()) return res.json({ success: false, message: 'סיסמה נוכחית שגויה' });
  if (!newPassword || newPassword.length < 4) return res.json({ success: false, message: 'סיסמה חדשה קצרה מדי' });
  fs.writeFileSync(PASS_PATH, JSON.stringify({ password: newPassword }, null, 2), 'utf8');
  res.json({ success: true });
});

// Q&A data
const QA_PATH = path.join(DATA_DIR, 'qa.json');

function loadQA() {
  if (!fs.existsSync(QA_PATH)) return { items: [] };
  try { return JSON.parse(fs.readFileSync(QA_PATH, 'utf8')); }
  catch (e) { return { items: [] }; }
}

function saveQA(data) {
  fs.writeFileSync(QA_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// API: Admin - get Q&A items
app.get('/api/admin/qa', (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const data = loadQA();
  res.json({ success: true, items: data.items });
});

// API: Admin - add Q&A item
app.post('/api/admin/qa', (req, res) => {
  const { token, question, answer } = req.body;
  if (token !== getAdminPass()) return res.status(401).json({ error: 'Unauthorized' });
  if (!question || !answer) return res.json({ success: false, message: 'חסרים שדות' });
  const data = loadQA();
  data.items.push({ question, answer, createdAt: new Date().toISOString() });
  saveQA(data);
  res.json({ success: true });
});

// API: Admin - delete Q&A item
app.post('/api/admin/qa/delete', (req, res) => {
  const { token, index } = req.body;
  if (token !== getAdminPass()) return res.status(401).json({ error: 'Unauthorized' });
  const data = loadQA();
  if (index < 0 || index >= data.items.length) return res.json({ success: false });
  data.items.splice(index, 1);
  saveQA(data);
  res.json({ success: true });
});

// API: Admin - edit Q&A item
app.post('/api/admin/qa/edit', (req, res) => {
  const { token, index, question, answer } = req.body;
  if (token !== getAdminPass()) return res.status(401).json({ error: 'Unauthorized' });
  const data = loadQA();
  if (index < 0 || index >= data.items.length) return res.json({ success: false });
  data.items[index].question = question;
  data.items[index].answer = answer;
  data.items[index].updatedAt = new Date().toISOString();
  saveQA(data);
  res.json({ success: true });
});

// API 404 — return proper JSON 404 for unknown /api/* routes
// so they don't fall through to the SPA HTML fallback below.
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: 'Not Found', path: req.path });
});

// SPA fallback
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🔐 הצופן הסודי — Server running on port ${PORT}`);
  console.log(`🌐 http://localhost:${PORT}\n`);
});
