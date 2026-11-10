/* Smoke test: node test.js   (starts its own server on port 3999 with a temporary data folder) */
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grc-')), B = 'http://localhost:3999';
const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: 3999, DATA_DIR: dir, JWT_SECRET: 'test-secret' }, stdio: ['ignore', 'pipe', 'inherit'] });
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL:', m)); };
async function api(p, o = {}, tok) { const r = await fetch(B + p, { method: o.method || 'GET', headers: { ...(o.json ? { 'Content-Type': 'application/json' } : {}), ...(o.headers || {}), ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: o.json ? JSON.stringify(o.json) : o.body }); const j = await r.json().catch(() => ({})); return { s: r.status, j, tok: r.headers.get('x-token') }; }
const P = (m, p, json, tok) => api(p, { method: m, json }, tok);
async function run() {
  await new Promise(r => setTimeout(r, 800));
  ok((await api('/api/health')).j.ok, 'health');
  let r = await P('POST', '/api/staff/login', { email: 'hr@gracelle.com', key: 'nope' }); ok(r.s === 401, 'bad login rejected');
  r = await P('POST', '/api/staff/login', { email: 'hr@gracelle.com', key: 'HR-DEMO-2026' }); ok(r.s === 200 && r.j.token, 'hr login'); const hr = r.j.token;
  const mk = async (email, dept, pos, type, code) => (await P('POST', '/api/hr/users', { email, dept, pos, type, code }, hr)).j;
  const fin = await mk('fin@x.com', 'Finance', 'Head of Finance', 'head', 'FinKey-123'); ok(fin.user && fin.user.id.startsWith('GRC-') && fin.mail.sent === false, 'create finance head (mail not configured)');
  const sal = await mk('sales@x.com', 'Sales', 'Head of Sales', 'head', 'SalesKey-1'); const inv = await mk('inv@x.com', 'Inventory', 'Head of Inventory', 'head', 'InvKey-123'); const pr = await mk('pr@x.com', 'PR & Media', 'Head of PR', 'head', 'PrKey-1234');
  const st = await mk('staff@x.com', 'Sales', 'Sales Rep', 'staff'); ok(st.user && st.user.type === 'staff', 'create regular staff');
  r = await P('POST', '/api/hr/users', { email: 'fin@x.com', dept: 'Finance', pos: 'x', type: 'head', code: 'abcdef' }, hr); ok(r.s === 409, 'duplicate email blocked');
  const login = async (e, k) => (await P('POST', '/api/staff/login', { email: e, key: k })).j.token;
  const F = await login('fin@x.com', 'FinKey-123'), S = await login('sales@x.com', 'SalesKey-1'), I = await login('inv@x.com', 'InvKey-123'), PR = await login('pr@x.com', 'PrKey-1234'), SR = await login('staff@x.com', st.user.id);
  ok(F && S && I && PR && SR, 'all logins (code for heads, ID for staff)');
  r = await P('POST', '/api/rec/prod', { v: { name: 'Aurora Heel', cat: 'Female Shoes', sub: 'Heels', desc: 'Nice', price: '20000', colors: 'Black,Brown', sizes: '38,39' } }, S); ok(r.s === 200, 'sales proposes product');
  r = await P('POST', '/api/rec/prod', { v: { name: 'x' } }, F); ok(r.s === 403, 'finance can approve but not add products'); 
  const sync = async t => (await P('GET', '/api/staff/sync', null, t)).j;
  let pid = (await sync(F)).rec.prod[0].id;
  r = await P('PATCH', '/api/rec/prod/' + pid, { st: 'Published' }, S); ok(r.s === 403, 'sales cannot approve own price');
  r = await P('PATCH', '/api/rec/prod/' + pid, { st: 'Published' }, F); ok(r.s === 200, 'finance approves'); let sf = (await api('/api/public/storefront')).j; ok(sf.products.length === 1 && sf.products[0].price === 20000, 'product published to storefront');
  r = await P('POST', '/api/rec/disc', { v: { product: 'Aurora Heel', pct: '10', why: 'launch' } }, S); const did = (await sync(F)).rec.disc[0].id; await P('PATCH', '/api/rec/disc/' + did, { st: 'Approved' }, F); sf = (await api('/api/public/storefront')).j; ok(sf.disc['Aurora Heel'] === 10, 'discount approved -> storefront');
  r = await P('POST', '/api/rec/stk', { v: { prod: 'Aurora Heel', size: '38', colour: 'Black', qty: '2', low: '1' } }, I); ok(r.s === 200, 'inventory adds stock'); r = await P('POST', '/api/rec/prod', { v: { name: 'Hack', price: '1' } }, I); ok(r.s === 403, 'inventory cannot touch products/prices');
  r = await P('POST', '/api/rec/acc', { v: { bank: 'GTB', name: 'GRACELLE', no: '0123456789' } }, F); const aid = (await sync(F)).rec.acc[0].id; await P('PATCH', '/api/rec/acc/' + aid, { st: 'Active' }, F); sf = (await api('/api/public/storefront')).j; ok(sf.bank.length === 1, 'bank details published for checkout');
  r = await P('POST', '/api/rec/ban', { v: { title: 'Sale', btn: 'Shop now', dest: 'Black Friday', val: '', ord: '1' } }, PR); const bid = (await sync(PR)).rec.ban[0].id; await P('PATCH', '/api/rec/ban/' + bid, { st: 'Live' }, PR); sf = (await api('/api/public/storefront')).j; ok(sf.banners.length === 1, 'PR banner live');
  r = await P('POST', '/api/rec/vban', { v: { text: 'CALL FOR DEALS', link: 'https://x.com/v.mp4' } }, PR); const vid = (await sync(PR)).rec.vban[0].id; await P('PATCH', '/api/rec/vban/' + vid, { st: 'Live' }, PR); sf = (await api('/api/public/storefront')).j; ok(sf.topVideo && sf.topVideo.text === 'CALL FOR DEALS', 'top video banner live');
  /* customer */
  r = await P('POST', '/api/auth/signup', { name: 'Ada Obi', email: 'ada@x.com', phone: '08012345678', password: 'secret12' }); ok(r.s === 200, 'customer signup'); let C1 = r.j.token;
  r = await P('POST', '/api/auth/login', { email: 'ada@x.com', password: 'bad' }); ok(r.s === 401, 'customer bad password');
  r = await P('POST', '/api/auth/forgot', { email: 'ada@x.com' }); ok(r.s === 200, 'forgot (code printed in server log, no mail configured)');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  r = await api('/api/upload/receipt', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png }, C1); ok(r.s === 200 && r.j.url, 'receipt upload'); const rc = r.j.url; ok((await fetch(B + rc)).status === 200, 'uploaded file served');
  r = await P('POST', '/api/orders', { items: [{ name: 'Aurora Heel', qty: 1, size: '38', colour: 'Black' }], mode: 'delivery', state: 'Rivers', city: 'Port Harcourt', receipt: rc }, C1); ok(r.s === 200 && r.j.total === 18000 + 2500, 'order total = discounted price + PH delivery 2500 (got ' + JSON.stringify(r.j) + ')'); const code = r.j.code;
  r = await P('POST', '/api/orders', { items: [{ name: 'Aurora Heel', qty: 5 }], mode: 'pickup', receipt: rc }, C1); ok(r.s === 409, 'cannot oversell stock');
  r = await P('POST', '/api/orders', { items: [{ name: 'Aurora Heel', qty: 1 }], mode: 'delivery', state: 'Lagos', city: 'Ikeja', receipt: rc }, C1); ok(r.s === 200 && r.j.total === 18000 + 3500, 'outside city delivery 3500'); 
  r = await P('POST', '/api/orders', { items: [{ name: 'Aurora Heel', qty: 1 }], mode: 'pickup', receipt: rc }, C1); ok(r.s === 409, 'last unit sold -> sold out'); ok((await api('/api/public/storefront')).j.stock['Aurora Heel'] === 0, 'stock synced to 0 (Sold Out)');
  let mine = (await P('GET', '/api/orders/mine', null, C1)).j.orders; ok(mine.length === 2 && mine[1].status === 'New', 'customer sees orders');
  const pays = (await sync(F)).rec.pay; ok(pays.length === 2, 'finance sees payments to verify'); r = await P('PATCH', '/api/rec/pay/' + pays[0].id, { st: 'Verified' }, F); ok(r.s === 200, 'finance verifies payment');
  const ords = (await sync(S)).rec.ord; r = await P('PATCH', '/api/rec/ord/' + ords[0].id, { st: 'Dispatched' }, S); ok(r.s === 200, 'sales updates order status'); mine = (await P('GET', '/api/orders/mine', null, C1)).j.orders; ok(mine.some(o => o.status === 'Dispatched' && o.payment === 'Confirmed'), 'customer sees status + confirmed payment');
  r = await P('POST', '/api/reviews', { order: code, product: 'Aurora Heel', s: 5, t: 'Lovely' }, C1); ok(r.s === 200, 'review after ordering'); ok((await api('/api/public/storefront')).j.reviews['Aurora Heel'].length === 1, 'review public');
  r = await P('POST', '/api/chat', { msg: 'Hello, is it available in red?' }, C1); ok(r.s === 200, 'customer chat');
  const cc = await mk('care@x.com', 'Customer Care', 'Head CC', 'head', 'CareKey-12'); const CC = await login('care@x.com', 'CareKey-12'); const enq = (await sync(CC)).rec.enq[0]; r = await P('PATCH', '/api/rec/enq/' + enq.id, { reply: 'Yes, in 2 weeks.' }, CC); ok(r.s === 200, 'care replies'); ok((await P('GET', '/api/inbox', null, C1)).j.messages.some(m => m.from === 'Agent'), 'reply in customer inbox');
  /* workspace */
  r = await P('POST', '/api/tasks', { title: 'Count stock', to: ['staff@x.com'], pri: 'High', due: '2030-01-01' }, S); ok(r.s === 200 && r.j.n === 1, 'head assigns task'); const tk = (await sync(SR)).tasks[0]; r = await P('PATCH', '/api/tasks/' + tk.id, { status: 'Done' }, SR); ok(r.s === 200, 'staff updates own task');
  r = await P('POST', '/api/attendance/sign', { code: 'GRCATT:Sales:' + new Date().toISOString().slice(0, 10) }, SR); ok(r.s === 200, 'attendance sign-in with QR text'); r = await P('POST', '/api/attendance/sign', { code: 'GRCATT:Finance:' + new Date().toISOString().slice(0, 10) }, SR); ok(r.s === 400, 'wrong department QR rejected');
  r = await P('GET', '/api/staff/sync', null, SR); ok(!JSON.stringify(r.j).includes('"ch"') && !JSON.stringify(r.j).includes('SalesKey'), 'no code hashes leak'); ok(!r.j.rec.dsc && !(r.j.users.find(u => u.id === fin.user.id).pf.phone), 'regular staff cannot see disciplinary records / private profiles');
  r = await P('PATCH', '/api/hr/users/' + sal.user.id, { status: 'Suspended' }, hr); r = await P('GET', '/api/staff/sync', null, S); ok(r.s === 401, 'suspended staff locked out');
  r = await P('GET', '/api/staff/sync', null, 'bad.token.here'); ok(r.s === 401, 'bad token rejected'); r = await P('POST', '/api/hr/users', { email: 'z@z.com', dept: 'HR', pos: 'x', type: 'staff' }, F); ok(r.s === 403, 'only HR creates staff');
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); srv.kill(); process.exit(fail ? 1 : 0);
}
run().catch(e => { console.error(e); srv.kill(); process.exit(1); });
