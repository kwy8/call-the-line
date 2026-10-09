// A tiny static server for www/ on a free local port, for the Playwright scripts (preview-video, check-layout).
// transform(html) may rewrite index.html as it is served; the file on disk is never changed.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };

export async function serveWww(transform = html => html) {
  const index = transform(readFileSync('www/index.html', 'utf8'));
  const server = createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join('www', path));
    if (!file.startsWith('www') || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(path === '/index.html' ? index : readFileSync(file));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() };
}

// The game keeps its state inside one IIFE; like scripts/check.mjs, expose S and the current ball just before it closes.
const END = /\}\)\(\);(\s*<\/script>(?![\s\S]*<\/script>))/;   // the close of the game IIFE, the last script on the page
export function withStateHook(html) {
  if (!END.test(html)) throw new Error('www/index.html: game script no longer ends with "})();"');
  return html.replace(END, 'window.__ctl={ S, get ball(){ return ball; } };\n})();$1');
}
