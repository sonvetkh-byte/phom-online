// Máy chủ Phỏm online: phòng chơi, đồng bộ ván bài qua WebSocket, máy chủ giữ toàn bộ luật.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('./miniws.js');
const G = require('./public/game.js');

const PORT = process.env.PORT || 3000;
const TURN_MS = 30000;      // thời gian mỗi lượt cho người đang online
const OFFLINE_MS = 6000;    // người rớt mạng: người máy đánh hộ sau 6 giây
const BOT_MS = 900;
const START_CHIPS = 1000;
const BOT_NAMES = ['Cô Ba', 'Anh Tư', 'Bé Na', 'Chú Năm'];
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };

/* ---------- web tĩnh ---------- */
const server = http.createServer((req, res) => {
  let u;
  try { u = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  if (u === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (u === '/' || u === '') u = '/index.html';
  const f = path.join(PUBLIC, path.normalize(u));
  if (!f.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end('Không tìm thấy'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(d);
  });
});

/* ---------- phòng ---------- */
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  let c; do { c = Array.from({ length: 4 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join(''); } while (rooms.has(c));
  return c;
}
const token = () => crypto.randomBytes(12).toString('hex');
const clean = (s, n) => String(s || '').replace(/[<>&"]/g, '').trim().slice(0, n);

function makeRoom() {
  const room = { code: newCode(), seats: [null, null, null, null], host: null, g: null, starter: 0, timer: null, seq: 0, games: 0, touched: Date.now() };
  rooms.set(room.code, room);
  return room;
}
const humans = room => room.seats.filter(s => s && !s.bot);
const anyOnline = room => room.seats.some(s => s && !s.bot && s.online);
const nameOf = (room, i) => (room.seats[i] ? room.seats[i].name : '?');

function seatPlayer(room, name, ws) {
  let i = room.seats.findIndex(s => !s);
  if (i < 0) i = room.seats.findIndex(s => s && s.bot);   // vào thay người máy
  if (i < 0) return -1;
  const prev = room.seats[i];
  room.seats[i] = { name, token: token(), ws, bot: false, online: true, chips: prev ? prev.chips : START_CHIPS };
  if (!room.host || !room.seats.some(s => s && s.token === room.host)) room.host = room.seats[i].token;
  return i;
}

/* ---------- ván bài ---------- */
function newGame(room) {
  room.seats.forEach((s, i) => {
    if (!s) room.seats[i] = { name: BOT_NAMES[i], bot: true, online: true, chips: START_CHIPS };
  });
  const deck = G.newDeck();
  const P = [0, 1, 2, 3].map(() => ({ hand: [], locked: new Set(), eaten: [], discards: [], dc: 0 }));
  for (let k = 0; k < 9; k++) P.forEach(p => p.hand.push(deck.pop()));
  const st = room.starter;
  P[st].hand.push(deck.pop());
  room.games++;
  room.g = { id: room.games, deck, P, turn: st, phase: 'discard', last: null, starter: st, over: null, deadline: 0, log: `${nameOf(room, st)} đi trước với 10 lá.`, flash: null };
  room.seq++;
  if (G.isU(P[st].hand, P[st].locked)) return endGame(room, st);
  schedule(room);
}

function flash(room, text) { room.g.flash = { n: (room.g.flash ? room.g.flash.n : 0) + 1, text }; }

function take(room, i, eat) {
  const g = room.g, p = g.P[i];
  room.seq++;
  if (eat) {
    const card = g.last.card, from = g.last.from, fp = g.P[from];
    fp.discards.pop();
    p.hand.push(card); p.locked.add(card.id); p.eaten.push(card);
    const pay = fp.dc === 4 ? 40 : 10;
    room.seats[from].chips -= pay; room.seats[i].chips += pay;
    g.log = `${nameOf(room, i)} ăn ${G.NAME(card)} của ${nameOf(room, from)} (+${pay} xu).`;
    flash(room, `${nameOf(room, i)} ăn ${G.NAME(card)}${pay === 40 ? ' · chốt!' : ''}`);
    g.last = null;
  } else {
    p.hand.push(g.deck.pop());
    g.log = `${nameOf(room, i)} bốc bài.`;
  }
  g.phase = 'discard';
  if (G.isU(p.hand, p.locked)) endGame(room, i);
}

function discard(room, i, card) {
  const g = room.g, p = g.P[i];
  room.seq++;
  p.hand = p.hand.filter(c => c.id !== card.id);
  p.discards.push(card); p.dc++;
  g.last = { card, from: i };
  g.log = `${nameOf(room, i)} đánh ${G.NAME(card)}.`;
  if (g.P.every(q => q.dc === 4)) return endGame(room, -1);
  g.turn = (i + 1) % 4; g.phase = 'take';
}

function endGame(room, uWin) {
  const g = room.g;
  room.seq++;
  const rows = g.P.map((p, seat) => {
    const a = G.analyze(p.hand, p.locked);
    return { seat, melds: a.melds, rest: a.rest, dead: a.dead, mom: a.melds.length === 0, delta: 0, eaten: p.eaten.map(c => c.id) };
  });
  let winner;
  if (uWin >= 0) {
    winner = uWin;
    rows.forEach(r => { r.delta = r.seat === uWin ? 150 : -50; r.place = r.seat === uWin ? 'Ù' : '—'; });
    rows.sort((a, b) => (b.seat === uWin) - (a.seat === uWin));
  } else {
    const ord = r => (r.seat - g.starter + 4) % 4;
    rows.sort((a, b) => (a.mom - b.mom) || (a.dead - b.dead) || (ord(a) - ord(b)));
    const names = ['Nhất', 'Nhì', 'Ba', 'Bét'], pay = [0, 10, 20, 30];
    rows.forEach((r, k) => {
      r.place = r.mom ? 'Móm' : names[k];
      if (k > 0) { const v = r.mom ? 40 : pay[k]; r.delta = -v; rows[0].delta += v; }
    });
    winner = rows[0].seat;
  }
  rows.forEach(r => {
    const s = room.seats[r.seat]; s.chips += r.delta;
    if (s.chips <= 0) s.chips = START_CHIPS;  // hết xu thì được cấp lại
  });
  room.starter = winner;
  g.over = { u: uWin >= 0, winner, rows, allMom: rows.every(r => r.mom) };
  g.deadline = 0;
  g.log = uWin >= 0 ? `${nameOf(room, uWin)} Ù!` : `Hết ván. ${nameOf(room, winner)} về Nhất.`;
  clearTimeout(room.timer);
}

/* ---------- lượt, người máy, đếm giờ ---------- */
function schedule(room) {
  clearTimeout(room.timer);
  const g = room.g;
  if (!g || g.over) return;
  if (!anyOnline(room)) { g.deadline = 0; return; }  // không ai online thì tạm dừng
  const s = room.seats[g.turn], seq = room.seq;
  let ms;
  if (s.bot) { ms = BOT_MS; g.deadline = 0; }
  else { ms = s.online ? TURN_MS : OFFLINE_MS; g.deadline = Date.now() + ms; }
  room.timer = setTimeout(() => { if (room.seq === seq) autoAct(room); }, ms);
}

function autoAct(room) {
  const g = room.g; if (!g || g.over) return;
  const i = g.turn, p = g.P[i];
  if (g.phase === 'take') {
    const smart = room.seats[i].bot ? Math.random() > 0.08 : true;
    const eat = !!g.last && G.canEat(p.hand, p.locked, g.last.card) && smart;
    take(room, i, eat);
    broadcast(room);
    if (g.over) return;
    clearTimeout(room.timer);
    const seq = room.seq;
    room.timer = setTimeout(() => { if (room.seq === seq) autoAct(room); }, 750);
    return;
  }
  const nx = g.P[(i + 1) % 4];
  discard(room, i, G.botDiscard(p.hand, p.locked, nx.hand, nx.locked));
  schedule(room);
  broadcast(room);
}

/* ---------- gửi trạng thái ---------- */
function view(room, me) {
  const g = room.g, mySeat = room.seats[me];
  const v = {
    t: 'state', code: room.code, you: me, now: Date.now(),
    isHost: !!mySeat && mySeat.token === room.host,
    seats: room.seats.map(s => s && { name: s.name, bot: s.bot, online: s.online, chips: s.chips, host: !s.bot && s.token === room.host }),
    g: null
  };
  if (g) {
    const p = g.P[me];
    v.g = {
      id: g.id, turn: g.turn, phase: g.phase, deckN: g.deck.length, last: g.last, starter: g.starter,
      deadline: g.deadline, log: g.log, flash: g.flash,
      P: g.P.map(q => ({ count: q.hand.length, eaten: q.eaten, discards: q.discards, dc: q.dc })),
      hand: p.hand, locked: [...p.locked],
      canEat: !g.over && g.turn === me && g.phase === 'take' && !!g.last && G.canEat(p.hand, p.locked, g.last.card),
      over: g.over
    };
  }
  return v;
}
function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(room) {
  room.touched = Date.now();
  room.seats.forEach((s, i) => { if (s && !s.bot && s.ws) send(s.ws, view(room, i)); });
}

/* ---------- WebSocket ---------- */
const wss = new WebSocketServer({ server, maxPayload: 4096 });
wss.on('connection', ws => {
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    try { handle(ws, m); } catch (e) { console.error(e); send(ws, { t: 'error', msg: 'Có lỗi xảy ra, thử lại nhé.' }); }
  });
  ws.on('close', () => {
    const at = ws.at; if (!at) return;
    const room = rooms.get(at.code); if (!room) return;
    const s = room.seats[at.seat];
    if (s && s.ws === ws) {
      s.ws = null; s.online = false;
      if (!room.g) { room.seats[at.seat] = null; passHost(room); }  // chưa vào ván thì nhả ghế
      else if (room.g.turn === at.seat) schedule(room);
      broadcast(room);
    }
  });
});

function passHost(room) {
  if (room.seats.some(s => s && !s.bot && s.token === room.host)) return;
  const h = room.seats.find(s => s && !s.bot && s.online) || room.seats.find(s => s && !s.bot);
  room.host = h ? h.token : null;
}

function handle(ws, m) {
  if (m.t === 'create' || m.t === 'join') {
    const name = clean(m.name, 16) || 'Người chơi';
    let room;
    if (m.t === 'create') room = makeRoom();
    else {
      room = rooms.get(clean(m.code, 4).toUpperCase());
      if (!room) return send(ws, { t: 'error', msg: 'Không có phòng với mã này.' });
    }
    const seat = seatPlayer(room, name, ws);
    if (seat < 0) return send(ws, { t: 'error', msg: 'Phòng đã đủ 4 người.' });
    ws.at = { code: room.code, seat };
    send(ws, { t: 'joined', code: room.code, token: room.seats[seat].token });
    if (room.g && !room.g.over) schedule(room);
    return broadcast(room);
  }
  if (m.t === 'rejoin') {
    const room = rooms.get(clean(m.code, 4).toUpperCase());
    const seat = room ? room.seats.findIndex(s => s && !s.bot && s.token === m.token) : -1;
    if (seat < 0) return send(ws, { t: 'gone' });
    const s = room.seats[seat];
    if (s.ws && s.ws !== ws) { try { s.ws.close(); } catch {} }
    s.ws = ws; s.online = true; ws.at = { code: room.code, seat };
    send(ws, { t: 'joined', code: room.code, token: s.token });
    if (room.g && !room.g.over) schedule(room);
    return broadcast(room);
  }

  const at = ws.at; if (!at) return;
  const room = rooms.get(at.code); if (!room) return;
  const me = at.seat, seat = room.seats[me];
  if (!seat || seat.ws !== ws) return;
  const g = room.g;

  switch (m.t) {
    case 'start':
    case 'next':
      if (m.t === 'start' && seat.token !== room.host) return send(ws, { t: 'error', msg: 'Chỉ chủ phòng bắt đầu được.' });
      if (g && !g.over) return;
      newGame(room); return broadcast(room);
    case 'draw':
    case 'eat': {
      if (!g || g.over || g.turn !== me || g.phase !== 'take') return;
      const p = g.P[me];
      if (m.t === 'eat' && !(g.last && G.canEat(p.hand, p.locked, g.last.card))) return send(ws, { t: 'error', msg: 'Lá này không tạo phỏm với bài của bạn.' });
      take(room, me, m.t === 'eat');
      schedule(room); return broadcast(room);
    }
    case 'discard': {
      if (!g || g.over || g.turn !== me || g.phase !== 'discard') return;
      const p = g.P[me], card = p.hand.find(c => c.id === m.id);
      if (!card || !G.canDiscard(p.hand, p.locked, card)) return send(ws, { t: 'error', msg: 'Lá đã ăn, hoặc lá giữ phỏm cho lá ăn, thì không đánh được.' });
      discard(room, me, card);
      schedule(room); return broadcast(room);
    }
    case 'leave': {
      ws.at = null;
      if (room.g) room.seats[me] = { name: BOT_NAMES[me], bot: true, online: true, chips: seat.chips };
      else room.seats[me] = null;
      passHost(room);
      if (!humans(room).length) { clearTimeout(room.timer); rooms.delete(room.code); return send(ws, { t: 'gone' }); }
      if (room.g && !room.g.over) schedule(room);
      broadcast(room);
      return send(ws, { t: 'gone' });
    }
    case 'react': {
      const e = ['👍', '😂', '😮', '😡', '🙏', '🔥'][m.i | 0];
      if (!e) return;
      room.seats.forEach(s => { if (s && !s.bot) send(s.ws, { t: 'react', seat: me, e }); });
      return;
    }
  }
}

/* ---------- giữ kết nối, dọn phòng ---------- */
setInterval(() => {
  wss.clients.forEach(ws => { if (!ws.alive) return ws.terminate(); ws.alive = false; try { ws.ping(); } catch {} });
}, 25000);
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (!anyOnline(room) && now - room.touched > 30 * 60 * 1000) { clearTimeout(room.timer); rooms.delete(code); }
  }
}, 60000);

server.listen(PORT, () => console.log(`Phỏm online đang chạy ở cổng ${PORT}`));
