const express = require('express'), http = require('http'), path = require('path'), fs = require('fs'), crypto = require('crypto');
const { Server } = require('socket.io'), multer = require('multer'), jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { GOOGLE_CLIENT_ID, JWT_SECRET, OWNER_EMAILS = '', PORT = 3000, NODE_ENV } = process.env;
const MAX = +process.env.MAX_MEMBERS || 4, MAX_MB = +process.env.MAX_UPLOAD_MB || 2048;
if (!GOOGLE_CLIENT_ID || !JWT_SECRET) { console.error('Set GOOGLE_CLIENT_ID and JWT_SECRET (see .env.example)'); process.exit(1); }
const owners = OWNER_EMAILS.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
const gc = new OAuth2Client(GOOGLE_CLIENT_ID);
const app = express(), srv = http.createServer(app), io = new Server(srv);
const UP = path.join(__dirname, 'uploads'); fs.mkdirSync(UP, { recursive: true });
const rooms = new Map(), rnd = n => crypto.randomBytes(n).toString('hex'), safe = s => String(s).replace(/\W/g, '');
const cookie = (h, k) => ((h || '').split(/;\s*/).find(c => c.startsWith(k + '=')) || '').slice(k.length + 1);
const who = h => { try { return jwt.verify(h, JWT_SECRET); } catch { return null; } };
const push = R => io.to(R.id).emit('members', [...R.members.values()]);
const rmFile = R => fs.rmSync(path.join(UP, safe(R.id)), { recursive: true, force: true });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.get('/', (q, r) => r.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/r/:id', (q, r) => r.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/api/config', (q, r) => r.json({ clientId: GOOGLE_CLIENT_ID, max: MAX }));
app.get('/api/me', (q, r) => r.json(who(cookie(q.headers.cookie, 'sess')) || {}));
const ck = (v, age) => `sess=${v}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${age}${NODE_ENV === 'production' ? '; Secure' : ''}`;
app.post('/api/login', async (q, r) => {
  try {
    const p = (await gc.verifyIdToken({ idToken: q.body.credential, audience: GOOGLE_CLIENT_ID })).getPayload();
    const email = (p.email || '').toLowerCase();
    if (!p.email_verified || (owners.length && !owners.includes(email))) return r.status(403).json({ error: 'This Google account is not allowed to host parties.' });
    r.setHeader('Set-Cookie', ck(jwt.sign({ email, name: p.name || email, picture: p.picture || '' }, JWT_SECRET, { expiresIn: '7d' }), 604800));
    r.json({ email });
  } catch { r.status(401).json({ error: 'Google sign-in failed.' }); }
});
app.post('/api/logout', (q, r) => { r.setHeader('Set-Cookie', ck('', 0)); r.json({}); });
app.post('/api/room', (q, r) => {
  const u = who(cookie(q.headers.cookie, 'sess'));
  if (!u) return r.status(401).json({ error: 'Sign in first' });
  const R = { id: rnd(4), key: rnd(8), owner: u.email, members: new Map(), movie: null, state: { playing: false, time: 0, at: Date.now() }, timer: null };
  rooms.set(R.id, R); r.json({ id: R.id, key: R.key });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (q, f, cb) => { const d = path.join(UP, safe(q.params.id)); fs.mkdirSync(d, { recursive: true }); cb(null, d); },
    filename: (q, f, cb) => cb(null, rnd(8) + path.extname(f.originalname).replace(/[^.\w]/g, '').slice(0, 8))
  }),
  limits: { fileSize: MAX_MB * 1048576 },
  fileFilter: (q, f, cb) => cb(null, /^video\//.test(f.mimetype))
});
app.post('/api/room/:id/upload', (q, r, next) => {
  const R = rooms.get(q.params.id);
  if (!R || !R.members.has(q.query.sid)) return r.status(403).json({ error: 'Join the party first.' });
  next();
}, upload.single('movie'), (q, r) => {
  const R = rooms.get(q.params.id);
  if (!q.file) return r.status(400).json({ error: 'Please choose a video file.' });
  if (R.movie) fs.rmSync(path.join(UP, safe(R.id), path.basename(R.movie.url)), { force: true });
  R.movie = { url: `/media/${R.id}/${q.file.filename}`, name: q.file.originalname };
  R.state = { playing: false, time: 0, at: Date.now() };
  io.to(R.id).emit('movie', { movie: R.movie, state: R.state });
  r.json({ ok: true });
});
app.get('/media/:id/:f', (q, r) => r.sendFile(path.join(UP, safe(q.params.id), path.basename(q.params.f)), e => e && !r.headersSent && r.status(404).end()));

io.on('connection', s => {
  let R = null;
  s.on('join', ({ id, key, name } = {}, ack) => {
    const x = rooms.get(id);
    if (!x || x.key !== key) return ack({ error: 'This invite link is invalid or has expired.' });
    if (x.members.size >= MAX && !x.members.has(s.id)) return ack({ error: `The party is full (${MAX} people).` });
    const u = who(cookie(s.request.headers.cookie, 'sess'));
    clearTimeout(x.timer); R = x; s.join(id);
    R.members.set(s.id, { id: s.id, name: String(name || (u && u.name) || 'Guest').slice(0, 24), picture: (u && u.picture) || '', owner: !!u && u.email === R.owner, voice: false });
    ack({ me: s.id, movie: R.movie, state: R.state, now: Date.now(), max: MAX }); push(R);
  });
  s.on('ctrl', d => { if (!R || !R.members.has(s.id)) return; R.state = { playing: !!d.playing, time: +d.time || 0, at: Date.now() }; s.to(R.id).emit('state', { ...R.state, by: R.members.get(s.id).name }); });
  s.on('chat', t => { const m = R && R.members.get(s.id); if (m) io.to(R.id).emit('chat', { id: s.id, name: m.name, text: String(t).slice(0, 300) }); });
  s.on('voice', on => { const m = R && R.members.get(s.id); if (m) { m.voice = !!on; push(R); } });
  s.on('cam', on => { const m = R && R.members.get(s.id); if (m) { m.cam = !!on; push(R); } });
  s.on('mic', on => { const m = R && R.members.get(s.id); if (m) { m.mic = !!on; push(R); } });
  s.on('signal', ({ to, data }) => { if (R && R.members.has(to)) io.to(to).emit('signal', { from: s.id, data }); });
  s.on('disconnect', () => {
    if (!R) return; R.members.delete(s.id); push(R);
    if (!R.members.size) { const x = R; x.timer = setTimeout(() => { rmFile(x); rooms.delete(x.id); }, 600000); }
  });
});
srv.listen(PORT, () => console.log('Watch party running on port ' + PORT));
