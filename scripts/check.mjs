// Geometry and daily-seed check for the game in src/game.html, run in Node with a stubbed page and canvas.
//   npm run check
// For every seat and tier it generates balls with the game's own newBall() and asserts that:
//   - in/out matches the sign of the margin, and matches an independent test of the bounce mark against the judged line
//   - the margin the game reports equals the measured gap between the mark and the line's outer edge
//   - the landing spot and the judged line are on screen
// and that the daily challenge gives identical balls (and seat) for the same date. Exits 1 on any failure.
import { readFileSync } from 'node:fs';

const BALLS_PER_SEAT_AND_TIER = 300;
const html = readFileSync(new URL('../src/game.html', import.meta.url), 'utf8');
const match = html.match(/<script>([\s\S]*)<\/script>/);
if (!match) fail('no <script> block in src/game.html');
const END = /\}\)\(\);\s*$/;  // the game script is one IIFE; expose its internals just before it closes
if (!END.test(match[1])) fail('src/game.html script no longer ends with "})();"');
const src = match[1].replace(END, `window.__ctl={ S, newBall, startPoint, resolve, dailyStart, dailySeat, proj, cam, SEATS, VIEWS,
  get ball(){ return ball; }, get W(){ return W; }, get H(){ return H; },
  LINE_W, MARK_L, MARK_W, SINGLES_W };})();`);

// A seeded Math.random so every run checks the same balls and a failure can be reproduced.
function mulberry32(a) { return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Boot the game in a sandbox: the given local date/time, fresh localStorage, no audio, no timers, no animation frames.
function boot(date, seed = 1) {
  const noop = () => {};
  const ctx = new Proxy({}, { get: (_, k) => (k === 'createLinearGradient' || k === 'createRadialGradient') ? () => ({ addColorStop: noop }) : noop, set: () => true });
  const els = {};
  const el = id => els[id] || (els[id] = { id, style: {}, hidden: false, disabled: false, textContent: '', innerHTML: '', children: [],
    classList: { toggle: noop, add: noop, remove: noop }, parentElement: { hidden: false }, addEventListener: noop, focus: noop,
    getContext: () => ctx, getBoundingClientRect: () => ({ width: 720, height: 480 }), width: 0, height: 0 });
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { super(...(a.length ? a : [date])); } static now() { return new RealDate(date).getTime(); } }
  const store = {};
  const window = { addEventListener: noop, devicePixelRatio: 1 };
  const SeededMath = Object.create(Math); SeededMath.random = mulberry32(seed);
  const globals = { window, document: { getElementById: el, addEventListener: noop, createDocumentFragment: () => ({ appendChild: noop }) },
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    performance: { now: () => 0 }, requestAnimationFrame: noop, cancelAnimationFrame: noop, setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop,
    location: { hash: '', href: 'https://example.test/' }, navigator: {}, Date: FakeDate, Math: SeededMath };
  new Function(...Object.keys(globals), src)(...Object.values(globals));
  return window.__ctl;
}

const failures = [];
const check = (ok, msg) => { if (!ok && failures.length < 50) failures.push(msg); return ok; };
function fail(msg) { console.error('check failed: ' + msg); process.exit(1); }

// ---------- geometry, every seat and tier ----------
const g = boot('2026-09-30T10:00:00');
const { S, SEATS, VIEWS, LINE_W, MARK_L, MARK_W, SINGLES_W } = g;
let balls = 0;
for (const id of Object.keys(SEATS)) {
  const V = VIEWS[SEATS[id].view];
  for (let tier = 0; tier < 5; tier++) {
    for (let i = 0; i < BALLS_PER_SEAT_AND_TIER; i++) {
      S.seat = id; S.tier = tier; S.call = 1; g.newBall();
      const b = g.ball, tag = `${id} tier ${tier} ball ${i} (m=${(b.m * 1000).toFixed(2)} mm)`;
      balls++;
      check(b.seat === id && g.cam.flip === !!SEATS[id].flip, `${tag}: seat/flip not applied`);
      check(b.isIn === (b.m < 0), `${tag}: isIn does not match the margin sign`);
      // Independent geometry: trace the elongated mark and test it against the judged line. The sideline occupies
      // x in [0, LINE_W] (out is x > LINE_W); a baseline or service line occupies y in [line, line+LINE_W] (out is y < line).
      const th = Math.atan2(b.uy, b.ux);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let k = 0; k < 720; k++) {
        const a = k / 720 * 2 * Math.PI, lx = MARK_L / 2 * Math.cos(a), ly = MARK_W / 2 * Math.sin(a);
        const x = b.xL + lx * Math.cos(th) - ly * Math.sin(th), y = b.yL + lx * Math.sin(th) + ly * Math.cos(th);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      const touches = V.axis === 'x' ? minX <= LINE_W : maxY >= V.line;
      const gapMm = V.axis === 'x' ? (minX - LINE_W) * 1000 : (V.line - maxY) * 1000;
      check(touches === b.isIn, `${tag}: mark ${touches ? 'touches' : 'misses'} the line but isIn=${b.isIn}`);
      check(Math.abs(gapMm - b.m * 1000) <= 0.05, `${tag}: measured gap ${gapMm.toFixed(3)} mm differs from the margin`);
      if (V.axis === 'y') check(maxX < 0 && minX > -SINGLES_W + LINE_W, `${tag}: mark also touches a sideline`);
      // on screen: landing spot inside the view (20 px margin), judged line at the landing spot above the chair rail
      const p = g.proj(b.xL, b.yL, 0);
      check(p.d > 0 && p.sx >= 20 && p.sx <= g.W - 20 && p.sy >= 20 && p.sy <= g.H - 20, `${tag}: landing spot off screen (${p.sx.toFixed(0)}, ${p.sy.toFixed(0)})`);
      const l = V.axis === 'x' ? g.proj(LINE_W, b.yL, 0) : g.proj(b.xL, V.line, 0);
      check(l.d > 0 && l.sx >= 0 && l.sx <= g.W && l.sy >= 0 && l.sy <= g.H - 16, `${tag}: judged line off screen (${l.sx.toFixed(0)}, ${l.sy.toFixed(0)})`);
    }
  }
}

// ---------- daily seed: same date, same balls ----------
function playDaily(dateTime, seed) {
  const d = boot(dateTime, seed), seq = [];
  d.dailyStart();
  for (let i = 0; i < 20; i++) {
    const b = d.ball;
    seq.push([b.seat, d.S.tier, b.xL.toFixed(6), b.yL.toFixed(6), b.vy.toFixed(6), b.m.toFixed(6)].join(','));
    d.S.phase = 'window'; d.resolve(b.isIn ? 'in' : 'out', 0.5);
    if (i < 19) d.startPoint();
  }
  return seq.join('\n');
}
const dates = ['2026-09-30', '2026-10-01', '2026-12-31', '2027-02-28'];
for (const day of dates) {
  // different time of day and different Math.random: the daily must not depend on either
  const a = playDaily(`${day}T00:05:00`, 1), b = playDaily(`${day}T23:55:00`, 99);
  check(a === b, `daily ${day}: balls differ between 00:05 and 23:55`);
  check(new Set(a.split('\n').map(r => r.split(',')[0])).size === 1, `daily ${day}: seat changes during the daily`);
}
check(playDaily('2026-09-30T12:00:00', 1) !== playDaily('2026-10-01T12:00:00', 1), 'daily: consecutive dates give the same balls');

if (failures.length) {
  console.error(`check failed: ${failures.length}${failures.length === 50 ? '+' : ''} problem(s)`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`check passed: ${balls} balls over ${Object.keys(SEATS).length} seats and 5 tiers; daily identical on ${dates.length} dates`);
