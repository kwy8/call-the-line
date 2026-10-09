// Layout check for the CrazyGames iframe sizes, in headless Chromium (Playwright): builds www/, then at 800x450,
// 1280x720 and 1920x1080 (DPR 1) plays through the screens a player meets and, on each, asserts that the page doesn't
// scroll, the card on screen fits without scrolling, and no visible element sits outside the viewport.
//   npm run check:layout   (also part of npm run check; needs npx playwright install chromium)
// Screens: the first visit's tournament card, a ball in play (with the coaching overlay), the review card, promotion,
// the next tournament's card, game over, Rules, Stats, the menu, the practice card and the daily intro.
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';
import { serveWww, withStateHook } from './serve-www.mjs';

const SIZES = [[800, 450], [1280, 720], [1920, 1080]];
execSync('node scripts/build.mjs', { stdio: 'ignore' });
const server = await serveWww(withStateHook);
const browser = await chromium.launch();
const failures = [];
let screens = 0;

// Everything wrong with the current screen: page scroll, a scrolling card, elements outside the viewport
const problems = page => page.evaluate(() => {
  const vw = innerWidth, vh = innerHeight, bad = [], se = document.scrollingElement;
  if (se.scrollHeight > vh + 1 || se.scrollWidth > vw + 1) bad.push(`page scrolls (${se.scrollWidth} x ${se.scrollHeight})`);
  const ov = document.getElementById('overlay');
  if (!ov.hidden && ov.scrollHeight > ov.clientHeight + 1) bad.push(`card scrolls (${ov.scrollHeight} px in ${ov.clientHeight})`);
  for (const el of document.querySelectorAll('body *')) {
    if (!el.getClientRects().length || el.closest('[hidden]')) continue;
    const st = getComputedStyle(el); if (st.visibility === 'hidden' || +st.opacity === 0) continue;
    const r = el.getBoundingClientRect(); if (!r.width && !r.height) continue;
    if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1)
      bad.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} outside the viewport (${Math.round(r.left)}, ${Math.round(r.top)}, ${Math.round(r.width)} x ${Math.round(r.height)})`);
  }
  return bad.slice(0, 6);
});

for (const [w, h] of SIZES) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|fonts\.)/, r => r.abort());   // no leaderboard calls; fonts allowed
  const shown = sel => page.locator(sel).first().isVisible();
  const expect = async (name, sel) => {
    await page.locator(sel).first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => failures.push(`${w}x${h} ${name}: ${sel} never appeared`));
    await page.waitForTimeout(150); screens++;
    for (const p of await problems(page)) failures.push(`${w}x${h} ${name}: ${p}`);
  };
  // one ball: wait for the call window, call it right or wrong, then wait for the review card (after any replay)
  const call = async right => {
    await page.waitForFunction(() => !document.getElementById('btnIn').disabled, null, { timeout: 10000 });
    const isIn = await page.evaluate(() => window.__ctl.ball.isIn);
    await page.locator(isIn === right ? '#btnIn' : '#btnOut').click();
    await page.locator('#nx').waitFor({ state: 'visible', timeout: 10000 });
  };
  await page.goto(server.url);
  await expect('first visit: tournament card', '#go');
  await page.locator('#go').click();
  await page.waitForFunction(() => !document.getElementById('btnIn').disabled, null, { timeout: 10000 });
  await expect('ball in play', '#btnIn');
  for (let i = 0; i < 10; i++) {
    await call(true);
    if (i === 0) await expect('review card', '#nx');
    await page.locator('#nx').click();
  }
  await expect('promotion', '#go');
  await page.locator('#go').click();
  await expect('next tournament card', '#go');
  await page.locator('#go').click();
  for (let i = 0; i < 3; i++) { await call(false); await page.locator('#nx').click(); }
  await expect('game over', '#again');
  await page.locator('#rulesBtn').click(); await expect('rules', '#go'); await page.locator('#go').click();
  await page.locator('#statsBtn').click(); await expect('stats', '#go'); await page.locator('#go').click();
  await page.locator('#home').click(); if (!(await shown('#practice'))) await page.locator('#home').click();
  await expect('menu', '#practice');
  await page.locator('#practice').click(); await expect('practice card', '#back'); await page.locator('#back').click();
  await page.locator('#daily').click(); await expect('daily intro', '#go');
  await context.close();
}
await browser.close(); server.close();

if (failures.length) {
  console.error(`layout check failed: ${failures.length} problem(s)`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`layout check passed: ${screens} screens at ${SIZES.map(s => s.join('x')).join(', ')}; no page scroll, no card scroll, nothing outside the viewport`);
