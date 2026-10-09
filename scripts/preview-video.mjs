// Records two gameplay preview videos for the CrazyGames listing: builds www/, serves it locally, plays a career
// tournament for ~25 s in headless Chromium (1920x1080 desktop, then 1080x1920 touch), and converts each recording to
// H.264 MP4 in dist/crazygames-assets/. Needs Playwright's Chromium (npx playwright install chromium) and ffmpeg.
//
// The game's layout is capped at a 760 px column, so each run uses a laptop- or phone-sized CSS viewport with a device
// scale factor that brings it up to the full video size. Playwright's recordVideo captures CSS pixels only (it pads a
// scaled page with grey instead), so frames come from Chrome's own screencast at device pixels, piped into ffmpeg.
// Capture starts when the first tournament's Play is pressed, so the video opens on the court.
//
// The game keeps its state inside one IIFE, so, like scripts/check.mjs, the served copy of index.html (not the file
// on disk) gets a hook just before the IIFE closes that exposes the current ball; the bot reads ball.isIn from it.
// It calls correctly, except for one deliberate miss so the trailer shows an overrule and its ghost replay.
import { execSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { serveWww, withStateHook } from './serve-www.mjs';

const PLAY_S = 25, FPS = 30, MISS_AT = 3;   // seconds of play after the first serve; output frame rate; the call to get wrong
const OUT = 'dist/crazygames-assets';
const RUNS = [
  { name: 'landscape', viewport: { width: 1440, height: 810 }, scale: 4/3, touch: false },   // 1920x1080
  { name: 'portrait',  viewport: { width: 540,  height: 960 }, scale: 2,   touch: true },    // 1080x1920
];

execSync('npm run build', { stdio: 'inherit' });

// ---------- local server for www/, with the state hook in index.html ----------
const server = await serveWww(withStateHook);
const URL_ = server.url;

// ---------- play ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Returns the number of calls made. onCourt() runs as the first tournament's Play is pressed.
async function play(page, touch, onCourt) {
  const press = sel => touch ? page.locator(sel).tap() : page.locator(sel).click();
  await page.locator('#go').waitFor(); await sleep(500); await onCourt(); await press('#go');   // a first visit opens on the tournament card: Play
  const t0 = Date.now(); let calls = 0;
  while (Date.now() - t0 < PLAY_S * 1000) {
    const state = await page.waitForFunction(() => {
      const $ = id => document.getElementById(id), shown = el => el && el.offsetParent !== null && !el.disabled;
      if (!$('btnIn').disabled) return 'call';
      if (shown($('nx'))) return 'next';
      if (shown($('go'))) return 'go';
      return false;
    }, null, { timeout: 15000, polling: 50 }).then(h => h.jsonValue());
    if (state === 'call') {
      await sleep(260 + Math.random() * 200);                   // a human-ish reaction after the bounce
      const isIn = await page.evaluate(() => window.__ctl?.ball?.isIn);
      calls++;
      const right = isIn === undefined ? Math.random() < 0.5 : isIn;   // no hook: call at random
      await press((calls === MISS_AT ? !right : right) ? '#btnIn' : '#btnOut');
      await page.waitForFunction(() => document.getElementById('btnIn').disabled);
    } else {
      await sleep(state === 'next' ? 1400 : 1800);              // leave the review or card on screen a moment
      await press(state === 'next' ? '#nx' : '#go');
    }
  }
  return calls;
}

// Chrome's screencast sends a JPEG whenever the page repaints; ffmpeg stamps each with its arrival time and resamples
// to a constant frame rate. Returns stop(), which resolves once the MP4 is written.
async function capture(page, size, mp4) {
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-use_wallclock_as_timestamps', '1', '-c:v', 'mjpeg', '-i', '-',
    '-an', '-vf', `scale=${size.width}:${size.height}:flags=lanczos,fps=${FPS}`, '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', mp4], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', code => code ? rej(new Error(`ffmpeg exited ${code}`)) : res()));
  const cdp = await page.context().newCDPSession(page);
  cdp.on('Page.screencastFrame', f => { ff.stdin.write(Buffer.from(f.data, 'base64')); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: size.width, maxHeight: size.height, everyNthFrame: 1 });
  return async () => { await cdp.send('Page.stopScreencast'); ff.stdin.end(); await done; };
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  for (const run of RUNS) {
    const size = { width: run.viewport.width * run.scale, height: run.viewport.height * run.scale };
    const context = await browser.newContext({ viewport: run.viewport, deviceScaleFactor: run.scale, isMobile: run.touch, hasTouch: run.touch });
    const page = await context.newPage(), mp4 = join(OUT, `preview-${run.name}.mp4`);
    await page.goto(URL_);
    let stop;
    const calls = await play(page, run.touch, async () => { stop = await capture(page, size, mp4); });
    await stop(); await context.close();
    console.log(`${mp4}: ${calls} calls`);
  }
} finally {
  await browser.close(); server.close();
}
