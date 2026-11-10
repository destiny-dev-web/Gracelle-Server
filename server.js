'use strict';
/* GRACELLE server: storefront API + staff portal API. No npm packages needed (Node 18+). */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { DEPTS, D, STATES, C, MENU } = require('./schema');

/* ---------- config (.env) ---------- */
try { fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(l => { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }); } catch (e) {}
const ENV = process.env, PORT = +ENV.PORT || 3000, SECRET = ENV.JWT_SECRET || 'dev-secret-change-me';
const ORIGINS = (ENV.CORS_ORIGIN || '*').split(',').map(s => s.trim());
const DATA = ENV.DATA_DIR || path.join(__dirname, 'data'), UP = path.join(DATA, 'uploads');
const VT = +ENV.VOUCHER_THRESHOLD || 50000, VOUCHER = +ENV.VOUCHER_AMOUNT || 2000;
const IDLE = (+ENV.STAFF_IDLE_MINUTES || 10) * 60;
fs.mkdirSync(UP, { recursive: true });
if (SECRET === 'dev-secret-change-me') console.warn('WARNING: set JWT_SECRET in .env before going live.');

/* ---------- storage (JSON file; swap for a real database when you scale) ---------- */
const FILE = path.join(DATA, 'db.json');
const WB0 = () => ({ products: [], banners: [], sections: [], ann: [], camps: [], flash: null, bf: false, disc: {}, featured: [], bundles: [], featuredCamps: [], faqs: [], testi: [], supAnn: [], contact: {}, ship: {}, fees: {}, unavail: {}, stock: {}, pay: [], bank: [], inbox: [], topVideo: null });
let db = { seq: 1000, users: [], customers: [], rec: {}, tasks: [], msgs: [], projects: [], att: [], notes: [], ann: [], log: [], vouchers: [], reviews: [], resets: {}, web: {} };
try { db = { ...db, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch (e) {}
db.web = { ...WB0(), ...db.web }; const WB = db.web;
let tm = null; const save = () => { clearTimeout(tm); tm = setTimeout(flush, 120); };
function flush() { fs.writeFileSync(FILE + '.tmp', JSON.stringify(db)); fs.renameSync(FILE + '.tmp', FILE); }
process.on('SIGINT', () => { flush(); process.exit(0); }); process.on('SIGTERM', () => { flush(); process.exit(0); });
const nid = () => ++db.seq, now = () => Date.now(), T = () => new Date().toISOString().slice(0, 10);

/* ---------- helpers ---------- */
const R = k => db.rec[k] || (db.rec[k] = []), L = (k, st) => R(k).filter(r => r.st === st);
const sum = (k, f, fl) => R(k).filter(fl || (() => 1)).reduce((s, r) => s + (+r.v[f] || 0), 0);
const isEx = u => u.dept.startsWith('Executive'), isHRHead = u => u.dept === D.HR && u.type === 'head';
const mem = d => db.users.filter(u => u.dept === d && u.status === 'Active');
const nt = (to, t) => { db.notes.unshift({ id: nid(), to, t, ts: now() }); db.notes.length = Math.min(db.notes.length, 5000); };
const ntd = (d, t) => mem(d).forEach(u => nt(u.email, t)), ntx = t => db.users.filter(isEx).forEach(u => nt(u.email, t));
const lg = t => { db.log.unshift({ id: nid(), t, ts: now() }); db.log.length = Math.min(db.log.length, 2000); };
const str = (v, n = 2000) => String(v == null ? '' : v).trim().slice(0, n);
const err = (s, m) => Object.assign(new Error(m), { status: s });
const hash = pw => { const s = crypto.randomBytes(16).toString('hex'); return s + ':' + crypto.scryptSync(pw, s, 32).toString('hex'); };
const chk = (pw, h) => { if (!h) return false; const [s, x] = h.split(':'); return crypto.timingSafeEqual(Buffer.from(x, 'hex'), crypto.scryptSync(String(pw), s, 32)); };
const b64 = b => Buffer.from(b).toString('base64url');
const sign = (p, ttl) => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), b = b64(JSON.stringify({ ...p, exp: Math.floor(now() / 1000) + ttl })); return h + '.' + b + '.' + crypto.createHmac('sha256', SECRET).update(h + '.' + b).digest('base64url'); };
const verify = t => { try { const [h, b, s] = t.split('.'), e = crypto.createHmac('sha256', SECRET).update(h + '.' + b).digest('base64url'); if (!crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e))) return null; const p = JSON.parse(Buffer.from(b, 'base64url')); return p.exp > now() / 1000 ? p : null; } catch (e) { return null; } };
const tries = new Map();
function limit(key, max = 8) { const a = (tries.get(key) || []).filter(t => now() - t < 6e5); if (a.length >= max) throw err(429, 'Too many attempts. Try again in a few minutes.'); a.push(now()); tries.set(key, a); }
const okEmail = e => /^\S+@\S+\.\S+$/.test(e) && e.length < 120;

/* ---------- email (Resend API; falls back to console log) ---------- */
async function mail(to, subject, text) {
  if (ENV.MAIL_PROVIDER === 'resend' && ENV.RESEND_API_KEY) {
    try {
      const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + ENV.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: ENV.MAIL_FROM || 'GRACELLE <onboarding@resend.dev>', to: [to], subject, text }) });
      if (r.ok) return { sent: true };
      return { sent: false, reason: 'Email service refused: ' + (await r.text()).slice(0, 200) };
    } catch (e) { return { sent: false, reason: 'Email service unreachable' }; }
  }
  console.log('\n[EMAIL not configured, would send]\nTo: ' + to + '\nSubject: ' + subject + '\n' + text + '\n');
  return { sent: false, reason: 'Email is not configured on the server yet (see README: MAIL_PROVIDER).' };
}
const staffMail = (u, code) => `GRACELLE HUMAN RESOURCES & ADMINISTRATION

SUBJECT: STAFF PORTAL ACCESS GRANTED

Dear Staff Member,

Welcome on board!

We are pleased to inform you that your access to the GRACELLE Administrative Forum Group has been successfully approved and activated.

As a registered member of the organisation, you have been issued a unique access code which grants you entry into your designated Staff Portal.

${u.type === 'head' ? 'YOUR STAFF ACCESS CODE: ' + code + '\nYOUR STAFF ID NUMBER: ' + u.id : 'YOUR STAFF ID NUMBER: ' + u.id}

This code serves as your personal authentication credential for accessing the staff portal and other authorised internal administrative platforms.

IMPORTANT SECURITY & ACCESS GUIDELINES
1. Your access code is strictly personal and must not be shared, transferred, or disclosed to another individual.
2. Staff members are expected to comply with all organisational policies, administrative guidelines, and internal communication protocols.
3. Your access code should be kept confidential at all times. In the event of a lost or compromised code, kindly contact the Human Resources Department for assistance.
4. Access codes may be retrieved, reset, suspended, or revoked by the HR/Administrative Department where necessary.
5. In the event of resignation, termination of appointment, dismissal, or any other form of disengagement from the organisation, your portal access and associated credentials may be withdrawn immediately.
6. Unauthorised access, misuse of company resources, or disclosure of confidential organisational information may attract appropriate disciplinary action.

Please ensure that you familiarise yourself with the staff portal and all applicable organisational guidelines.

Once again, welcome to the team. We look forward to your commitment, professionalism, and valuable contributions to the organisation.

GRACE IN EVERY STYLE.
Human Resources & Administration
Gracelle`;

/* ---------- permissions (same rules as the portal) ---------- */
const WORK = ['leave', 'rpt', 'doc', 'perf', 'rem'], READALL = [D.HR, D.BI, D.OP];
function can(u, k, m) { const cc = C[k]; if (!cc || cc.ro) return false; if (isEx(u)) return true; const l = m === 'ap' && cc.ap !== undefined ? cc.ap : cc.w; if (l === '*') return true; return !!l && l.split(',').some(x => D[x] === u.dept); }
const menuKeys = u => { const code = isEx(u) ? 'EX' : Object.keys(D).find(x => D[x] === u.dept); return new Set((MENU[code] || []).map(x => Array.isArray(x) ? x[0] : x)); };
function readable(u, k) { const cc = C[k]; if (!cc) return false; if (cc.pv) return isEx(u) || u.dept === D.HR; return isEx(u) || READALL.includes(u.dept) || WORK.includes(k) || menuKeys(u).has(k) || can(u, k, 'w'); }
function vis(u, k) { const cc = C[k]; if (!readable(u, k)) return []; const top = isEx(u) || u.dept === D.HR; let r = R(k); if (cc.own && !top && !can(u, k, 'ap')) r = r.filter(x => x.by === u.email || x.v.email === u.email); if (cc.dp && !top) r = r.filter(x => x.dept === u.dept); return r; }
const fields = f => f.split('|').map(x => { const [k, l, t, o] = x.split(':'); return { k, l, t: t || '' }; });

/* ---------- what each department tool publishes to the storefront ---------- */
const H = {
  prod() { WB.products = L('prod', 'Published').map(r => ({ ...r.v, rid: r.id, price: +r.v.price })); },
  disc() { WB.disc = {}; L('disc', 'Approved').forEach(r => WB.disc[r.v.product] = +r.v.pct); },
  feat() { WB.featured = L('feat', 'Approved').map(r => r.v); }, bund() { WB.bundles = L('bund', 'Approved').map(r => r.v); },
  camp() { WB.camps = L('camp', 'Active').map(r => r.v); WB.flash = WB.camps.find(x => x.kind === 'Flash Sale') || null; WB.bf = WB.camps.some(x => x.kind === 'Black Friday'); },
  acc() { WB.bank = L('acc', 'Active').map(r => r.v); }, pm() { WB.pay = L('pm', 'Active').map(r => r.v); },
  vban() { const v = L('vban', 'Live').slice(-1)[0]; WB.topVideo = v ? v.v : null; },
  ban() { WB.banners = L('ban', 'Live').map(r => r.v).sort((a, b) => a.ord - b.ord); },
  sect() { WB.sections = L('sect', 'Live').map(r => r.v); }, wann() { WB.ann = L('wann', 'Live').map(r => r.v); }, fcam() { WB.featuredCamps = L('fcam', 'Live').map(r => r.v); },
  faq() { WB.faqs = L('faq', 'Live').map(r => r.v); }, test() { WB.testi = L('test', 'Approved').map(r => r.v); }, ann2() { WB.supAnn = L('ann2', 'Live').map(r => r.v); },
  dset(r, m) { WB.ship = {}; R('dset').forEach(x => WB.ship[x.v.state] = x.v); if (m === 'add' && r.v.avail === 'No') ntx('Shipping unavailable: ' + r.v.state + '. A public announcement may be needed.'); },
  dchg(r, m) { WB.fees = {}; L('dchg', 'Approved').forEach(x => WB.fees[x.v.zone] = +x.v.fee); if (m === 'add') ntd(D.FN, 'Delivery charge change requested: ' + r.v.zone); },
  cnote() { WB.inbox = R('cnote').map(r => r.v); }, stk() { WB.stock = {}; R('stk').forEach(r => WB.stock[r.v.prod] = (WB.stock[r.v.prod] || 0) + (+r.v.qty || 0)); },
  wreq(r, m) { WB.unavail = {}; L('wreq', 'Approved').filter(x => x.v.kind === 'Flag product unavailable').forEach(x => WB.unavail[x.v.detail] = 1); if (m === 'add') { ntd(D.LG, 'Website request: ' + r.v.kind); ntx('Website request from Operations: ' + r.v.kind); } },
  pol(r, m) { L('pol', 'Approved').forEach(x => { WB.contact[x.v.kind] = x.v.detail; }); if (m === 'add') ntx('Change request from Customer Care: ' + r.v.kind); },
  prod_add(r) { ntd(D.FN, 'New product awaiting price approval: ' + r.v.name); }, disc_add(r) { ntd(D.FN, 'Discount proposal: ' + r.v.product + ' ' + r.v.pct + '%'); },
  bund_add(r) { ntd(D.FN, 'Bundle proposal: ' + r.v.name); }, ref_add(r) { ntd(D.FN, 'Refund recommended: order ' + r.v.order); },
  feat_add(r) { ntd(D.PR, 'Featured product recommendation: ' + r.v.product); }, test_add() { ntd(D.PR, 'Testimonial awaiting approval'); },
  preq_add(r) { ntd(D.FN, 'Purchase request: ' + r.v.item); }, brec_add() { ntx('New recommendation from BI&A'); }, oesc_add(r) { ntx('Escalation from Operations: ' + r.v.title); },
  memo(r, m) { if (m !== 'add') return; const t = (r.v.kind === 'Disciplinary action' ? 'DISCIPLINARY ACTION: ' : r.v.kind + ': ') + r.v.title; r.v.to === 'All staff' ? nt('*', t) : ntd(r.v.to, t); },
  otask(r, m) { if (m !== 'add') return; mem(r.v.dept).forEach(u => { db.tasks.push({ id: nid(), dept: r.v.dept, title: r.v.title, pri: r.v.pri, due: r.v.due, by: 'Operations', to: u.email, status: 'To do' }); nt(u.email, 'New task from Operations: ' + r.v.title); }); },
  pay(r, m) { if (r.st === 'Verified' && (m === 'st' || m === 'add')) confirmOrder(r.v.order); },
  ord(r, m) { if (m === 'st') { const e = r.v.email; if (e) nt('cust:' + e, 'Order ' + r.v.code + ' is now ' + r.st); } }
};
function confirmOrder(code) { const o = R('ord').find(x => x.v.code && x.v.code === code); if (!o) return; if (o.v.pay !== 'Confirmed') { o.v.pay = 'Confirmed'; if (o.v.email && +o.v.tot >= VT) { db.vouchers.push({ id: nid(), email: o.v.email, amt: VOUCHER, order: code, ts: now() }); } } }
function hook(k, r, m, me) {
  if (H[k]) H[k](r, m); if (m === 'add' && H[k + '_add']) H[k + '_add'](r);
  if (m === 'st' && me && r.by !== me.email) nt(r.by, C[k].t + ': "' + Object.values(r.v)[0] + '" is now ' + r.st);
}
Object.keys(H).filter(k => C[k] && !k.includes('_')).forEach(k => { try { H[k]({ v: {} }, 'boot'); } catch (e) {} });
H.stk();

/* ---------- uploads ---------- */
const MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf', 'video/mp4': 'mp4', 'video/webm': 'webm' };
const MIMEBACK = Object.fromEntries(Object.entries(MIME).map(([a, b]) => [b, a]));
async function upload(c, maxMB) {
  const ty = (c.req.headers['content-type'] || '').split(';')[0], ext = MIME[ty]; if (!ext) throw err(415, 'Allowed files: png, jpg, webp, gif, pdf, mp4, webm');
  const lim = (ty.startsWith('video') ? 40 : maxMB) * 1048576, buf = await raw(c.req, lim);
  if (!buf.length) throw err(400, 'Empty file'); const name = crypto.randomBytes(12).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(UP, name), buf); return { url: '/uploads/' + name };
}
function raw(req, lim) { return new Promise((ok, no) => { const a = []; let n = 0; req.on('data', d => { n += d.length; if (n > lim) { no(err(413, 'File too large')); req.destroy(); } else a.push(d); }); req.on('end', () => ok(Buffer.concat(a))); req.on('error', no); }); }
const fileUrl = u => typeof u === 'string' && /^\/uploads\/[a-f0-9]+\.\w+$/.test(u);

/* ---------- router ---------- */
const routes = []; const route = (m, p, f) => routes.push({ m, re: new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), f });
function staff(c) { const t = (c.req.headers.authorization || '').replace('Bearer ', ''), p = verify(t); if (!p || p.t !== 'staff') throw err(401, 'Session expired. Please log in again.'); const u = db.users.find(x => x.id === p.sub); if (!u || u.status !== 'Active') throw err(401, 'Account not active.'); c.token = sign({ sub: u.id, t: 'staff' }, IDLE); return u; }
function cust(c) { const t = (c.req.headers.authorization || '').replace('Bearer ', ''), p = verify(t); if (!p || p.t !== 'cust') throw err(401, 'Please log in.'); const u = db.customers.find(x => x.id === p.sub); if (!u) throw err(401, 'Please log in.'); return u; }
const pubStaff = (u, full) => ({ id: u.id, email: u.email, dept: u.dept, pos: u.pos, type: u.type, status: u.status, pf: full ? u.pf : { name: u.pf.name } });
const pubCust = u => ({ id: u.id, name: u.name, email: u.email, phone: u.phone });

/* ===== STAFF ===== */
route('POST', '/api/staff/login', async c => {
  const e = str(c.body.email).toLowerCase(), k = str(c.body.key); limit('s:' + c.ip + e);
  const u = db.users.find(x => x.email === e); const ok = u && (u.type === 'head' ? chk(k, u.ch) : u.id === k);
  if (!ok) throw err(401, 'Wrong email or access code / ID number.'); if (u.status !== 'Active') throw err(403, 'This account is suspended. Contact HR.');
  return { token: sign({ sub: u.id, t: 'staff' }, IDLE), me: pubStaff(u, true), idleSeconds: IDLE };
});
route('GET', '/api/staff/sync', c => {
  const u = staff(c), top = isEx(u) || u.dept === D.HR, ops = u.dept === D.OP, rec = {};
  Object.keys(C).forEach(k => { const r = vis(u, k); if (r.length) rec[k] = r; });
  const team = db.users.filter(x => top || x.dept === u.dept || ops || READALL.includes(u.dept));
  return {
    me: pubStaff(u, true), users: db.users.map(x => pubStaff(x, top || x.id === u.id)), rec,
    tasks: db.tasks.filter(t => top || ops || READALL.includes(u.dept) || t.to === u.email || (u.type === 'head' && t.dept === u.dept)),
    msgs: db.msgs.filter(m => isEx(u) || m.dept === u.dept), projects: db.projects.filter(p => isEx(u) || p.dept === u.dept),
    att: db.att.filter(a => top || READALL.includes(u.dept) || a.email === u.email || (u.type === 'head' && db.users.find(x => x.email === a.email)?.dept === u.dept)),
    notes: db.notes.filter(n => n.to === u.email || n.to === '*'), ann: db.ann, log: top ? db.log.slice(0, 200) : [], web: WB
  };
});
route('POST', '/api/upload', async c => { staff(c); return upload(c, 5); });
route('POST', '/api/rec/:k', c => {
  const u = staff(c), k = c.p.k, cc = C[k]; if (!cc || !can(u, k, 'w')) throw err(403, 'Not allowed.');
  const v = {}; fields(cc.f).forEach(f => { let x = c.body.v && c.body.v[f.k]; if (f.t === 'f' || f.t === 'v') { if (fileUrl(x)) { v[f.k] = x; v[f.k + '_n'] = str(c.body.v[f.k + '_n'], 120); } } else v[f.k] = str(x, f.t === 't' ? 5000 : 300); });
  const f0 = fields(cc.f)[0]; if (f0.t !== 'f' && f0.t !== 'v' && !v[f0.k]) throw err(400, 'Fill in ' + f0.l);
  const r = { id: nid(), ts: now(), by: u.email, dept: u.dept, v, st: cc.s ? cc.s.split(',')[0] : '' };
  if (k === 'pay') r.st = (+v.amt === +v.exp && v.amt) ? 'Verified' : 'Mismatch';
  R(k).push(r); lg(u.email + ' added to ' + cc.t); hook(k, r, 'add', u); save(); return { ok: true, id: r.id };
});
route('PATCH', '/api/rec/:k/:id', c => {
  const u = staff(c), k = c.p.k, cc = C[k], r = cc && R(k).find(x => x.id == c.p.id); if (!r) throw err(404, 'Not found.');
  if (c.body.fired && k === 'rem' && r.by === u.email) { r.fired = 1; save(); return { ok: true }; }
  if (c.body.reply !== undefined && k === 'enq' && can(u, 'enq', 'w')) { r.v.reply = str(c.body.reply, 3000); if (r.st === 'Open') r.st = 'Answered'; if (r.by.includes('@')) nt('cust:' + r.by, 'Reply from GRACELLE: ' + r.v.reply.slice(0, 200)); save(); return { ok: true }; }
  if (!can(u, k, 'ap')) throw err(403, 'Not allowed.'); const st = str(c.body.st); if (!cc.s || !cc.s.split(',').includes(st)) throw err(400, 'Invalid status.');
  r.st = st; lg(u.email + ': ' + cc.t + ' -> ' + st); hook(k, r, 'st', u); save(); return { ok: true };
});
route('DELETE', '/api/rec/:k/:id', c => {
  const u = staff(c), k = c.p.k, r = C[k] && R(k).find(x => x.id == c.p.id); if (!r) throw err(404, 'Not found.');
  if (!can(u, k, 'w') || (r.by !== u.email && !isEx(u))) throw err(403, 'Not allowed.');
  db.rec[k] = R(k).filter(x => x !== r); hook(k, { v: {} }, 'del', u); save(); return { ok: true };
});
route('POST', '/api/stock/:id/move', c => {
  const u = staff(c); if (!can(u, 'stk', 'w')) throw err(403, 'Not allowed.'); const r = R('stk').find(x => x.id == c.p.id); if (!r) throw err(404, 'Not found.');
  const t = str(c.body.type), q = Math.floor(+c.body.qty); if (!['Received', 'Issued', 'Adjusted'].includes(t) || !(q >= 0)) throw err(400, 'Invalid movement.');
  let n = +r.v.qty || 0; n = t === 'Received' ? n + q : t === 'Issued' ? Math.max(0, n - q) : q; r.v.qty = n;
  R('mov').push({ id: nid(), ts: now(), by: u.email, dept: u.dept, st: '', v: { prod: r.v.prod, size: r.v.size, colour: r.v.colour, type: t, qty: q, after: n } });
  H.stk(); if (n <= +r.v.low) ntd(D.IN, 'Low stock: ' + r.v.prod + ' (' + n + ' left)'); lg('Stock ' + t + ': ' + r.v.prod); save(); return { ok: true };
});
/* HR */
const hr = c => { const u = staff(c); if (!isHRHead(u)) throw err(403, 'Only HR can do this.'); return u; };
route('POST', '/api/hr/users', async c => {
  hr(c); const b = c.body, email = str(b.email).toLowerCase(), pos = str(b.pos, 80), type = b.type === 'staff' ? 'staff' : 'head', code = str(b.code, 80);
  if (!okEmail(email)) throw err(400, 'Enter a valid email.'); if (!DEPTS.includes(b.dept)) throw err(400, 'Pick a department.'); if (!pos) throw err(400, 'Enter the position.');
  if (type === 'head' && code.length < 6) throw err(400, 'Access key must be 6+ characters.'); if (db.users.some(x => x.email === email)) throw err(409, 'This email is already registered.');
  let id; do { id = 'GRC-' + (100000 + crypto.randomInt(900000)); } while (db.users.some(x => x.id === id));
  const u = { id, email, dept: b.dept, pos, type, ch: type === 'head' ? hash(code) : '', status: 'Active', pf: {}, created: now() };
  db.users.push(u); lg('Access granted: ' + email + ' (' + u.dept + ')'); save();
  const m = await mail(email, 'STAFF PORTAL ACCESS GRANTED', staffMail(u, code)); return { user: pubStaff(u, true), mail: m };
});
route('POST', '/api/hr/users/:id/send', async c => { hr(c); const u = db.users.find(x => x.id === c.p.id); if (!u) throw err(404, 'Not found.'); const code = str(c.body.code, 80); if (u.type === 'head' && !chk(code, u.ch)) throw err(400, 'Type the current access key to send it (the server never stores it in readable form).'); return { mail: await mail(u.email, 'STAFF PORTAL ACCESS GRANTED', staffMail(u, code)) }; });
route('PATCH', '/api/hr/users/:id', c => {
  const me = hr(c), u = db.users.find(x => x.id === c.p.id); if (!u) throw err(404, 'Not found.');
  if (c.body.code !== undefined) { const k = str(c.body.code, 80); if (u.type !== 'head' || k.length < 6) throw err(400, 'Access key must be 6+ characters.'); u.ch = hash(k); lg('Access code changed for ' + u.email); }
  if (c.body.status) { if (u.id === me.id) throw err(400, 'You cannot suspend yourself.'); if (!['Active', 'Suspended'].includes(c.body.status)) throw err(400, 'Bad status.'); u.status = c.body.status; }
  save(); return { ok: true };
});
route('DELETE', '/api/hr/users/:id', c => { const me = hr(c); if (c.p.id === me.id) throw err(400, 'You cannot delete yourself.'); db.users = db.users.filter(x => x.id !== c.p.id); lg('Staff removed: ' + c.p.id); save(); return { ok: true }; });
/* workspace */
route('PUT', '/api/staff/profile', c => { const u = staff(c); ['name', 'phone', 'nat', 'soo', 'dob', 'addr', 'nn', 'np', 'na'].forEach(k => { if (c.body[k] !== undefined) u.pf[k] = str(c.body[k], 200); }); save(); return { ok: true }; });
route('POST', '/api/msgs', c => { const u = staff(c), t = str(c.body.t, 3000); if (!t) throw err(400, 'Empty message.'); db.msgs.push({ id: nid(), dept: u.dept, u: u.pf.name || u.email, t, ts: now() }); mem(u.dept).filter(m => m.email !== u.email).forEach(m => nt(m.email, 'New message in ' + u.dept + ' group')); save(); return { ok: true }; });
route('PATCH', '/api/msgs/:id/pin', c => { const u = staff(c); if (u.type !== 'head') throw err(403, 'Only heads can pin.'); const m = db.msgs.find(x => x.id == c.p.id && (x.dept === u.dept || isEx(u))); if (!m) throw err(404, 'Not found.'); m.pin = !m.pin; save(); return { ok: true }; });
route('POST', '/api/projects', c => { const u = staff(c); if (u.type !== 'head') throw err(403, 'Only heads can create projects.'); const t = str(c.body.title, 150); if (!t) throw err(400, 'Add a title.'); db.projects.push({ id: nid(), dept: u.dept, title: t, desc: str(c.body.desc, 3000), due: str(c.body.due, 20), pri: ['High', 'Medium', 'Low'].includes(c.body.pri) ? c.body.pri : 'Medium', status: 'Active' }); mem(u.dept).forEach(m => nt(m.email, 'New project: ' + t)); lg('Project created: ' + t); save(); return { ok: true }; });
route('PATCH', '/api/projects/:id', c => { const u = staff(c); if (u.type !== 'head') throw err(403, 'Only heads can close projects.'); const p = db.projects.find(x => x.id == c.p.id && (x.dept === u.dept || isEx(u))); if (!p) throw err(404, 'Not found.'); p.status = 'Done'; save(); return { ok: true }; });
route('POST', '/api/tasks', c => {
  const u = staff(c); if (u.type !== 'head') throw err(403, 'Only heads can assign tasks.'); const t = str(c.body.title, 200), to = (c.body.to || []).filter(e => mem(u.dept).some(m => m.email === e)); if (!t) throw err(400, 'Add the task.'); if (!to.length) throw err(400, 'Select who it is for.');
  to.forEach(e => { db.tasks.push({ id: nid(), dept: u.dept, title: t, pri: ['High', 'Medium', 'Low'].includes(c.body.pri) ? c.body.pri : 'Medium', due: str(c.body.due, 20), by: u.pf.name || u.email, to: e, status: 'To do' }); nt(e, 'New task assigned: ' + t); }); lg('Task assigned to ' + to.length + ' staff: ' + t); save(); return { ok: true, n: to.length };
});
route('PATCH', '/api/tasks/:id', c => { const u = staff(c), t = db.tasks.find(x => x.id == c.p.id); if (!t || t.to !== u.email) throw err(404, 'Not found.'); if (!['To do', 'In progress', 'Done'].includes(c.body.status)) throw err(400, 'Bad status.'); t.status = c.body.status; save(); return { ok: true }; });
route('POST', '/api/announcements', c => { const u = staff(c); if (!isEx(u) && !isHRHead(u)) throw err(403, 'Only management can publish.'); const t = str(c.body.t, 500); if (!t) throw err(400, 'Empty.'); db.ann.unshift({ id: nid(), t, by: u.pf.name || u.email, ts: now() }); nt('*', 'Announcement: ' + t); save(); return { ok: true }; });
route('POST', '/api/attendance/sign', c => {
  const u = staff(c); if (str(c.body.code) !== 'GRCATT:' + u.dept + ':' + T()) throw err(400, 'That QR code is not valid for your department today.');
  if (db.att.some(a => a.email === u.email && a.d === T())) return { ok: true, already: true }; db.att.push({ id: nid(), email: u.email, d: T(), ts: now() }); lg((u.pf.name || u.email) + ' signed in'); save(); return { ok: true };
});

/* ===== PUBLIC STOREFRONT ===== */
const revMap = () => { const m = {}; db.reviews.slice(-500).forEach(r => (m[r.product] = m[r.product] || []).push({ s: r.s, t: r.t, u: r.u, ts: r.ts })); return m; };
route('GET', '/api/public/storefront', () => { const { inbox, ...w } = WB; return { ...w, reviews: revMap(), voucherThreshold: VT }; });
route('POST', '/api/auth/signup', c => {
  const b = c.body, email = str(b.email).toLowerCase(), name = str(b.name, 80), phone = str(b.phone, 30), pw = String(b.password || ''); limit('su:' + c.ip, 10);
  if (!okEmail(email) || !name || phone.replace(/\D/g, '').length < 10 || pw.length < 6) throw err(400, 'Enter your name, a valid email, a phone number and a 6+ character password.');
  if (db.customers.some(x => x.email === email)) throw err(409, 'This email already has an account. Log in instead.');
  const u = { id: nid(), email, name, phone, ph: hash(pw), created: now() }; db.customers.push(u); save(); return { token: sign({ sub: u.id, t: 'cust' }, 7 * 86400), user: pubCust(u) };
});
route('POST', '/api/auth/login', c => { const e = str(c.body.email).toLowerCase(); limit('cl:' + c.ip + e); const u = db.customers.find(x => x.email === e); if (!u || !chk(c.body.password || '', u.ph)) throw err(401, 'Wrong email or password.'); return { token: sign({ sub: u.id, t: 'cust' }, 7 * 86400), user: pubCust(u) }; });
route('POST', '/api/auth/forgot', async c => {
  const e = str(c.body.email).toLowerCase(); limit('cf:' + c.ip + e, 5); const u = db.customers.find(x => x.email === e);
  if (u) { const code = String(crypto.randomInt(100000, 1000000)); db.resets[e] = { h: hash(code), exp: now() + 9e5, n: 0 }; save(); await mail(e, 'Your GRACELLE password reset code', 'Hello ' + u.name + ',\n\nYour GRACELLE password reset code is ' + code + '. It expires in 15 minutes.\n\nIf you did not ask for this, ignore this email.\n\nGRACELLE'); }
  return { ok: true, message: 'If that email has an account, a reset code is on its way.' };
});
route('POST', '/api/auth/reset', c => {
  const e = str(c.body.email).toLowerCase(), r = db.resets[e], u = db.customers.find(x => x.email === e), pw = String(c.body.password || ''); limit('cr:' + c.ip + e, 8);
  if (!r || !u || r.exp < now() || r.n > 5 || !chk(String(c.body.code || ''), r.h)) { if (r) r.n++; throw err(400, 'Wrong or expired code.'); } if (pw.length < 6) throw err(400, 'Password must be 6+ characters.');
  u.ph = hash(pw); delete db.resets[e]; save(); return { ok: true };
});
route('GET', '/api/auth/me', c => { const u = cust(c); return { user: pubCust(u), vouchers: db.vouchers.filter(v => v.email === u.email) }; });
const sold = n => { const rows = R('stk').filter(r => r.v.prod === n); return rows.length ? rows.reduce((s, r) => s + (+r.v.qty || 0), 0) : null; };
route('POST', '/api/orders', c => {
  const u = cust(c), b = c.body; limit('o:' + u.id, 20); const items = Array.isArray(b.items) ? b.items.slice(0, 40) : []; if (!items.length) throw err(400, 'Your cart is empty.');
  if (!fileUrl(b.receipt)) throw err(400, 'Upload your payment receipt first.'); const del = b.mode === 'delivery';
  let sub = 0; const lines = [];
  items.forEach(i => { const p = WB.products.find(x => x.name === i.name), q = Math.floor(+i.qty); if (!p || WB.unavail[p.name]) throw err(400, (i.name || 'An item') + ' is not available.'); if (!(q >= 1 && q <= 20)) throw err(400, 'Bad quantity.'); const av = sold(p.name); if (av !== null && av < q) throw err(409, p.name + ' is sold out or low on stock.'); const pr = Math.round(p.price * (1 - (WB.disc[p.name] || 0) / 100)); sub += pr * q; lines.push({ p, q, size: str(i.size, 10), colour: str(i.colour, 30), pr }); });
  let fee = 0, loc = 'Store pickup';
  if (del) { const st = str(b.state, 40), city = str(b.city, 60); if (!STATES.includes(st) || !city) throw err(400, 'Choose your delivery state and city.'); if (WB.ship[st] && WB.ship[st].avail === 'No') throw err(400, 'Sorry, we do not deliver to ' + st + ' yet.'); const within = st === 'Rivers' && ['Port Harcourt', 'Obio-Akpor'].includes(city), zone = within ? 'Within Port Harcourt' : 'Outside Port Harcourt'; fee = WB.fees[zone] != null ? WB.fees[zone] : (within ? 2500 : 3500); loc = city + ', ' + st; }
  let code; do { code = 'GR' + crypto.randomInt(100000, 1000000); } while (R('ord').some(x => x.v.code === code)); const tot = sub + fee;
  lines.forEach(l => { let left = l.q; const rows = R('stk').filter(r => r.v.prod === l.p.name).sort((a, b) => (b.v.size === l.size && b.v.colour === l.colour) - (a.v.size === l.size && a.v.colour === l.colour)); for (const r of rows) { if (left <= 0) break; const take = Math.min(left, +r.v.qty || 0); if (take > 0) { r.v.qty = (+r.v.qty) - take; left -= take; R('mov').push({ id: nid(), ts: now(), by: 'storefront', dept: 'Storefront', st: '', v: { prod: r.v.prod, size: r.v.size, colour: r.v.colour, type: 'Sold online', qty: take, after: r.v.qty } }); if (r.v.qty <= +r.v.low) ntd(D.IN, 'Low stock: ' + r.v.prod + ' (' + r.v.qty + ' left)'); } } });
  H.stk();
  const o = { id: nid(), ts: now(), by: u.email, dept: 'Storefront', st: 'New', v: { cust: u.name + ' (' + u.phone + ')', email: u.email, items: lines.map(l => l.p.name + ' x' + l.q + (l.size ? ' (size ' + l.size + ')' : '') + (l.colour ? ' ' + l.colour : '')).join('; '), tot: String(tot), sub: String(sub), fee: String(fee), mode: del ? 'Delivery' : 'Store pickup', loc, pay: 'Receipt uploaded', code, receipt: b.receipt, names: lines.map(l => l.p.name) } };
  R('ord').push(o); R('pay').push({ id: nid(), ts: now(), by: u.email, dept: 'Storefront', st: 'Pending', v: { order: code, exp: String(tot), amt: '', receipt: b.receipt } });
  ntd(D.SL, 'New order ' + code + ' (' + tot + ')'); ntd(D.FN, 'Payment to verify for order ' + code); lg('New online order ' + code); save();
  return { code, total: tot, delivery: fee };
});
route('GET', '/api/orders/mine', c => { const u = cust(c); return { orders: R('ord').filter(o => o.v.email === u.email).reverse().map(o => ({ code: o.v.code, status: o.st, payment: o.v.pay, total: +o.v.tot, delivery: +o.v.fee, mode: o.v.mode, loc: o.v.loc, items: o.v.items, products: o.v.names || [], ts: o.ts, reviewed: db.reviews.filter(r => r.order === o.v.code && r.email === u.email).map(r => r.product) })) }; });
route('POST', '/api/reviews', c => {
  const u = cust(c), b = c.body, o = R('ord').find(x => x.v.code === b.order && x.v.email === u.email), s = Math.floor(+b.s); if (!o) throw err(404, 'Order not found.'); if (!(o.v.names || []).includes(str(b.product))) throw err(400, 'That item is not in this order.');
  if (!(s >= 1 && s <= 5)) throw err(400, 'Pick 1 to 5 stars.'); if (db.reviews.some(r => r.order === b.order && r.product === b.product && r.email === u.email)) throw err(409, 'You already reviewed this item.');
  db.reviews.push({ id: nid(), product: str(b.product, 150), order: b.order, email: u.email, s, t: str(b.t, 1000), u: u.name.split(' ')[0], ts: now() }); save(); return { ok: true };
});
route('POST', '/api/upload/receipt', async c => { const u = cust(c); limit('up:' + u.id, 30); return upload(c, 5); });
route('POST', '/api/chat', c => { const u = cust(c), m = str(c.body.msg, 2000); if (!m) throw err(400, 'Empty message.'); limit('ch:' + u.id, 30); const r = { id: nid(), ts: now(), by: u.email, dept: 'Storefront', st: 'Open', v: { cust: u.name + ' <' + u.email + '>', kind: 'Enquiry', msg: m, reply: '' } }; R('enq').push(r); ntd(D.CC, 'New customer message from ' + u.name); save(); return { ok: true }; });
route('GET', '/api/inbox', c => {
  const u = cust(c), codes = R('ord').filter(o => o.v.email === u.email).map(o => o.v.code);
  const out = [{ from: 'GRACELLE', t: 'Welcome to GRACELLE. News and updates from us appear here.', ts: u.created }];
  WB.supAnn.forEach(a => out.push({ from: 'GRACELLE', t: a.title + ': ' + a.msg, ts: 0 })); R('cnote').filter(n => codes.includes(n.v.order)).forEach(n => out.push({ from: 'Delivery', t: n.v.msg, ts: n.ts }));
  db.notes.filter(n => n.to === 'cust:' + u.email).forEach(n => out.push({ from: 'GRACELLE', t: n.t, ts: n.ts }));
  R('enq').filter(r => r.by === u.email).forEach(r => { out.push({ from: 'You', t: r.v.msg, ts: r.ts, mine: 1 }); if (r.v.reply) out.push({ from: 'Agent', t: r.v.reply, ts: r.ts + 1 }); });
  return { messages: out.sort((a, b) => a.ts - b.ts) };
});
route('GET', '/api/health', () => ({ ok: true, time: now(), mail: ENV.MAIL_PROVIDER === 'resend' && !!ENV.RESEND_API_KEY }));

/* ---------- http server ---------- */
const ip = req => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
function cors(req, res) { const o = req.headers.origin; if (ORIGINS.includes('*')) res.setHeader('Access-Control-Allow-Origin', '*'); else if (o && ORIGINS.includes(o)) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); } res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS'); res.setHeader('Access-Control-Expose-Headers', 'X-Token'); }
async function readJson(req) { const b = await raw(req, 1048576); if (!b.length) return {}; try { return JSON.parse(b.toString()); } catch (e) { throw err(400, 'Bad JSON.'); } }
const STATIC = ENV.STATIC_DIR && path.resolve(ENV.STATIC_DIR);
http.createServer(async (req, res) => {
  cors(req, res); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
  const send = (s, o, h) => { res.writeHead(s, { 'Content-Type': 'application/json', ...(h || {}) }); res.end(JSON.stringify(o)); };
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const u = new URL(req.url, 'http://x'), p = u.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'GET' && p.startsWith('/uploads/')) { const f = path.join(UP, path.basename(p)); if (!fs.existsSync(f)) return send(404, { error: 'Not found' }); res.writeHead(200, { 'Content-Type': MIMEBACK[path.extname(f).slice(1)] || 'application/octet-stream', 'Cache-Control': 'public,max-age=31536000,immutable', 'Cross-Origin-Resource-Policy': 'cross-origin' }); return fs.createReadStream(f).pipe(res); }
    for (const r of routes) { if (r.m !== req.method) continue; const m = p.match(r.re); if (!m) continue; const c = { req, res, ip: ip(req), p: m.groups || {}, q: u.searchParams, body: {}, token: null };
      if (!/\/upload/.test(p) && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) c.body = await readJson(req); const out = await r.f(c); return send(200, out, c.token ? { 'X-Token': c.token } : {}); }
    if (STATIC && req.method === 'GET') { let f = path.join(STATIC, p === '/' ? 'index.html' : p); if (f.startsWith(STATIC) && fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { 'Content-Type': ({ html: 'text/html', css: 'text/css', js: 'text/javascript', png: 'image/png', json: 'application/json' })[path.extname(f).slice(1)] || 'application/octet-stream' }); return fs.createReadStream(f).pipe(res); } }
    send(404, { error: 'Not found' });
  } catch (e) { if (!e.status) console.error(e); send(e.status || 500, { error: e.status ? e.message : 'Server error' }); }
}).listen(PORT, () => {
  if (!db.users.length) { const e = (ENV.SEED_HR_EMAIL || 'hr@gracelle.com').toLowerCase(), k = ENV.SEED_HR_CODE || 'HR-DEMO-2026'; db.users.push({ id: 'GRC-100001', email: e, dept: 'HR', pos: 'HR Manager', type: 'head', ch: hash(k), status: 'Active', pf: {}, created: now() }); flush(); console.log('First run: HR manager created -> ' + e + ' / ' + k + '  (change this!)'); }
  console.log('GRACELLE server on http://localhost:' + PORT + '  | mail: ' + (ENV.MAIL_PROVIDER === 'resend' && ENV.RESEND_API_KEY ? 'resend' : 'NOT configured (emails are printed here)'));
});
setInterval(() => { db.tasks.filter(t => t.status !== 'Done' && t.due && !t.od && t.due < T()).forEach(t => { t.od = 1; nt(t.to, 'Overdue task: ' + t.title); }); save(); }, 6e5);
