// Wraps src/game.html (the page body, also what gets published as a Claude artifact)
// into a complete standalone document at www/index.html for GitHub Pages and Capacitor.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const body = readFileSync('src/game.html', 'utf8');
const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="You think it's easy being a line judge? Call every ball in or out before Eagle-Eye overrules you. Five tournaments from club open to Grand Slam.">
<meta name="theme-color" content="#F3F5F0">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='13' fill='%23D6E23A' stroke='%23A9B520' stroke-width='3'/%3E%3C/svg%3E">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)} [hidden]{display:none!important}</style>
</head>
<body>
${body}
</body>
</html>
`;
mkdirSync('www', { recursive: true });
writeFileSync('www/index.html', doc);
console.log('built www/index.html (' + doc.length + ' bytes)');
