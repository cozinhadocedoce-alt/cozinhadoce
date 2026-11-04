// Gera os ícones PNG a partir de icons/icon.svg. Uso: npm install && node scripts/build-icons.mjs
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const svg = readFileSync('icons/icon.svg', 'utf8');
const square = svg.replaceAll('rx="112"', 'rx="0"'); // iPhone e Android recortam o formato sozinhos
const maskable = square.replace('<g id="desenho">', '<g id="desenho" transform="translate(256 256) scale(0.78) translate(-256 -256)">');
// Selo monocromático da barra de notificações do Android (só o contorno conta).
const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="#fff" d="M150 284h212l-26 128a24 24 0 0 1-23.5 19h-113A24 24 0 0 1 176 412z"/><path fill="#fff" d="M140 276c-22-4-30-40-6-54-14-30 14-60 44-50 4-36 46-56 76-36 30-20 72 0 76 36 30-10 58 20 44 50 24 14 16 50-6 54z"/><circle fill="#fff" cx="256" cy="126" r="30"/></svg>`;

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
