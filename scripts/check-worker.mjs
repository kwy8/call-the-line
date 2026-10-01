// Offline check for the leaderboard Worker in worker/src/index.js: runs its request handler against an in-memory KV.
//   npm run check   (runs scripts/check.mjs, then this)
// No network and no Cloudflare account needed.
import { handle, cleanName, maxScore, minScore, NAME_MAX } from '../worker/src/index.js';

// In-memory stand-in for a KV namespace: get, getWithMetadata, put (with metadata), paged list with metadata.
// `lag` hides keys from list() until a later list call, like KV's eventually consistent listing.
// `ops` counts calls by kind, so the check can hold the Worker to one KV write per accepted score.
function memoryKV() {
  const m = new Map(), hidden = new Set(), ops = { get: 0, put: 0, list: 0, delete: 0 };
  return {
    store: m, hidden, ops,
    async get(k) { ops.get++; return m.has(k) ? m.get(k).value : null; },
    async getWithMetadata(k) { ops.get++; return m.has(k) ? { value: m.get(k).value, metadata: m.get(k).metadata ?? null } : { value: null, metadata: null }; },
    async put(k, value, opts = {}) { ops.put++; m.set(k, { value, metadata: opts.metadata }); },
    async delete(k) { ops.delete++; m.delete(k); },
    async list({ prefix = '', cursor } = {}) {
      ops.list++;
      const all = [...m.keys()].filter(k => k.startsWith(prefix) && !hidden.has(k)).sort();
      const start = cursor ? +cursor : 0, page = all.slice(start, start + 2);  // tiny pages so paging is exercised
      const end = start + page.length;
      return { keys: page.map(name => ({ name, metadata: m.get(name).metadata })), list_complete: end >= all.length, cursor: String(end) };
    },
  };
}

// In-memory stand-in for caches.default: match and put by URL. Expiry is left to the Worker, which checks the age
// it stores in each entry against the `now` it is given.
function memoryCache() {
  const m = new Map();
  return {
    store: m,
    async match(k) { const r = m.get(String(k.url ?? k)); return r ? r.clone() : undefined; },
    async put(k, res) { m.set(String(k.url ?? k), res.clone()); },
    async delete(k) { return m.delete(String(k.url ?? k)); },
  };
}

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); return ok; };
const NOW = Date.parse('2026-10-01T09:30:00Z'), DAY = '2026-10-01';
let env = { LEADERBOARD: memoryKV(), ALLOWED_ORIGIN: '*' }, cache, ipCounter = 0;
const id = n => 'player' + String(n).padStart(14, '0');
// each request comes from a fresh IP unless one is given, so the rate limit only bites where it is being tested
async function call(method, path, body, { ip = `10.0.${++ipCounter >> 8}.${ipCounter & 255}`, now = NOW, raw, origin } = {}) {
  const init = { method, headers: { 'CF-Connecting-IP': ip, 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) } };
  if (body !== undefined || raw !== undefined) init.body = raw ?? JSON.stringify(body);
  const res = await handle(new Request('https://api.example.test' + path, init), env, now, cache);
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}
const score = (n, s, c, a = 600, name = 'P' + n) => call('POST', '/daily/score', { day: DAY, id: id(n), name, score: s, correct: c, avgMs: a });

// ---------- score bounds ----------
check(maxScore(0) === 0 && minScore(0) === 0, 'bounds for 0 correct');
check(maxScore(20) === 9400, `maxScore(20) is ${maxScore(20)}, expected 9400`);

// ---------- accept, then ignore a second submission for the same id and day ----------
let r = await score(1, 3000, 15, 700);
check(r.status === 200 && r.body.accepted === true && r.body.rank === 1 && r.body.total === 1, `first score: ${JSON.stringify(r)}`);
r = await score(1, 9000, 20, 100);
check(r.status === 200 && r.body.accepted === false && r.body.rank === 1 && r.body.total === 1, `second score for same id should be ignored: ${JSON.stringify(r.body)}`);
r = await call('GET', `/daily/top?day=${DAY}`);
check(r.body.top[0].score === 3000, 'the first score stands after a second submission');

// ---------- validation ----------
const bad = [
  [{ day: DAY, id: id(9), name: 'x', score: maxScore(10) + 1, correct: 10, avgMs: 500 }, 'score above the maximum'],
  [{ day: DAY, id: id(9), name: 'x', score: 999, correct: 10, avgMs: 500 }, 'score below 100 per correct call'],
  [{ day: DAY, id: id(9), name: 'x', score: 0, correct: 21, avgMs: 500 }, 'more than 20 correct'],
  [{ day: DAY, id: id(9), name: 'x', score: 1500.5, correct: 10, avgMs: 500 }, 'non-integer score'],
  [{ day: DAY, id: id(9), name: 'x', score: '1500', correct: 10, avgMs: 500 }, 'score as a string'],
  [{ day: '2026-10-05', id: id(9), name: 'x', score: 1500, correct: 10, avgMs: 500 }, 'day not open'],
  [{ day: '2026-02-30', id: id(9), name: 'x', score: 1500, correct: 10, avgMs: 500 }, 'impossible date'],
  [{ day: DAY, id: 'short', name: 'x', score: 1500, correct: 10, avgMs: 500 }, 'bad id'],
  [{ day: DAY, id: id(9), name: 'x', score: 1500, correct: 10, avgMs: -1 }, 'negative avgMs'],
];
for (const [body, why] of bad) { r = await call('POST', '/daily/score', body); check(r.status === 400, `${why}: expected 400, got ${r.status}`); }
r = await call('POST', '/daily/score', undefined, { raw: 'not json' }); check(r.status === 400, `non-JSON body: ${r.status}`);
r = await call('POST', '/daily/score', undefined, { raw: JSON.stringify({ pad: 'x'.repeat(2000) }) }); check(r.status === 413, `oversized body: ${r.status}`);
r = await call('GET', '/daily/score'); check(r.status === 405, `GET on /daily/score: ${r.status}`);
r = await call('GET', '/nope'); check(r.status === 404, `unknown path: ${r.status}`);
// yesterday and tomorrow (UTC) are open, for players in other timezones
for (const d of ['2026-09-30', '2026-10-02']) { r = await call('POST', '/daily/score', { day: d, id: id(8), name: 'tz', score: 100, correct: 1, avgMs: 500 }); check(r.status === 200, `day ${d} should be open: ${r.status}`); }

// ---------- names ----------
check(cleanName('\u0000Ann‮ie\n\t  Smith​') === 'Annie Smith', `control/format characters: "${cleanName('\u0000Ann‮ie\n\t  Smith​')}"`);
check([...cleanName('A'.repeat(40))].length === NAME_MAX, 'names cut to 16 characters');
check([...cleanName('🎾'.repeat(20))].length === NAME_MAX, 'names cut by character, not UTF-16 unit');
check(cleanName('   ') === 'Anonymous' && cleanName(null) === 'Anonymous', 'empty names become Anonymous');
r = await call('POST', '/daily/score', { day: DAY, id: id(7), name: '<b>\u0007Robot</b>' + 'x'.repeat(30), score: 100, correct: 1, avgMs: 900 });
r = await call('GET', `/daily/top?day=${DAY}`);
const stored = r.body.top.find(e => e.name.startsWith('<b>'));
check(stored && stored.name === '<b>Robot</b>xxxx' && [...stored.name].length === NAME_MAX, `stored name: ${JSON.stringify(stored)}`);

// ---------- ordering, top, rank ----------
env = { LEADERBOARD: memoryKV(), ALLOWED_ORIGIN: '*' };
const entries = [[1, 5000, 18, 800], [2, 6000, 19, 900], [3, 5000, 18, 500], [4, 100, 1, 300], [5, 9400, 20, 200]];
for (const [n, s, c, a] of entries) await score(n, s, c, a);
r = await call('GET', `/daily/top?day=${DAY}`);
check(JSON.stringify(r.body.top.map(e => e.name)) === JSON.stringify(['P5', 'P2', 'P3', 'P1', 'P4']), `order (score, then faster avg): ${r.body.top.map(e => e.name)}`);
check(r.body.total === 5 && r.body.top.every((e, i) => e.rank === i + 1), 'ranks and total in /daily/top');
check(r.body.top.every(e => !('id' in e)), '/daily/top must not expose ids');
check(r.headers.get('Cache-Control') === 'public, max-age=30', 'top is cacheable for 30 s');
r = await call('GET', `/daily/rank?day=${DAY}&id=${id(3)}`); check(r.body.rank === 3 && r.body.total === 5, `rank of P3: ${JSON.stringify(r.body)}`);
r = await call('GET', `/daily/rank?day=${DAY}&id=${id(99)}`); check(r.body.rank === null && r.body.total === 5, `rank of unknown id: ${JSON.stringify(r.body)}`);
for (let n = 10; n < 70; n++) await score(n, 100, 1, 1000 + n);
r = await call('GET', `/daily/top?day=${DAY}`); check(r.body.top.length === 50 && r.body.total === 65, `top 50 of 65: ${r.body.top.length} / ${r.body.total}`);
// a brand-new score still gets the right rank while KV listing lags behind
env.LEADERBOARD.hidden.add(`s:${DAY}:${id(80)}`);
r = await score(80, 5500, 18, 400); check(r.body.accepted && r.body.rank === 3 && r.body.total === 66, `rank while listing lags: ${JSON.stringify(r.body)}`);
check(r.body.top.length === 10 && r.body.top[2].name === 'P80' && r.body.top[2].rank === 3, `POST returns a fresh top 10 that includes the new score: ${JSON.stringify(r.body.top?.slice(0, 4))}`);
check(r.body.top.every(e => !('id' in e)), 'POST top must not expose ids');
env.LEADERBOARD.hidden.clear();

// ---------- rate limit: 30 requests per minute per IP ----------
env = { LEADERBOARD: memoryKV(), ALLOWED_ORIGIN: '*' };
const statuses = [];
for (let i = 0; i < 31; i++) statuses.push((await call('GET', `/daily/top?day=${DAY}`, undefined, { ip: '203.0.113.7' })).status);
check(statuses.slice(0, 30).every(s => s === 200) && statuses[30] === 429, `rate limit: ${statuses.join(',')}`);
r = await call('GET', `/daily/top?day=${DAY}`, undefined, { ip: '203.0.113.8' }); check(r.status === 200, 'another IP is not limited');
r = await call('GET', `/daily/top?day=${DAY}`, undefined, { ip: '203.0.113.7', now: NOW + 60000 }); check(r.status === 200, 'the limit resets the next minute');
check(env.LEADERBOARD.ops.put === 0 && env.LEADERBOARD.store.size === 0, `rate limiting must not write KV: ${env.LEADERBOARD.ops.put} puts`);

// the RATE_LIMITER binding decides when present; the in-memory fallback takes over if it throws
const limiterKeys = [];
env = { LEADERBOARD: memoryKV(), ALLOWED_ORIGIN: '*', RATE_LIMITER: { async limit({ key }) { limiterKeys.push(key); return { success: limiterKeys.length <= 2 }; } } };
statuses.length = 0;
for (let i = 0; i < 3; i++) statuses.push((await call('GET', `/daily/top?day=${DAY}`, undefined, { ip: '203.0.113.9' })).status);
check(statuses.join() === '200,200,429', `binding decides the limit: ${statuses}`);
check(limiterKeys.every(k => /^[0-9a-f]{16}$/.test(k)), `binding is keyed by a hash, not the raw IP: ${limiterKeys[0]}`);
env.RATE_LIMITER = { async limit() { throw new Error('binding down'); } };
r = await call('GET', `/daily/top?day=${DAY}`, undefined, { ip: '203.0.113.10' }); check(r.status === 200, 'a failing binding falls back instead of blocking');

// ---------- KV operations with the board cache ----------
// One put per accepted score and nothing else; start-screen loads within 30 s of each other don't touch KV.
env = { LEADERBOARD: memoryKV(), ALLOWED_ORIGIN: '*' }; cache = memoryCache();
const ops = env.LEADERBOARD.ops, snap = () => ({ ...ops });
for (let n = 1; n <= 5; n++) await score(n, 1000 + 100 * n, 10, 500);
check(ops.put === 5, `5 scores should be 5 KV writes, got ${ops.put}`);
check(ops.list === 1, `5 scores within 30 s should list KV once (then use the cached board), got ${ops.list}`);
let before = snap();
for (let i = 0; i < 20; i++) { await call('GET', `/daily/top?day=${DAY}`, undefined, { now: NOW + 1000 }); await call('GET', `/daily/rank?day=${DAY}&id=${id(3)}`, undefined, { now: NOW + 1000 }); }
check(ops.list === before.list && ops.get === before.get && ops.put === before.put, `cached top/rank must not touch KV: ${JSON.stringify(before)} -> ${JSON.stringify(ops)}`);
r = await call('GET', `/daily/top?day=${DAY}`, undefined, { now: NOW + 1000 });
check(r.body.total === 5 && r.body.top[0].name === 'P5', `cached top includes every submitted score: ${JSON.stringify(r.body)}`);
r = await call('GET', `/daily/rank?day=${DAY}&id=${id(3)}`, undefined, { now: NOW + 1000 }); check(r.body.rank === 3, `cached rank: ${JSON.stringify(r.body)}`);
// a new score updates the cached board straight away
await score(6, 9400, 20, 100);
r = await call('GET', `/daily/top?day=${DAY}`, undefined, { now: NOW + 2000 });
check(r.body.total === 6 && r.body.top[0].name === 'P6', `new score shows in the cached top at once: ${JSON.stringify(r.body.top?.[0])}`);
// a repeat submission writes nothing
before = snap(); await score(6, 9400, 20, 100); check(ops.put === before.put, 'a repeat submission must not write KV');
// the cached board expires 30 s after it was listed, even though submissions rewrote it, so scores sent to other
// locations (written straight to KV here) show up
env.LEADERBOARD.store.set(`s:${DAY}:${id(7)}`, { value: '', metadata: { n: 'Elsewhere', s: 9000, c: 20, a: 300, t: NOW } });
r = await call('GET', `/daily/top?day=${DAY}`, undefined, { now: NOW + 29000 }); check(r.body.total === 6, 'still cached at 29 s');
r = await call('GET', `/daily/top?day=${DAY}`, undefined, { now: NOW + 30000 }); check(r.body.total === 7, `relisted at 30 s: ${r.body.total}`);
check((await call('GET', `/__board/${DAY}`)).status === 404, 'the internal cache URL is not served');
const kvWrites = ops.put;
cache = undefined;

// ---------- CORS: echo back an allowed origin, nothing for any other ----------
const ALLOWED = ['https://calltheline.site', 'https://www.calltheline.site', 'https://kwy8.github.io', 'capacitor://localhost', 'https://localhost', 'http://localhost:3000'];
env = { LEADERBOARD: memoryKV(), ALLOWED_ORIGIN: ALLOWED.join(', ') };   // spaces after commas are tolerated
for (const o of ALLOWED) {
  r = await call('OPTIONS', '/daily/score', undefined, { origin: o });
  check(r.status === 204 && r.headers.get('Access-Control-Allow-Origin') === o && /POST/.test(r.headers.get('Access-Control-Allow-Methods') || ''), `preflight from ${o}: ${r.headers.get('Access-Control-Allow-Origin')}`);
  r = await call('GET', `/daily/top?day=${DAY}`, undefined, { origin: o });
  check(r.headers.get('Access-Control-Allow-Origin') === o, `GET from ${o}: ${r.headers.get('Access-Control-Allow-Origin')}`);
}
for (const o of ['https://evil.example', 'https://calltheline.site.evil.example', 'http://calltheline.site', 'https://kwy8.github.io.evil.example', 'http://localhost:8080', 'null', undefined]) {
  for (const [m, p] of [['OPTIONS', '/daily/score'], ['GET', `/daily/top?day=${DAY}`], ['POST', '/daily/score']]) {
    r = await call(m, p, m === 'POST' ? { day: DAY, id: id(500), name: 'x', score: 100, correct: 1, avgMs: 500 } : undefined, { origin: o });
    const leaked = [...r.headers.keys()].filter(k => k.startsWith('access-control-'));
    check(leaked.length === 0, `${m} from ${o ?? '(no Origin)'} must get no CORS headers, got ${leaked.join(', ')}`);
  }
}
r = await call('GET', `/daily/top?day=${DAY}`, undefined, { origin: 'https://evil.example' });
check(/Origin/.test(r.headers.get('Vary') || ''), 'responses vary by Origin');
env = { LEADERBOARD: memoryKV(), ALLOWED_ORIGIN: '*' };
r = await call('OPTIONS', '/daily/score', undefined, { origin: 'https://anything.example' });
check(r.headers.get('Access-Control-Allow-Origin') === '*', '"*" still allows any origin');

if (failures.length) { console.error(`worker check failed: ${failures.length} problem(s)`); for (const f of failures) console.error('  ' + f); process.exit(1); }
console.log('worker check passed: scores, one per id per day, validation, names, ordering, rank, fresh top 10 on submit, top 50, rate limit (binding and fallback, no KV), board cache, one KV write per score (' + kvWrites + ' writes for 6 scores), CORS allowlist');
