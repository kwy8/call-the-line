// Offline check for the leaderboard Worker in worker/src/index.js: runs its request handler against an in-memory KV.
//   npm run check   (runs scripts/check.mjs, then this)
// No network and no Cloudflare account needed.
import { handle, cleanName, maxScore, minScore, NAME_MAX } from '../worker/src/index.js';

// In-memory stand-in for a KV namespace: get, getWithMetadata, put (with metadata), paged list with metadata.
// `lag` hides keys from list() until a later list call, like KV's eventually consistent listing.
function memoryKV() {
  const m = new Map(), hidden = new Set();
  return {
    store: m, hidden,
    async get(k) { return m.has(k) ? m.get(k).value : null; },
    async getWithMetadata(k) { return m.has(k) ? { value: m.get(k).value, metadata: m.get(k).metadata ?? null } : { value: null, metadata: null }; },
    async put(k, value, opts = {}) { m.set(k, { value, metadata: opts.metadata }); },
    async list({ prefix = '', cursor } = {}) {
      const all = [...m.keys()].filter(k => k.startsWith(prefix) && !hidden.has(k)).sort();
      const start = cursor ? +cursor : 0, page = all.slice(start, start + 2);  // tiny pages so paging is exercised
      const end = start + page.length;
      return { keys: page.map(name => ({ name, metadata: m.get(name).metadata })), list_complete: end >= all.length, cursor: String(end) };
    },
  };
}

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); return ok; };
const NOW = Date.parse('2026-10-01T09:30:00Z'), DAY = '2026-10-01';
let env = { LEADERBOARD: memoryKV(), ALLOWED_ORIGIN: '*' }, ipCounter = 0;
const id = n => 'player' + String(n).padStart(14, '0');
// each request comes from a fresh IP unless one is given, so the rate limit only bites where it is being tested
async function call(method, path, body, { ip = `10.0.${++ipCounter >> 8}.${ipCounter & 255}`, now = NOW, raw } = {}) {
  const init = { method, headers: { 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' } };
  if (body !== undefined || raw !== undefined) init.body = raw ?? JSON.stringify(body);
  const res = await handle(new Request('https://api.example.test' + path, init), env, now);
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
check(![...env.LEADERBOARD.store.keys()].some(k => k.includes('203.0.113')), 'raw IPs must not be stored');

// ---------- CORS ----------
r = await call('OPTIONS', '/daily/score');
check(r.status === 204 && r.headers.get('Access-Control-Allow-Origin') === '*' && /POST/.test(r.headers.get('Access-Control-Allow-Methods')), 'CORS preflight');

if (failures.length) { console.error(`worker check failed: ${failures.length} problem(s)`); for (const f of failures) console.error('  ' + f); process.exit(1); }
console.log('worker check passed: scores, one per id per day, validation, names, ordering, rank, fresh top 10 on submit, top 50, rate limit, CORS');
