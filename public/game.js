// Luật Phỏm dùng chung cho máy chủ (Node) và trình duyệt.
(function (root) {
  const SUITS = ['♠', '♣', '♦', '♥'];
  const RL = r => ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' })[r] || String(r);
  const NAME = c => RL(c.r) + SUITS[c.s];
  const pc = m => { let n = 0; while (m) { n += m & 1; m >>>= 1; } return n; };
  const toMask = a => a.reduce((m, i) => m | (1 << i), 0);
  const asSet = l => (l instanceof Set ? l : new Set(l || []));

  // Tìm cách xếp phỏm ít điểm rác nhất. Lá đã ăn bắt buộc nằm trong phỏm, mỗi phỏm tối đa 1 lá ăn.
  function analyze(cards, locked) {
    locked = asSet(locked);
    const n = cards.length, cands = [];
    const byR = {};
    cards.forEach((c, i) => (byR[c.r] = byR[c.r] || []).push(i));
    for (const r in byR) {
      const ix = byR[r];
      if (ix.length >= 3) {
        cands.push(toMask(ix));
        if (ix.length === 4) for (let k = 0; k < 4; k++) cands.push(toMask(ix.filter((_, j) => j !== k)));
      }
    }
    for (let s = 0; s < 4; s++) {
      const ix = cards.map((_, i) => i).filter(i => cards[i].s === s).sort((a, b) => cards[a].r - cards[b].r);
      const segs = []; let seg = [];
      ix.forEach(i => {
        if (seg.length && cards[i].r !== cards[seg[seg.length - 1]].r + 1) { segs.push(seg); seg = []; }
        seg.push(i);
      });
      if (seg.length) segs.push(seg);
      segs.forEach(sg => { for (let a = 0; a < sg.length; a++) for (let b = a + 3; b <= sg.length; b++) cands.push(toMask(sg.slice(a, b))); });
    }
    const lock = toMask(cards.map((c, i) => (locked.has(c.id) ? i : -1)).filter(i => i >= 0));
    const valid = cands.filter(m => pc(m & lock) <= 1);
    let best = null; const melds = [];
    (function dfs(dec, used) {
      let i = 0; while (i < n && (dec >> i & 1)) i++;
      if (i === n) {
        if (lock & ~used) return;
        let dead = 0; for (let j = 0; j < n; j++) if (!(used >> j & 1)) dead += cards[j].r;
        if (!best || dead < best.dead || (dead === best.dead && melds.length > best.m.length)) best = { dead, m: [...melds], used };
        return;
      }
      for (const m of valid) if ((m >> i & 1) && !(m & dec)) { melds.push(m); dfs(dec | m, used | m); melds.pop(); }
      if (!(lock >> i & 1)) dfs(dec | (1 << i), used);
    })(0, 0);
    if (!best) return { ok: false };
    const pick = m => cards.filter((_, i) => m >> i & 1).sort((a, b) => a.r - b.r || a.s - b.s);
    return {
      ok: true, dead: best.dead, melds: best.m.map(pick),
      rest: cards.filter((_, i) => !(best.used >> i & 1)).sort((a, b) => a.r - b.r || a.s - b.s)
    };
  }

  function canEat(hand, locked, card) {
    if (!card) return false;
    const L = new Set(asSet(locked)); L.add(card.id);
    const a = analyze([...hand, card], L);
    return a.ok && a.melds.some(m => m.some(x => x.id === card.id));
  }
  function canDiscard(hand, locked, card) {
    locked = asSet(locked);
    if (!card || locked.has(card.id) || !hand.some(c => c.id === card.id)) return false;
    return analyze(hand.filter(c => c.id !== card.id), locked).ok;
  }
  function isU(hand, locked) { const a = analyze(hand, locked); return a.ok && a.rest.length <= 1; }

  function newDeck() {
    const d = []; let id = 0;
    for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) d.push({ r, s, id: id++ });
    for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
    return d;
  }

  // Người máy chọn lá đánh: ít rác, giữ cạ, tránh cho nhà dưới ăn.
  function botDiscard(hand, locked, nextHand, nextLocked) {
    locked = asSet(locked);
    let best = null;
    for (const c of hand) {
      if (locked.has(c.id)) continue;
      const a = analyze(hand.filter(x => x !== c), locked); if (!a.ok) continue;
      let pot = 0; const r = a.rest;
      for (let x = 0; x < r.length; x++) for (let y = x + 1; y < r.length; y++) {
        if (r[x].r === r[y].r) pot++;
        else if (r[x].s === r[y].s && Math.abs(r[x].r - r[y].r) <= 2) pot++;
      }
      const feed = nextHand && canEat(nextHand, nextLocked, c) ? 6 : 0;
      const score = a.dead - 3.5 * pot + feed + Math.random() * 1.5;
      if (!best || score < best.score) best = { c, score };
    }
    return best ? best.c : hand.find(c => !locked.has(c.id));
  }

  const api = { SUITS, RL, NAME, analyze, canEat, canDiscard, isU, newDeck, botDiscard };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Phom = api;
})(typeof window !== 'undefined' ? window : globalThis);
