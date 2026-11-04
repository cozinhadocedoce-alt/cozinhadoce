// Monta a pasta _site para o GitHub Pages e gera uma página leve por doce em d/<id>/ com as
// tags Open Graph, para o link aparecer com a foto no WhatsApp, Instagram, Facebook etc.
// (eles não rodam o app para ler o link; leem só essas tags).
// Uso: SITE_URL=https://usuario.github.io/repositorio/ node scripts/build-site.mjs
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const OUT = '_site';
const STATIC = ['index.html', '404.html', 'privacidade.html', 'termos.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons', 'fotos'];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
for (const p of STATIC) if (existsSync(p)) cpSync(p, `${OUT}/${p}`, { recursive: true });
writeFileSync(`${OUT}/.nojekyll`, '');

const config = readFileSync('js/config.js', 'utf8');
const pick = (key) => config.match(new RegExp(`${key}:\\s*'([^']+)'`))?.[1];
const SUPABASE_URL = pick('SUPABASE_URL');
const SUPABASE_ANON_KEY = pick('SUPABASE_ANON_KEY');
const SITE_URL = (process.env.SITE_URL || '').replace(/\/?$/, '/');

if (!SUPABASE_URL || SUPABASE_URL.includes('SEU-PROJETO')) {
  console.log('Supabase ainda não configurado em js/config.js; pulando páginas de compartilhamento.');
  process.exit(0);
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const money = (v) => (v == null ? 'Sob consulta' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

const [prodRes, setRes] = await Promise.all([
  fetch(`${SUPABASE_URL}/rest/v1/products?select=id,title,price,description,photos&status=eq.published&order=published_at.desc&limit=2000`, { headers }),
  fetch(`${SUPABASE_URL}/rest/v1/app_settings?select=app_name,tagline,icon_url&id=eq.1`, { headers }),
]);
if (!prodRes.ok) {
  console.error('Falha ao ler os doces do Supabase:', prodRes.status, await prodRes.text());
  process.exit(0); // publica o site mesmo assim
}
const products = await prodRes.json();
const settings = (setRes.ok && (await setRes.json())[0]) || {};
const APP_NAME = settings.app_name || 'Cozinha Doce';

for (const p of products) {
  const title = `${p.title} · ${money(p.price)}`;
  const desc = (p.description || settings.tagline || '').replace(/\s+/g, ' ').slice(0, 200);
  const image = p.photos?.[0] || settings.icon_url || `${SITE_URL}icons/icon-512.png`;
  const target = `../../#/doce/${p.id}`;
  mkdirSync(`${OUT}/d/${p.id}`, { recursive: true });
  writeFileSync(
    `${OUT}/d/${p.id}/index.html`,
    `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — ${esc(APP_NAME)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="${esc(APP_NAME)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:alt" content="${esc(p.title)}">
<meta property="og:url" content="${esc(SITE_URL)}d/${p.id}/">
<meta property="product:price:amount" content="${p.price ?? ''}">
<meta property="product:price:currency" content="BRL">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=${target}">
<script>location.replace(${JSON.stringify(target)});</script>
</head>
<body><a href="${target}">Ver o doce</a></body>
</html>
`,
  );
}
console.log(`Geradas ${products.length} páginas de compartilhamento.`);
