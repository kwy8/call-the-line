// Wraps src/game.html (the page body, also what gets published as a Claude artifact)
// into a complete standalone document at www/index.html for GitHub Pages and Capacitor.
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
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
<link rel="icon" href="brand/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="brand/apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE}">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${DESC}">
<meta property="og:image" content="${SITE}brand/og.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="The Call the Line logo, a tennis ball with a white line through it, and the words You think it's easy being a line judge?">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${TITLE}">
<meta name="twitter:description" content="${DESC}">
<meta name="twitter:image" content="${SITE}brand/og.png">
<meta name="twitter:image:alt" content="The Call the Line logo, a tennis ball with a white line through it, and the words You think it's easy being a line judge?">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)} [hidden]{display:none!important}</style>
</head>
<body>
${body}
</body>
</html>
`;
mkdirSync('www', { recursive: true });
writeFileSync('www/index.html', doc);
// the brand folder (icons, logo, link-preview image, font licence) goes alongside, as www/brand/
rmSync('www/brand', { recursive: true, force: true });
cpSync('src/brand', 'www/brand', { recursive: true });
// the privacy and Impressum page, copied unchanged
cpSync('src/privacy.html', 'www/privacy.html');
console.log('built www/index.html (' + doc.length + ' bytes), www/brand/ and www/privacy.html');
