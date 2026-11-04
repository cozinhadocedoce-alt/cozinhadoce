// Gera os ícones PNG a partir de icons/icon.svg. Uso: npm install && node scripts/build-icons.mjs
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const svg = readFileSync('icons/icon.svg', 'utf8');
const square = svg.replaceAll('rx="112"', 'rx="0"'); // iPhone e Android recortam o formato sozinhos
const maskable = square.replace('<g id="desenho">', '<g id="desenho" transform="translate(256 256) scale(0.78) translate(-256 -256)">');
// Selo monocromático da barra de notificações do Android (só o contorno conta).
const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><g fill="#fff"><path d="M86 236 C86 100 426 100 426 236 Z"/><rect x="96" y="248" width="320" height="44" rx="14"/><path d="M90 304 L422 304 C422 390 90 390 90 304 Z"/></g></svg>`;

const ICONS = [
  ['icons/icon-512.png', svg, 512],
  ['icons/icon-192.png', svg, 192],
  ['icons/favicon.png', svg, 64],
  ['icons/icon-maskable-512.png', maskable, 512],
  ['icons/apple-touch-icon.png', square, 180],
  ['icons/badge-96.png', badge, 96],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [path, src, w] of ICONS) {
  await page.setViewportSize({ width: w, height: w });
  await page.setContent(`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital@0;1&family=Montserrat:wght@500&display=block"><style>html,body{margin:0;background:transparent}svg{display:block}</style>${src.replace('<svg ', `<svg width="${w}" height="${w}" `)}`);
  await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(300);
  await page.screenshot({ path, omitBackground: true });
}
await browser.close();
console.log('Ícones gerados.');
