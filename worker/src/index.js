// Call the Line daily leaderboard: a Cloudflare Worker with one KV namespace (binding LEADERBOARD).
//
//   POST /daily/score  {day, id, name, score, correct, avgMs}  -> {accepted, rank, total, top}  (top 10, including this score)
//   GET  /daily/top?day=YYYY-MM-DD                             -> {day, total, top: [{rank, name, score, correct, avgMs}]}  (top 50)
//   GET  /daily/rank?day=YYYY-MM-DD&id=...                     -> {day, rank, total, topScore}  (rank null when the id has no score;
//                                                                  answers cached 5 min, e.g. for the game's "Yesterday" line)
//   GET  /weekly/top?day=YYYY-MM-DD[&id=...]                   -> {day, from, players, top: [{rank, name, total, days}], me}
//                                                                  (rolling 7 days ending on day, top 50, cached 5 min)
//
// Storage: one key per score, `s:<day>:<id>`, with the entry in the key's metadata, so a day's board is one paged
// list() with no per-key reads and two players submitting at once can't overwrite each other. The only KV write is
// that one put per accepted score. Rate limiting uses Cloudflare's rate limiting binding (RATE_LIMITER), keyed by a
// hash of the IP, and falls back to a per-isolate counter when the binding is missing; neither touches KV. A day's
// sorted board is kept in the Cache API for 30 s, so /daily/top and /daily/rank only list KV on a cache miss.

export const BALLS = 20, TOP = 50, NAME_MAX = 16, RATE_LIMIT = 30, BOARD_TTL = 30, SLOW_TTL = 300, WEEK = 7;

// Score bounds, mirroring resolve() in src/game.html: a correct call scores round((100 + speed) * mult), where speed
// runs 0..100 with how fast the call was and mult = 1 + min(4, floor(streak / 3)) * 0.5. A wrong call scores nothing
// and resets the streak. So c correct calls score at least 100 * c, and at most when all c come in a row at full speed.
// scripts/check.mjs plays the real game code to confirm these bounds.
export const minScore = correct => 100 * correct;
export function maxScore(correct) {
  let s = 0;
  for (let k = 1; k <= correct; k++) s += Math.round(200 * (1 + Math.min(4, Math.floor(k / 3)) * 0.5));
  return s;
}

// Display names: control and invisible formatting characters removed, whitespace collapsed, at most 16 characters.
export function cleanName(raw) {
  const s = String(raw ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').replace(/\s+/g, ' ').trim();
  return [...s].slice(0, NAME_MAX).join('').trim() || 'Anonymous';
}

const DAY = /^\d{4}-\d{2}-\d{2}$/, ID = /^[a-z0-9]{16,40}$/;
const isoDay = t => new Date(t).toISOString().slice(0, 10);
// A real calendar date in YYYY-MM-DD form. Date.parse gives NaN for impossible months (2026-13-01) and rolls over
// impossible days (2026-02-30 -> 2026-03-02), so both are caught by parsing and printing it back.
const validDay = day => { if (typeof day !== 'string' || !DAY.test(day)) return false; const t = Date.parse(day + 'T12:00:00Z'); return !Number.isNaN(t) && isoDay(t) === day; };
// A player's local calendar date is within a day of the UTC date, so only yesterday, today and tomorrow (UTC) are open.
const openDays = now => [isoDay(now - 864e5), isoDay(now), isoDay(now + 864e5)];

// Returns the reason a submission is rejected, or null when it is acceptable.
export function invalid(b, now) {
  if (!b || typeof b !== 'object') return 'body must be a JSON object';
  if (!validDay(b.day)) return 'day must be YYYY-MM-DD';
  if (!openDays(now).includes(b.day)) return 'day is not open for scores';
  if (typeof b.id !== 'string' || !ID.test(b.id)) return 'id must be 16-40 lowercase letters or digits';
  if (!Number.isInteger(b.correct) || b.correct < 0 || b.correct > BALLS) return `correct must be 0-${BALLS}`;
  if (!Number.isInteger(b.score) || b.score < minScore(b.correct) || b.score > maxScore(b.correct)) return 'score is not possible for that many correct calls';
  if (!Number.isInteger(b.avgMs) || b.avgMs < 0 || b.avgMs > 5000) return 'avgMs must be 0-5000';
  return null;
}

// The whole board for a day, best first: higher score, then faster average call, then earlier submission.
const better = (a, b) => b.s - a.s || a.a - b.a || a.t - b.t;
const publicRows = (rows, n) => rows.slice(0, n).map((r, i) => ({ rank: i + 1, name: r.n, score: r.s, correct: r.c, avgMs: r.a }));
async function board(kv, day) {
  const rows = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: `s:${day}:`, cursor });
    for (const k of page.keys) if (k.metadata) rows.push({ id: k.name.slice(day.length + 3), ...k.metadata });
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return rows.sort(better);
}

async function hashIp(ip) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ctl-rl:' + ip));
  return [...new Uint8Array(d).slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// 30 requests per minute per IP. The RATE_LIMITER binding (wrangler.toml, [[ratelimits]]) counts per Cloudflare
// location and is approximate by design. Without it, or if it throws, each isolate counts in memory per minute, which
// is looser still (a busy Worker runs several isolates) but costs nothing and never blocks a player on an error.
let memMinute = -1, memCounts = new Map();
function memOverLimit(key, now) {
  const minute = Math.floor(now / 60000);
  if (minute !== memMinute) { memMinute = minute; memCounts = new Map(); }
  const n = (memCounts.get(key) || 0) + 1;
  memCounts.set(key, n);
  return n > RATE_LIMIT;
}
async function overLimit(env, ip, now) {
  const key = await hashIp(ip);
  if (env.RATE_LIMITER?.limit) {
    try { return !(await env.RATE_LIMITER.limit({ key })).success; } catch (e) { /* fall back to memory */ }
  }
  return memOverLimit(key, now);
}

// A day's sorted board (with ids, for /daily/rank) in the Cache API under an internal URL the router never serves.
// The entry records when it was listed from KV and expires BOARD_TTL seconds after that, even when a submission
// rewrites it, so a location keeps picking up scores sent elsewhere. The Cache API is per location: a new score
// refreshes the board where it was sent, other locations see it within 30 s. `cache` is undefined outside Workers.
const boardKey = (url, day) => `https://${url.host}/__board/${day}`;
async function cachedBoard(cache, url, day, now) {
  const hit = cache && await cache.match(boardKey(url, day));
  if (!hit) return null;
  const { at, rows } = await hit.json();
  return now - at < BOARD_TTL * 1000 ? { at, rows } : null;
}
async function storeBoard(cache, url, day, at, rows, now) {
  if (!cache) return;
  const ttl = Math.ceil(BOARD_TTL - (now - at) / 1000);
  if (ttl <= 0) return;
  await cache.put(boardKey(url, day), new Response(JSON.stringify({ at, rows }),
    { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` } }));
}
async function freshBoard(kv, cache, url, day, now) {
  const cached = await cachedBoard(cache, url, day, now);
  if (cached) return cached;
  const rows = await board(kv, day);
  await storeBoard(cache, url, day, now, rows, now);
  return { at: now, rows };
}

// Answers that may be up to SLOW_TTL (5 min) old: a player's rank on a day, and the weekly board. Same scheme as the
// board: an internal Cache API URL, the time it was computed stored with it.
async function cachedJson(cache, key, now, ttl) {
  const hit = cache && await cache.match(key);
  if (!hit) return null;
  const { at, body } = await hit.json();
  return now - at < ttl * 1000 ? body : null;
}
async function storeJson(cache, key, now, ttl, body) {
  if (cache) await cache.put(key, new Response(JSON.stringify({ at: now, body }),
    { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` } }));
}
const shiftDay = (day, n) => isoDay(Date.parse(day + 'T12:00:00Z') + n * 864e5);
// The rolling week ending on `day`: each player's daily scores summed, with the name from their latest day there.
// Best first: higher total, then the player who first scored earlier.
async function weekBoard(kv, cache, url, day, now) {
  const players = new Map();
  for (let k = WEEK - 1; k >= 0; k--) {                          // oldest day first, so the latest name wins
    const { rows } = await freshBoard(kv, cache, url, shiftDay(day, -k), now);
    for (const r of rows) {
      const p = players.get(r.id) || { id: r.id, total: 0, days: 0, first: r.t };
      p.total += r.s; p.days++; p.name = r.n; p.first = Math.min(p.first, r.t);
      players.set(r.id, p);
    }
  }
  return [...players.values()].sort((a, b) => b.total - a.total || a.first - b.first);
}

// CORS: ALLOWED_ORIGIN is a comma-separated list of origins (or "*"). A request whose Origin is on the list gets that
// origin echoed back; any other origin, or no Origin at all, gets no CORS headers, so browsers refuse the response.
// An entry like https://*.game-files.crazygames.com matches exactly one subdomain label in place of the *.
export function corsHeaders(allowed, origin) {
  const list = String(allowed || '').split(',').map(o => o.trim()).filter(Boolean);
  const matches = o => o === origin || (o.includes('*.') &&
    new RegExp('^' + o.split('*').map(p => p.replace(/[.+?^${}()|[\]\\/]/g, '\\$&')).join('[a-z0-9-]+') + '$').test(origin));
  if (!origin || !(list.includes('*') || list.some(matches))) return {};
  return { 'Access-Control-Allow-Origin': list.includes('*') ? '*' : origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
           'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' };
}

export async function handle(request, env, now = Date.now(), cache = globalThis.caches?.default) {
  const url = new URL(request.url), kv = env.LEADERBOARD;
  // Vary: Origin on every response, since the CORS headers depend on it and /daily/top may be cached
  const cors = { Vary: 'Origin', ...corsHeaders(env.ALLOWED_ORIGIN, request.headers.get('Origin')) };
  const reply = (status, body, extra = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors, ...extra } });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (await overLimit(env, ip, now)) return reply(429, { error: 'too many requests, try again in a minute' }, { 'Retry-After': '60' });

  if (url.pathname === '/daily/score') {
    if (request.method !== 'POST') return reply(405, { error: 'use POST' });
    const text = await request.text();
    if (text.length > 1024) return reply(413, { error: 'body too large' });
    let b;
    try { b = JSON.parse(text); } catch (e) { return reply(400, { error: 'body must be JSON' }); }
    const why = invalid(b, now);
    if (why) return reply(400, { error: why });
    const key = `s:${b.day}:${b.id}`, prev = await kv.getWithMetadata(key);
    // one score per id per day: a later submission is ignored and the first one stands
    const me = prev.metadata ? { id: b.id, ...prev.metadata } : { id: b.id, n: cleanName(b.name), s: b.score, c: b.correct, a: b.avgMs, t: now };
    if (!prev.metadata) await kv.put(key, '', { metadata: { n: me.n, s: me.s, c: me.c, a: me.a, t: me.t } });
    // KV listing is eventually consistent, so a score written moments ago may be missing from the list: add it back.
    // The board comes from the cache when it is under 30 s old; the merged board goes back into the cache (keeping
    // its original expiry), so the next /daily/top here includes this score without listing KV again.
    const cur = await freshBoard(kv, cache, url, b.day, now);
    const rows = cur.rows.filter(r => r.id !== me.id).concat(me).sort(better);
    if (!prev.metadata) await storeBoard(cache, url, b.day, cur.at, rows, now);
    return reply(200, { accepted: !prev.metadata, rank: rows.indexOf(me) + 1, total: rows.length, top: publicRows(rows, 10) });
  }

  if (url.pathname === '/daily/top' || url.pathname === '/daily/rank') {
    if (request.method !== 'GET') return reply(405, { error: 'use GET' });
    const day = url.searchParams.get('day') || '';
    if (!DAY.test(day)) return reply(400, { error: 'day must be YYYY-MM-DD' });
    const { rows } = await freshBoard(kv, cache, url, day, now);
    if (url.pathname === '/daily/top')
      return reply(200, { day, total: rows.length, top: publicRows(rows, TOP) },
                  { 'Cache-Control': 'public, max-age=30' });
    const id = url.searchParams.get('id') || '';
    if (!ID.test(id)) return reply(400, { error: 'id must be 16-40 lowercase letters or digits' });
    const key = `https://${url.host}/__rank/${day}/${id}`;
    let body = await cachedJson(cache, key, now, SLOW_TTL);
    if (!body) {
      const i = rows.findIndex(r => r.id === id);
      body = { day, rank: i < 0 ? null : i + 1, total: rows.length, topScore: rows.length ? rows[0].s : null };
      await storeJson(cache, key, now, SLOW_TTL, body);
    }
    return reply(200, body, { 'Cache-Control': `public, max-age=${SLOW_TTL}` });
  }

  if (url.pathname === '/weekly/top') {
    if (request.method !== 'GET') return reply(405, { error: 'use GET' });
    const day = url.searchParams.get('day') || '', id = url.searchParams.get('id') || '';
    if (!validDay(day)) return reply(400, { error: 'day must be YYYY-MM-DD' });
    if (id && !ID.test(id)) return reply(400, { error: 'id must be 16-40 lowercase letters or digits' });
    const key = `https://${url.host}/__weekly/${day}`;
    let rows = await cachedJson(cache, key, now, SLOW_TTL);
    if (!rows) { rows = await weekBoard(kv, cache, url, day, now); await storeJson(cache, key, now, SLOW_TTL, rows); }
    const i = id ? rows.findIndex(r => r.id === id) : -1;
    return reply(200, { day, from: shiftDay(day, -(WEEK - 1)), players: rows.length,
      top: rows.slice(0, TOP).map((r, k) => ({ rank: k + 1, name: r.name, total: r.total, days: r.days })),
      me: i < 0 ? null : { rank: i + 1, total: rows[i].total, days: rows[i].days } },
      { 'Cache-Control': `public, max-age=${SLOW_TTL}` });
  }
  return reply(404, { error: 'not found' });
}

export default { fetch: (request, env) => handle(request, env) };
