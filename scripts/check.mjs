// Geometry and daily-seed check for the game in src/game.html, run in Node with a stubbed page and canvas.
//   npm run check
// For every seat and tier, in singles and doubles, it generates balls with the game's own newBall() and asserts that:
//   - in/out matches the sign of the margin, and matches an independent test of the bounce mark against the judged line
//   - the margin the game reports equals the measured gap between the mark and the line's outer edge
//   - balls in the doubles alley are out in a singles match and in in a doubles match (and both cases occur)
//   - a baseline or service-line ball lands inside the judged length without touching a sideline
//   - the landing spot and the judged line are on screen
// and that the daily challenge gives identical balls, seat, match type and level for the same date, plays every ball
// at its level's tier, and still produces the frozen DAILY_FIXTURE for 2026-10-01 below. Exits 1 on any failure.
import { readFileSync } from 'node:fs';

const BALLS_PER_SEAT_AND_TIER = 300;

// Frozen daily fixture: level, seat, match type and first 5 balls of the daily for 2026-10-01, rounded to 6 decimals
// (metres, m/s). Everyone playing a given date must get the same balls, so these must only change on purpose. If a change to
// the ball code, TIERS, seats or the daily seeding is deliberate, regenerate these values and say so in the commit.
const DAILY_FIXTURE = {
  date: '2026-10-01', level: 'National', seat: 'service-line-right', match: 'singles',
  balls: [
    { tier: 2, xL: -5.263177, yL: 5.314634, vx: -1.763319, vy: -31.415598, m: 0.115415,  isIn: false },
    { tier: 2, xL: -5.799764, yL: 5.417902, vx: 2.692516,  vy: -32.996784, m: 0.012202,  isIn: false },
    { tier: 2, xL: -4.41306,  yL: 5.398084, vx: 2.396158,  vy: -33.006761, m: 0.031999,  isIn: false },
    { tier: 2, xL: -3.869069, yL: 5.595568, vx: -1.886805, vy: -30.084494, m: -0.165506, isIn: true },
    { tier: 2, xL: -5.035255, yL: 5.256913, vx: 2.570415,  vy: -30.205036, m: 0.1732,    isIn: false },
  ],
};
const html = readFileSync(new URL('../src/game.html', import.meta.url), 'utf8');
const match = html.match(/<script>([\s\S]*)<\/script>/);
if (!match) fail('no <script> block in src/game.html');
const END = /\}\)\(\);\s*$/;  // the game script is one IIFE; expose its internals just before it closes
if (!END.test(match[1])) fail('src/game.html script no longer ends with "})();"');
const src = match[1].replace(END, `window.__ctl={ S, newBall, startPoint, resolve, dailyStart, proj, cam, SEATS,
  get ball(){ return ball; }, get W(){ return W; }, get H(){ return H; },
  LINE_W, MARK_L, MARK_W, SINGLES_W, ALLEY, DAILY_LEVELS };})();`);

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

// ---------- geometry, every seat and tier, singles and doubles ----------
const g = boot('2026-09-30T10:00:00');
const { S, SEATS, LINE_W, MARK_L, MARK_W, SINGLES_W, ALLEY } = g;
const MATCHES = ['singles', 'doubles'];
const alley = { singles: 0, doubles: 0 };  // side-seat balls whose mark lies in the doubles alley
let balls = 0;
for (const match of MATCHES) for (const id of Object.keys(SEATS)) {
  for (let tier = 0; tier < 5; tier++) {
    for (let i = 0; i < BALLS_PER_SEAT_AND_TIER; i++) {
      S.seat = id; S.match = match; S.tier = tier; S.call = 1; g.newBall();
      const b = g.ball, V = b.geo, tag = `${match} ${id} tier ${tier} ball ${i} (m=${(b.m * 1000).toFixed(2)} mm)`;
      balls++;
      check(b.seat === id && b.match === match && g.cam.flip === !!SEATS[id].flip, `${tag}: seat/match/flip not applied`);
      check(b.isIn === (b.m < 0), `${tag}: isIn does not match the margin sign`);
      // Independent geometry: trace the elongated mark and test it against the judged line. A sideline's outer edge is
      // V.line (out is x > V.line); a baseline or service line occupies y in [line, line+LINE_W] (out is y < line).
      const th = Math.atan2(b.uy, b.ux);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let k = 0; k < 720; k++) {
        const a = k / 720 * 2 * Math.PI, lx = MARK_L / 2 * Math.cos(a), ly = MARK_W / 2 * Math.sin(a);
        const x = b.xL + lx * Math.cos(th) - ly * Math.sin(th), y = b.yL + lx * Math.sin(th) + ly * Math.cos(th);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      const touches = V.axis === 'x' ? minX <= V.line : maxY >= V.line;
      const gapMm = V.axis === 'x' ? (minX - V.line) * 1000 : (V.line - maxY) * 1000;
      check(touches === b.isIn, `${tag}: mark ${touches ? 'touches' : 'misses'} the line but isIn=${b.isIn}`);
      check(Math.abs(gapMm - b.m * 1000) <= 0.05, `${tag}: measured gap ${gapMm.toFixed(3)} mm differs from the margin`);
      // the doubles alley: between the singles sideline (outer edge LINE_W) and the doubles sideline (inner edge ALLEY)
      if (V.axis === 'x' && minX > LINE_W && maxX < ALLEY) {
        alley[match]++;
        check(b.isIn === (match === 'doubles'), `${tag}: ball in the alley called ${b.isIn ? 'in' : 'out'} in ${match}`);
      }
      // across the court: inside the judged length (singles or doubles width), clear of every sideline it spans
      if (V.axis === 'y') check(maxX < V.end && minX > V.end - V.len + LINE_W, `${tag}: mark outside the judged length or touching a sideline`);
      // on screen: landing spot inside the view (20 px margin), judged line at the landing spot above the chair rail
      const p = g.proj(b.xL, b.yL, 0);
      check(p.d > 0 && p.sx >= 20 && p.sx <= g.W - 20 && p.sy >= 20 && p.sy <= g.H - 20, `${tag}: landing spot off screen (${p.sx.toFixed(0)}, ${p.sy.toFixed(0)})`);
      const l = V.axis === 'x' ? g.proj(V.line, b.yL, 0) : g.proj(b.xL, V.line, 0);
      check(l.d > 0 && l.sx >= 0 && l.sx <= g.W && l.sy >= 0 && l.sy <= g.H - 16, `${tag}: judged line off screen (${l.sx.toFixed(0)}, ${l.sy.toFixed(0)})`);
    }
  }
}
for (const m of MATCHES) check(alley[m] > 0, `no ${m} sideline ball landed in the doubles alley, so alley calls were not tested`);

// ---------- daily seed: same date, same balls ----------
function playDaily(dateTime, seed) {
  const d = boot(dateTime, seed), seq = [];
  d.dailyStart();
  for (let i = 0; i < 20; i++) {
    const b = d.ball;
    seq.push([b.seat + '/' + b.match, d.S.tier, b.xL.toFixed(6), b.yL.toFixed(6), b.vy.toFixed(6), b.m.toFixed(6)].join(','));
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
  check(new Set(a.split('\n').map(r => r.split(',')[0])).size === 1, `daily ${day}: seat or match type changes during the daily`);
  const lv = boot(`${day}T12:00:00`, 1); lv.dailyStart();
  const tiers = new Set(a.split('\n').map(r => +r.split(',')[1]));
  check(tiers.size === 1 && tiers.has(lv.DAILY_LEVELS[lv.S.daily.level].tier), `daily ${day}: balls not all at the ${lv.DAILY_LEVELS[lv.S.daily.level].name} level's tier (${[...tiers]})`);
}
check(playDaily('2026-09-30T12:00:00', 1) !== playDaily('2026-10-01T12:00:00', 1), 'daily: consecutive dates give the same balls');

// ---------- frozen daily fixture ----------
{
  const d = boot(`${DAILY_FIXTURE.date}T12:00:00`, 5), diffs = [];
  d.dailyStart();
  const level = d.DAILY_LEVELS[d.S.daily.level].name;
  if (level !== DAILY_FIXTURE.level) diffs.push(`level ${level}, expected ${DAILY_FIXTURE.level}`);
  if (d.ball.seat !== DAILY_FIXTURE.seat) diffs.push(`seat ${d.ball.seat}, expected ${DAILY_FIXTURE.seat}`);
  if (d.ball.match !== DAILY_FIXTURE.match) diffs.push(`match type ${d.ball.match}, expected ${DAILY_FIXTURE.match}`);
  DAILY_FIXTURE.balls.forEach((want, i) => {
    const b = d.ball, got = { tier: d.S.tier, xL: b.xL, yL: b.yL, vx: b.vx, vy: b.vy, m: b.m, isIn: b.isIn };
    for (const k of Object.keys(want)) {
      const same = typeof want[k] === 'number' ? Math.abs(got[k] - want[k]) <= 1e-6 : got[k] === want[k];
      if (!same) diffs.push(`ball ${i + 1} ${k} = ${typeof got[k] === 'number' ? +got[k].toFixed(6) : got[k]}, expected ${want[k]}`);
    }
    d.S.phase = 'window'; d.resolve('in', 0.5); d.startPoint();
  });
  if (diffs.length) {
    failures.push(`the daily generation changed: the ${DAILY_FIXTURE.date} daily no longer matches DAILY_FIXTURE in scripts/check.mjs. `
      + `Every player's daily balls for a date would change, so this must be deliberate; if it is, regenerate the fixture and say so in the commit.`);
    for (const x of diffs.slice(0, 10)) failures.push('  ' + x);
  }
}

if (failures.length) {
  console.error(`check failed: ${failures.length}${failures.length === 50 ? '+' : ''} problem(s)`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`check passed: ${balls} balls over ${Object.keys(SEATS).length} seats, 5 tiers, singles and doubles (alley balls: ${alley.singles} singles, all out; ${alley.doubles} doubles, all in); daily identical on ${dates.length} dates; ${DAILY_FIXTURE.date} daily (${DAILY_FIXTURE.level}) matches the frozen fixture`);
