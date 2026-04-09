require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Data
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'vault.json');
const VAULT_DIR = path.join(__dirname, 'vault');
if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });
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

// Validate code format: letter + 8 digits + letter
function isValidCodeFormat(code) {
  return /^[A-Za-z]\d{8}[A-Za-z]$/.test(code);
}

// Middleware
app.use(express.json());
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

  // Check master codes first
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

// API: Admin - get master codes
app.get('/api/admin/master', (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const data = loadMaster();
  res.json({ success: true, codes: data.codes });
});

// API: Admin - get leads
app.get('/api/admin/leads', (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const data = loadLeads();
  const leads = Object.values(data.leads);
  res.json({ success: true, leads });
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
  const codeCount = Math.min(parseInt(count) || 1000, 1000);
  const data = loadCodes();
  const existingCodes = new Set(data.codes.map(c => c.code));

  const newCodes = [];
  let attempts = 0;
  while (newCodes.length < codeCount && attempts < codeCount * 10) {
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

  data.codes.push(...newCodes);
  saveCodes(data);
  res.json({ success: true, generated: newCodes.length, batch: batchNum });
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

// SPA fallback
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🔐 הצופן הסודי — Server running on port ${PORT}`);
  console.log(`🌐 http://localhost:${PORT}\n`);
});
