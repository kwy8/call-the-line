// Geometry and daily-seed check for the game in src/game.html, run in Node with a stubbed page and canvas.
//   npm run check
// For every seat and tier, in singles and doubles and in every match condition that can occur there, it generates balls
// with the game's own newBall() and asserts that:
//   - the bounce mark has the right length for the condition (damp grass: 20% longer), and every test below uses it
//   - in/out matches the sign of the margin, and matches an independent test of the bounce mark against the judged line
//   - the margin the game reports equals the measured gap between the mark and the line's outer edge
//   - balls in the doubles alley are out in a singles match and in in a doubles match (and both cases occur)
//   - a baseline or service-line ball lands inside the judged length without touching a sideline
//   - the landing spot and the judged line are on screen, and the judge's hands stay clear below the landing spot
//   - the ball comes from a plausible hitter: its flight, traced back with the game's own stepBall(), starts inside the
//     groundstroke or serve zone (a serve from the half diagonally opposite its box), crosses the net between the posts
//     with the required height, and travels from the far half towards the near half
//   - under 5% of balls at any tier need their landing spot moved because no plausible stroke reached it
// and that the render loop keeps running after a call, and the squash lasts 45 ms at any refresh rate (one frame at least),
// that the leaderboard Worker's score bounds match the game's real scoring, that the ghost replay and practice mode
// behave (see that section), and that the daily challenge gives identical balls, seat, match type and level for the same date, plays every ball
// at its level's tier, and still produces the frozen DAILY_FIXTURE for 2026-10-01 below. Exits 1 on any failure.
import { readFileSync } from 'node:fs';
import { maxScore, minScore, BALLS } from '../worker/src/index.js';

const BALLS_PER_SEAT_AND_TIER = 300;

// Frozen daily fixture: level, seat, match type, condition and first 5 balls of the daily for 2026-10-01, rounded to 6 decimals
// (metres, m/s). Everyone playing a given date must get the same balls, so these must only change on purpose. If a change to
// the ball code, TIERS, seats or the daily seeding is deliberate, regenerate these values and say so in the commit.
const DAILY_FIXTURE = {
  date: '2026-10-01', level: 'National', seat: 'baseline-far', match: 'singles', cond: 'night',
  balls: [
    { tier: 2, xL: -2.83192,  yL: -0.027389, vx: 3.806274,  vy: -31.415598, m: -0.027383, isIn: true },
    { tier: 2, xL: -5.415008, yL: -0.025449, vx: -6.996254, vy: -33.066593, m: -0.028873, isIn: true },
    { tier: 2, xL: -3.869069, yL: -0.001414, vx: 0.427082,  vy: -30.966341, m: -0.053583, isIn: true },
    { tier: 2, xL: -4.457245, yL: -0.100722, vx: 6.202455,  vy: -29.101548, m: 0.04641,   isIn: false },
    { tier: 2, xL: -3.100355, yL: -0.110789, vx: -6.022574, vy: -33.097158, m: 0.056295,  isIn: false },
  ],
};
const html = readFileSync(new URL('../src/game.html', import.meta.url), 'utf8');
const match = html.match(/<script>([\s\S]*)<\/script>/);
if (!match) fail('no <script> block in src/game.html');
const END = /\}\)\(\);\s*$/;  // the game script is one IIFE; expose its internals just before it closes
if (!END.test(match[1])) fail('src/game.html script no longer ends with "})();"');
const src = match[1].replace(END, `window.__ctl={ S, newBall, startPoint, resolve, dailyStart, proj, cam, SEATS,
  get ball(){ return ball; }, get W(){ return W; }, get H(){ return H; },
  LINE_W, MARK_L, MARK_W, SINGLES_W, ALLEY, DAILY_LEVELS, TIERS, CONDITIONS, pickCond, stepBall,
  ST, nextStep, practiceStart, handsTop, finishReplay, landDistance, pickSeat, SEAT_CHOICES,
  shiftKey, streakAfterPlaying, streakNow, streakLoad, shareText, get replay(){ return replay; }, get PR(){ return PR; } };})();`);

// A seeded Math.random so every run checks the same balls and a failure can be reproduced.
function mulberry32(a) { return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Boot the game in a sandbox: the given local date/time, fresh localStorage, no audio, no timers, no animation frames.
// Pass an array as `frames` to collect animation-frame callbacks instead, and run them yourself with a fake timestamp.
// `view` sets the court's displayed size, and whether the page is in its landscape layout (labels scale with the court).
function boot(date, seed = 1, frames = null, view = { width: 720, height: 480, landscape: false }) {
  const noop = () => {};
  const ctx = new Proxy({}, { get: (_, k) => (k === 'createLinearGradient' || k === 'createRadialGradient') ? () => ({ addColorStop: noop }) : noop, set: () => true });
  const els = {};
  const el = id => els[id] || (els[id] = { id, style: {}, hidden: false, disabled: false, textContent: '', innerHTML: '', children: [],
    classList: { toggle: noop, add: noop, remove: noop }, parentElement: { hidden: false }, addEventListener: noop, focus: noop,
    setAttribute: noop, getAttribute: () => null, removeAttribute: noop,
    getContext: () => ctx, getBoundingClientRect: () => ({ width: view.width, height: view.height }), width: 0, height: 0 });
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { super(...(a.length ? a : [date])); } static now() { return new RealDate(date).getTime(); } }
  const store = {};
  const window = { addEventListener: noop, devicePixelRatio: 1, matchMedia: q => ({ matches: view.landscape && q.includes('orientation:landscape') }) };
  const SeededMath = Object.create(Math); SeededMath.random = mulberry32(seed);
  const globals = { window, document: { getElementById: el, addEventListener: noop, createDocumentFragment: () => ({ appendChild: noop }) },
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    performance: { now: () => 0 }, requestAnimationFrame: frames ? fn => frames.push(fn) : noop, cancelAnimationFrame: noop, setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop,
    location: { hash: '', href: 'https://example.test/' }, navigator: {}, Date: FakeDate, Math: SeededMath };
  new Function(...Object.keys(globals), src)(...Object.values(globals));
  window.__ctl.els = els; window.__ctl.store = store;
  return window.__ctl;
}

const failures = [];
const check = (ok, msg) => { if (!ok && failures.length < 50) failures.push(msg); return ok; };
function fail(msg) { console.error('check failed: ' + msg); process.exit(1); }

// ---------- geometry, every seat and tier, singles and doubles, every condition ----------
const g = boot('2026-09-30T10:00:00');
const { S, SEATS, LINE_W, MARK_L, MARK_W, SINGLES_W, ALLEY, TIERS, CONDITIONS } = g;
const MATCHES = ['singles', 'doubles'];
// Expected mark length, worked out here rather than read from the game: damp grass makes the ball skid 20% further.
const DAMP_SKID = 1.2, expectedMarkL = cond => MARK_L * (cond === 'damp' ? DAMP_SKID : 1);
const condOk = (cond, tier) => cond !== 'damp' || TIERS[tier].surf === 'Grass';  // damp grass only exists on grass
// The hitter's zones and the net rule, written out here rather than read from the game. Court: net at y = 11.885, far
// baseline at 23.77, centre line at x = -4.115. x: either side of the centre line; z: contact height.
const NET_Y = 11.885, FAR_BASE = 23.77, CENTRE = -4.115, EPS = 1e-6;
const ZONES = { ground: { x: 6.0, y: [NET_Y + 3, FAR_BASE + 2.5], z: [0.6, 1.5] }, serve: { x: 4.0, y: [FAR_BASE + 0.3, FAR_BASE + 1.5], z: [2.4, 3.0] } };
const POSTS = 6.4, netNeed = x => 0.95 + 0.15 * Math.min(1, Math.abs(x - CENTRE) / POSTS);
const hitFail = { zone: 0, net: 0, posts: 0, direction: 0, any: 0 };
const moved = [0, 0, 0, 0, 0], perTier = [0, 0, 0, 0, 0];   // balls whose first landing spot had no plausible origin
let minClear = Infinity;
const alley = { singles: 0, doubles: 0 };  // side-seat balls whose mark lies in the doubles alley
let balls = 0, dampBalls = 0, landscapeBalls = 0;
for (const cond of Object.keys(CONDITIONS)) for (const match of MATCHES) for (const id of Object.keys(SEATS)) {
  for (let tier = 0; tier < 5; tier++) {
    if (!condOk(cond, tier)) continue;
    for (let i = 0; i < BALLS_PER_SEAT_AND_TIER; i++) {
      S.seat = id; S.match = match; S.cond = cond; S.tier = tier; S.call = 1; g.newBall();
      const b = g.ball, V = b.geo, tag = `${cond} ${match} ${id} tier ${tier} ball ${i} (m=${(b.m * 1000).toFixed(2)} mm)`;
      const markL = expectedMarkL(cond);
      balls++; if (cond === 'damp') dampBalls++;
      check(b.seat === id && b.match === match && b.cond === cond && g.cam.flip === !!SEATS[id].flip, `${tag}: seat/match/condition/flip not applied`);
      check(Math.abs(b.markL - markL) < 1e-12, `${tag}: mark length ${(b.markL * 1000).toFixed(1)} mm, expected ${(markL * 1000).toFixed(1)} mm`);
      check(b.isIn === (b.m < 0), `${tag}: isIn does not match the margin sign`);
      // Independent geometry: trace the elongated mark and test it against the judged line. A sideline's outer edge is
      // V.line (out is x > V.line); a baseline or service line occupies y in [line, line+LINE_W] (out is y < line).
      const th = Math.atan2(b.uy, b.ux);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let k = 0; k < 720; k++) {
        const a = k / 720 * 2 * Math.PI, lx = markL / 2 * Math.cos(a), ly = MARK_W / 2 * Math.sin(a);
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
      check(g.handsTop(g.H - 16) >= p.sy + 0.05 * g.H - 1e-9, `${tag}: the judge's hands would reach within 5% of the court's height of the landing spot`);
      const l = V.axis === 'x' ? g.proj(V.line, b.yL, 0) : g.proj(b.xL, V.line, 0);
      check(l.d > 0 && l.sx >= 0 && l.sx <= g.W && l.sy >= 0 && l.sy <= g.H - 16, `${tag}: judged line off screen (${l.sx.toFixed(0)}, ${l.sy.toFixed(0)})`);
      // the hitter: where the drawn flight starts (the origin; a ball without one starts where it comes into view) and
      // where it crosses the net plane
      const serve = SEATS[id].view === 'svc', Z = serve ? ZONES.serve : ZONES.ground, sp = -b.vy;
      const at = t => { g.stepBall(t); return { x: g.ball.x, y: g.ball.y, z: g.ball.z }; };
      const o = at(b.yo !== undefined ? -(b.yo - b.yL) / sp : b.t0), n = at(-(NET_Y - b.yL) / sp);
      const inZone = Math.abs(o.x - CENTRE) <= Z.x + EPS && o.y >= Z.y[0] - EPS && o.y <= Z.y[1] + EPS && o.z >= Z.z[0] - EPS && o.z <= Z.z[1] + EPS
        && (!serve || Math.sign(o.x - CENTRE) === -Math.sign(b.xL - CENTRE));
      const posts = Math.abs(n.x - CENTRE) <= POSTS + EPS, overNet = n.z >= netNeed(n.x) - EPS, dir = b.vy < 0 && o.y > NET_Y && b.yL < NET_Y;
      if (!inZone) hitFail.zone++; if (!posts) hitFail.posts++; if (!overNet) hitFail.net++; if (!dir) hitFail.direction++;
      if (!inZone || !posts || !overNet || !dir) hitFail.any++;
      minClear = Math.min(minClear, n.z - netNeed(n.x));
      perTier[tier]++; if (b.spots > 1) moved[tier]++;
      check(inZone, `${tag}: origin (${o.x.toFixed(2)}, ${o.y.toFixed(2)}, ${o.z.toFixed(2)}) outside the ${serve ? 'serve' : 'groundstroke'} zone`);
      check(posts, `${tag}: crosses the net at x = ${n.x.toFixed(2)}, outside the posts`);
      check(overNet, `${tag}: ${n.z.toFixed(3)} m over the net at x = ${n.x.toFixed(2)}, needs ${netNeed(n.x).toFixed(3)} m`);
      check(dir, `${tag}: not travelling from the far half to the near half`);
    }
  }
}
// the landscape layout: a 16:9 court (720 x 405) with the taller, scaled chair rail; landing spot and judged line on screen
{
  const L = boot('2026-09-30T10:00:00', 3, null, { width: 1280, height: 720, landscape: true }), rail = Math.round(Math.max(10, 0.03 * L.H) * 1.6);
  check(L.H === 405, `landscape court is ${L.W} x ${L.H}, expected 720 x 405`);
  let n = 0;
  for (const cond of Object.keys(CONDITIONS)) for (const match of MATCHES) for (const id of Object.keys(SEATS)) for (let tier = 0; tier < 5; tier++) {
    if (!condOk(cond, tier)) continue;
    for (let i = 0; i < 40; i++) {
      Object.assign(L.S, { seat: id, match, cond, tier, call: 1 }); L.newBall(); n++;
      const b = L.ball, V = b.geo, tag = `landscape ${cond} ${match} ${id} tier ${tier} ball ${i}`, p = L.proj(b.xL, b.yL, 0);
      check(p.d > 0 && p.sx >= 20 && p.sx <= L.W - 20 && p.sy >= 20 && p.sy <= L.H - rail - 4, `${tag}: landing spot off screen (${p.sx.toFixed(0)}, ${p.sy.toFixed(0)})`);
      check(L.handsTop(L.H - rail) >= p.sy + 0.05 * L.H - 1e-9, `${tag}: the judge's hands would reach within 5% of the court's height of the landing spot`);
      const l = V.axis === 'x' ? L.proj(V.line, b.yL, 0) : L.proj(b.xL, V.line, 0);
      check(l.d > 0 && l.sx >= 0 && l.sx <= L.W && l.sy >= 0 && l.sy <= L.H - rail, `${tag}: judged line off screen (${l.sx.toFixed(0)}, ${l.sy.toFixed(0)})`);
    }
  }
  landscapeBalls = n;
}
// the landing ranges are within reach: the sampler moves a landing spot for under 5% of balls at every tier
const movedPct = moved.map((m, t) => 100 * m / perTier[t]);
movedPct.forEach((p, t) => check(p < 5, `tier ${t}: ${p.toFixed(1)}% of balls had their landing spot moved (no plausible origin reached it), expected under 5%`));
for (const m of MATCHES) check(alley[m] > 0, `no ${m} sideline ball landed in the doubles alley, so alley calls were not tested`);
check(dampBalls > 0, 'no damp-grass balls were generated, so the longer mark was not tested');
// condition picking: damp grass is offered on grass and never anywhere else
for (let tier = 0; tier < 5; tier++) {
  const offered = new Set(Array.from({ length: 1000 }, (_, i) => g.pickCond(tier, i / 1000)));
  check(offered.has('damp') === (TIERS[tier].surf === 'Grass'), `tier ${tier} (${TIERS[tier].surf}): damp grass ${offered.has('damp') ? 'offered' : 'not offered'}`);
  for (const c of ['day', 'late', 'night']) check(offered.has(c), `tier ${tier}: condition ${c} never offered`);
}

// ---------- scoring vs the leaderboard Worker's bounds ----------
// The Worker rejects scores outside [minScore(c), maxScore(c)] for c correct calls. Play the game's own resolve():
// c correct calls in a row at full speed must hit maxScore(c) exactly, and random dailies must stay inside the bounds.
{
  const s = boot('2026-09-30T10:00:00', 11), rnd = mulberry32(42);
  const play = calls => { s.S.mode = 'career'; s.S.score = 0; s.S.streak = 0;
    for (const [right, elapsed] of calls) { s.S.call = 1; s.newBall(); s.S.phase = 'window'; s.resolve((right === s.ball.isIn) ? 'in' : 'out', elapsed); }  // the right call is 'in' exactly when the ball is in
    return s.S.score; };
  for (let c = 0; c <= BALLS; c++) {
    const got = play(Array.from({ length: BALLS }, (_, i) => [i < c, 0]));
    check(got === maxScore(c), `scoring: ${c} correct in a row at full speed scores ${got}, Worker maximum is ${maxScore(c)}`);
  }
  for (let run = 0; run < 500; run++) {
    const calls = Array.from({ length: BALLS }, () => [rnd() < 0.7, rnd() * 2.5]), c = calls.filter(x => x[0]).length, got = play(calls);
    check(got >= minScore(c) && got <= maxScore(c), `scoring: random daily with ${c} correct scored ${got}, outside the Worker's ${minScore(c)}-${maxScore(c)}`);
  }
}

// ---------- daily seed: same date, same balls ----------
function playDaily(dateTime, seed) {
  const d = boot(dateTime, seed), seq = [];
  d.dailyStart();
  for (let i = 0; i < 20; i++) {
    const b = d.ball;
    seq.push([b.seat + '/' + b.match + '/' + b.cond, d.S.tier, b.xL.toFixed(6), b.yL.toFixed(6), b.vy.toFixed(6), b.m.toFixed(6)].join(','));
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
  check(new Set(a.split('\n').map(r => r.split(',')[0])).size === 1, `daily ${day}: seat, match type or condition changes during the daily`);
  const lv = boot(`${day}T12:00:00`, 1); lv.dailyStart();
  const tiers = new Set(a.split('\n').map(r => +r.split(',')[1]));
  check(tiers.size === 1 && tiers.has(lv.DAILY_LEVELS[lv.S.daily.level].tier), `daily ${day}: balls not all at the ${lv.DAILY_LEVELS[lv.S.daily.level].name} level's tier (${[...tiers]})`);
}
check(playDaily('2026-09-30T12:00:00', 1) !== playDaily('2026-10-01T12:00:00', 1), 'daily: consecutive dates give the same balls');
// a year of dailies: the condition fits the level's surface, and damp-grass days really have the longer mark
{
  let dampDays = 0;
  for (let i = 0; i < 365; i++) {
    const day = new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10), d = boot(`${day}T12:00:00`, 3);
    d.dailyStart();
    const tier = d.DAILY_LEVELS[d.S.daily.level].tier, b = d.ball;
    check(condOk(b.cond, tier), `daily ${day}: condition ${b.cond} on ${d.TIERS[tier].surf}`);
    check(Math.abs(b.markL - expectedMarkL(b.cond)) < 1e-12, `daily ${day}: ${b.cond} mark length ${(b.markL * 1000).toFixed(1)} mm`);
    if (b.cond === 'damp') dampDays++;
  }
  check(dampDays > 0, 'no damp-grass daily in a year, so damp dailies were not tested');
}

// ---------- frozen daily fixture ----------
{
  const d = boot(`${DAILY_FIXTURE.date}T12:00:00`, 5), diffs = [];
  d.dailyStart();
  const level = d.DAILY_LEVELS[d.S.daily.level].name;
  if (level !== DAILY_FIXTURE.level) diffs.push(`level ${level}, expected ${DAILY_FIXTURE.level}`);
  if (d.ball.seat !== DAILY_FIXTURE.seat) diffs.push(`seat ${d.ball.seat}, expected ${DAILY_FIXTURE.seat}`);
  if (d.ball.match !== DAILY_FIXTURE.match) diffs.push(`match type ${d.ball.match}, expected ${DAILY_FIXTURE.match}`);
  if (d.ball.cond !== DAILY_FIXTURE.cond) diffs.push(`condition ${d.ball.cond}, expected ${DAILY_FIXTURE.cond}`);
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

// ---------- seat assignment: four seats opening up by tournament, the baseline and service-line seats from either end ----------
{
  const views = Object.entries(g.SEAT_CHOICES).flatMap(([c, vs]) => vs.map(v => [v, c])), seatOf = Object.fromEntries(views);
  check(Object.keys(g.SEAT_CHOICES).length === 4, `there must be four seats, found ${Object.keys(g.SEAT_CHOICES).join(', ')}`);
  for (let tier = 0; tier < 5; tier++) {
    const seats = {}, viewCount = {}, N = 4000;
    for (let i = 0; i < N; i++) { const v = g.pickSeat(tier, (i + 0.5) / N); viewCount[v] = (viewCount[v] || 0) + 1; seats[seatOf[v]] = (seats[seatOf[v]] || 0) + 1; }
    // tournament 1: sidelines only; tournament 2: plus the baseline; tournament 3 on: plus the service line
    const expected = tier >= 2 ? 4 : tier === 1 ? 3 : 2;
    check(Object.keys(viewCount).every(v => seatOf[v]), `tier ${tier}: pickSeat returned a view that is not one of the four seats`);
    check(Object.keys(seats).length === expected && Object.values(seats).every(n => Math.abs(n - N / expected) <= 1), `tier ${tier}: seats ${JSON.stringify(seats)}, expected ${expected} seats equally often`);
    check('sideline-left' in seats && 'sideline-right' in seats, `tier ${tier}: both sideline seats must be offered`);
    check((tier >= 1) === ('baseline' in seats), `tier ${tier}: the baseline ${tier >= 1 ? 'must' : 'must not'} be offered`);
    check((tier >= 2) === ('service-line' in seats), `tier ${tier}: the service line ${tier >= 2 ? 'must' : 'must not'} be offered`);
    for (const [c, vs] of Object.entries(g.SEAT_CHOICES)) if (seats[c] && vs.length > 1)
      check(vs.every(v => Math.abs(viewCount[v] - seats[c] / vs.length) <= 1), `tier ${tier}: ${c} must come from either end equally often: ${vs.map(v => v + ' ' + viewCount[v]).join(', ')}`);
  }
}

// ---------- live loop, and the squash at any refresh rate ----------
{
  const frames = [], g = boot('2026-10-01T12:00:00', 31, frames), { S } = g;
  const tick = ts => { for (const f of frames.splice(0)) f(ts); };
  const serve = () => { Object.assign(S, { mode: 'career', seat: 'sideline-right', match: 'singles', cond: 'day', tier: 4, call: 0 }); g.startPoint(); };   // tStart = 0
  // the loop keeps running after a call: frames keep coming and the ball flies on under the review
  serve();
  let ts = 0; while (S.phase === 'flight') { ts += 16; tick(ts); }
  const b = g.ball; S.phase = 'window'; g.resolve(b.isIn ? 'in' : 'out', 0.3);
  const at = [b.x, b.y, b.z]; for (let i = 0; i < 10; i++) { ts += 16; tick(ts); }
  check(frames.length > 0 && S.phase === 'review', 'the render loop must keep running through the review');
  check(at.some((v, i) => Math.abs(v - [b.x, b.y, b.z][i]) > 1e-6), 'the ball must keep moving after the call');
  // the squash shows for 45 ms of wall time at 60, 144 and 240 Hz, and for one frame at 15 Hz
  // (15 Hz frames are 67 ms apart, so at some frame phases none falls inside the 45 ms: every phase is tried)
  for (const hz of [15, 60, 144, 240]) for (let phase = 0; phase < 1000 / hz; phase += hz === 15 ? 5 : 1000) {
    serve(); frames.length = 0; g.startPoint();
    const dt = 1000 / hz; let n = 0, first = null, last = null;
    for (let t = phase; !(g.ball.t > 0.3); t += dt) { tick(t); if (g.ball.squash > 1) { n++; first ??= t; last = t; } }
    const shown = n ? last - first + dt : 0;
    if (hz === 15) check(n === 1, `${hz} Hz, frame phase ${phase} ms: the squash must show on exactly one frame, got ${n}`);
    else check(Math.abs(shown - 45) <= dt, `${hz} Hz: the squash shows for ${shown.toFixed(1)} ms (${n} frames), expected 45 ms`);
  }
}

// ---------- ghost replay and practice ----------
{
  const frames = [], g = boot('2026-10-01T12:00:00', 21, frames), { S, els } = g;
  let ts = 1000;
  const run = (ms) => { for (const end = ts + ms; ts < end;) { ts += 16; for (const f of frames.splice(0)) f(ts); } };   // ~60 fps
  const reviewUp = () => els.card.innerHTML.includes('class="eagle"');
  const callBall = right => { S.phase = 'window'; g.resolve(right === g.ball.isIn ? 'in' : 'out', 0.4); };

  // tournament: a correct call skips the replay; a wrong call or no call gets it
  S.mode = 'career'; S.tier = 0; S.call = 0; g.startPoint(); frames.length = 0;
  callBall(true);  check(!g.replay, 'tournament: a correct call must go straight to the review, without a replay');
  S.phase = 'review'; g.nextStep(); frames.length = 0;
  callBall(false); check(!!g.replay, 'tournament: a wrong call must get the replay');
  g.finishReplay(); check(!g.replay && reviewUp(), 'skipping the replay shows the review card');
  S.phase = 'review'; g.nextStep(); frames.length = 0;
  S.phase = 'window'; g.resolve(null, 2); check(!!g.replay, 'tournament: no call must get the replay');

  // the replay itself: last 0.5 s (or the whole flight) at quarter speed, mark at touchdown, review 0.4 s later,
  // the called ball untouched
  const b = g.ball, before = JSON.stringify([b.xL, b.yL, b.m, b.isIn, b.vx, b.vy]), span = -g.replay.t0;
  check(Math.abs(span - Math.min(0.5, -b.t0)) < 1e-9, `replay starts ${span.toFixed(3)} s before the bounce, expected ${Math.min(0.5, -b.t0).toFixed(3)}`);
  els.card.innerHTML = ''; const start = ts + 16;
  let touch = null, card = null;
  while (card === null && ts < start + 4000) { run(16); if (touch === null && g.replay && g.replay.mark) touch = ts; if (reviewUp()) card = ts; }
  check(touch !== null && Math.abs((touch - start) - span / 0.25 * 1000) <= 20, `touchdown ${touch - start} ms into the replay, expected ${(span / 0.25 * 1000).toFixed(0)} (quarter speed)`);
  check(card !== null && Math.abs((card - touch) - 400) <= 20, `review card ${card - touch} ms after touchdown, expected 400`);
  check(JSON.stringify([b.xL, b.yL, b.m, b.isIn, b.vx, b.vy]) === before && g.ball === b, 'the replay must use and leave the called ball unchanged');

  // daily: the same rule
  S.mode = 'daily'; S.daily = { key: '2026-10-01', n: 2, level: 1, results: [], pts: 0 }; S.call = 0; g.startPoint(); frames.length = 0;
  callBall(true);  check(!g.replay, 'daily: a correct call must go straight to the review');
  S.phase = 'review'; g.nextStep(); frames.length = 0;
  callBall(false); check(!!g.replay, 'daily: a wrong call must get the replay');
  g.finishReplay();
}
{
  // practice: replay on every ball, endless, no timer, no score, nothing saved, accuracy tallied by landing distance
  const frames = [], g = boot('2026-10-01T12:00:00', 22, frames), { S, store } = g;
  const stats = JSON.stringify(g.ST), saved = JSON.stringify(store);
  g.practiceStart();
  const tally = { near: [0, 0], mid: [0, 0], far: [0, 0] };
  for (let i = 0; i < 60; i++) {
    const right = i % 3 !== 0, d = g.landDistance(g.ball), band = d < 4 ? 'near' : d < 8 ? 'mid' : 'far';
    S.phase = 'window'; g.resolve(right === g.ball.isIn ? 'in' : 'out', 0.5);
    check(!!g.replay, `practice: ball ${i + 1} (${right ? 'correct' : 'wrong'}) must get the replay`);
    tally[band][1]++; if (right) tally[band][0]++;
    g.finishReplay(); frames.length = 0; g.nextStep();   // the next ball's frame loop stays queued
  }
  check(S.call === 61, `practice must be endless: on ball ${S.call} after 60 calls`);
  check(S.score === 0 && S.streak === 0 && S.over === 0, `practice keeps no score, streak or strikes: ${S.score}/${S.streak}/${S.over}`);
  check(JSON.stringify(g.ST) === stats && JSON.stringify(store) === saved, 'practice must not change stats, badges or localStorage');
  check(JSON.stringify(Object.fromEntries(Object.entries(g.PR).map(([k, v]) => [k, [v.ok, v.n]]))) === JSON.stringify(tally), `practice tally by landing distance: ${JSON.stringify(g.PR)}, expected ${JSON.stringify(tally)}`);
  // no timer: run the frame loop for a minute without calling
  let ts = 1000; for (let i = 0; i < 3750; i++) { ts += 16; for (const f of frames.splice(0)) f(ts); }
  check(S.phase === 'window', `practice must not time out (phase ${S.phase} after a minute)`);
}

// ---------- daily streak and share text ----------
{
  const d = boot('2026-10-05T09:00:00', 31);
  for (const [k, n, want] of [['2026-03-01', -1, '2026-02-28'], ['2028-03-01', -1, '2028-02-29'], ['2027-01-01', -1, '2026-12-31'],
                              ['2026-03-29', -1, '2026-03-28'], ['2026-10-25', 1, '2026-10-26'], ['2026-12-31', 1, '2027-01-01']])
    check(d.shiftKey(k, n) === want, `shiftKey(${k}, ${n}) is ${d.shiftKey(k, n)}, expected ${want}`);
  const T = '2026-10-05', Y = '2026-10-04';
  const cases = [[null, { last: T, n: 1 }, 'first daily'], [{ last: Y, n: 4 }, { last: T, n: 5 }, 'played yesterday: streak continues'],
                 [{ last: T, n: 5 }, { last: T, n: 5 }, 'played today already: unchanged'], [{ last: '2026-10-02', n: 9 }, { last: T, n: 1 }, 'missed a day: starts again']];
  for (const [prev, want, label] of cases) check(JSON.stringify(d.streakAfterPlaying(prev, T)) === JSON.stringify(want), `streak, ${label}: ${JSON.stringify(d.streakAfterPlaying(prev, T))}`);
  check(d.streakNow({ last: T, n: 3 }, T) === 3 && d.streakNow({ last: Y, n: 3 }, T) === 3 && d.streakNow({ last: '2026-10-03', n: 3 }, T) === 0 && d.streakNow(null, T) === 0,
    'shown streak: kept through yesterday, 0 once a day is missed');
  // a real daily start on top of a stored streak from yesterday
  d.store['ctl.streak'] = JSON.stringify({ last: Y, n: 4 }); d.dailyStart();
  check(JSON.stringify(d.streakLoad()) === JSON.stringify({ last: T, n: 5 }), `starting today's daily extends the streak: ${d.store['ctl.streak']}`);
  // share text: one square per ball in order, the rank line only when known, the link, nothing about the balls
  const r = { n: 6, results: [true, true, false, ...Array(14).fill(true), false, true] };   // 19 played (17 correct), the 20th missing
  const lines = d.shareText(r, 'Pro', 17, { rank: 7, total: 31 }, 'https://calltheline.site/').split('\n');
  const squares = [...lines[0].split(' · ').pop()];
  check(lines[0].startsWith('Call the Line #6 · Pro · 17/20 · ') && squares.length === 20 && squares.filter(c => c === '🟩').length === 17
        && squares[2] === '🟥' && squares[17] === '🟥' && squares[19] === '🟥', `share line: ${lines[0]}`);
  check(lines[1] === '7th of 31 today' && lines[2] === 'https://calltheline.site/' && lines.length === 3, `share rank and link lines: ${JSON.stringify(lines.slice(1))}`);
  check(d.shareText(r, 'Pro', 17, null, 'u').split('\n').length === 2, 'no rank line when the rank is unknown');
}

// ---------- brand: the header logo is src/brand/logo.svg, inlined ----------
{
  const inner = svg => svg.trim().replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').trim();
  const brand = readFileSync(new URL('../src/brand/logo.svg', import.meta.url), 'utf8');
  const header = html.match(/<div class="brand">(<svg[\s\S]*?<\/svg>)<\/div>/);
  check(header && inner(header[1]) === inner(brand), 'the game header logo no longer matches src/brand/logo.svg: re-inline it');
}

if (failures.length) {
  console.error(`check failed: ${failures.length}${failures.length === 50 ? '+' : ''} problem(s)`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`check passed: ${balls} balls over ${Object.keys(SEATS).length} seat views (${Object.keys(g.SEAT_CHOICES).length} seats), 5 tiers, singles and doubles, ${Object.keys(CONDITIONS).length} conditions (${dampBalls} damp-grass balls with 20% longer marks; alley balls: ${alley.singles} singles, all out; ${alley.doubles} doubles, all in); every ball from a plausible hitter (least net clearance ${(minClear * 1000).toFixed(1)} mm; landing spot moved for ${movedPct.map(p => p.toFixed(1) + '%').join('/')} by tier); ${landscapeBalls} balls on screen in the 16:9 landscape court; daily identical on ${dates.length} dates; ${DAILY_FIXTURE.date} daily (${DAILY_FIXTURE.level}) matches the frozen fixture`);
