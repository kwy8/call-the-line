// Wraps src/game.html (the page body, also what gets published as a Claude artifact)
// into a complete standalone document at www/index.html for GitHub Pages and Capacitor.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
const SITE = 'https://calltheline.site/';
const TITLE = 'Call the Line';
const DESC = "You think it's easy being a line judge? Call every ball in or out before Eagle-Eye overrules you. Five tournaments from club open to Grand Slam.";
const body = readFileSync('src/game.html', 'utf8');
const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="${DESC}">
<meta name="theme-color" content="#F3F5F0">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icon.svg">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE}">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${DESC}">
<meta property="og:image" content="${SITE}og.svg">
<meta property="og:image:type" content="image/svg+xml">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="A tennis ball touching a white court line, with the words Call the Line">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${TITLE}">
<meta name="twitter:description" content="${DESC}">
<meta name="twitter:image" content="${SITE}og.svg">
<meta name="twitter:image:alt" content="A tennis ball touching a white court line, with the words Call the Line">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)} [hidden]{display:none!important}</style>
</head>
<body>
${body}
</body>
</html>
`;
mkdirSync('www', { recursive: true });
writeFileSync('www/index.html', doc);
for (const f of ['icon.svg', 'og.svg']) copyFileSync('src/' + f, 'www/' + f);
console.log('built www/index.html (' + doc.length + ' bytes), icon.svg, og.svg');
