// Envia por e-mail os doces publicados há pouco para quem marcou "Novidades por e-mail" no perfil.
// Roda no agendamento "Enviar novidades por e-mail" do GitHub (a cada 10 minutos).
// Cada pessoa recebe UM e-mail por vez com todos os doces novos das categorias que escolheu
// (ou todos, se não escolheu nenhuma). Cada doce é enviado uma vez só.
//
// Variáveis: NEWS_EMAIL_SECRET (a mesma do Vault 'news_email_secret'), GMAIL_USER,
// GMAIL_APP_PASSWORD (senha de app do Google) e SITE_URL.
// Teste sem enviar nada: DRY_RUN=1 node scripts/enviar-novidades.mjs
// Prévia do e-mail num arquivo: PREVIEW=caminho.html node scripts/enviar-novidades.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const config = readFileSync(new URL('../js/config.js', import.meta.url), 'utf8');
const pick = (key) => config.match(new RegExp(`${key}:\\s*'([^']+)'`))?.[1];
const SUPABASE_URL = pick('SUPABASE_URL');
const SUPABASE_ANON_KEY = pick('SUPABASE_ANON_KEY');
const SITE = (process.env.SITE_URL || 'https://cozinhadocedoce-alt.github.io/cozinhadoce/').replace(/\/?$/, '/');
const { NEWS_EMAIL_SECRET, GMAIL_USER, GMAIL_APP_PASSWORD, DRY_RUN, PREVIEW } = process.env;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (v) => (v == null ? 'Sob consulta' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';

export function buildEmail({ app, person, products }) {
  const color = /^#[0-9a-f]{6}$/i.test(app.color || '') ? app.color : '#e5568a';
  const name = app.name || 'Cozinha Doce';
  const unsub = `${SITE}sair.html?t=${encodeURIComponent(person.token)}`;
  const subject = products.length === 1
    ? `Novidade na ${name} 🍰: ${products[0].title}`
    : `${products.length} novidades na ${name} 🍰`;
  const helloText = firstName(person.name) ? `Oi, ${firstName(person.name)}!` : 'Oi!';
  const hello = esc(helloText);
  const intro = products.length === 1 ? 'Acabou de sair um doce novo:' : 'Acabaram de sair doces novos:';

  const cards = products.map((p) => {
    const link = `${SITE}d/${p.id}/`;
    const cat = p.category_name ? `${esc(p.category_emoji || '')} ${esc(p.category_name)}`.trim() : '';
    const desc = String(p.description || '').replace(/\s+/g, ' ').trim();
    return `
      <tr><td style="padding:0 0 20px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #f0e4ea">
          ${p.photo ? `<tr><td><a href="${esc(link)}"><img src="${esc(p.photo)}" alt="${esc(p.title)}" width="520" style="display:block;width:100%;max-width:520px;height:auto;border:0"></a></td></tr>` : ''}
          <tr><td style="padding:18px 20px 20px">
            ${cat ? `<div style="font-size:13px;color:#8a7a82;margin:0 0 6px">${cat}</div>` : ''}
            <div style="font-size:20px;font-weight:700;color:#2b2226;margin:0 0 4px">${esc(p.title)}</div>
            <div style="font-size:18px;font-weight:700;color:${color};margin:0 0 10px">${esc(money(p.price))}</div>
            ${desc ? `<div style="font-size:15px;line-height:1.5;color:#5a4d53;margin:0 0 16px">${esc(desc.length > 220 ? desc.slice(0, 217) + '…' : desc)}</div>` : ''}
            <a href="${esc(link)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:999px">Ver o doce</a>
          </td></tr>
        </table>
      </td></tr>`;
  }).join('');

  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#fbf5f8;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbf5f8"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
      <tr><td style="padding:0 0 18px;text-align:center">
        ${app.icon ? `<img src="${esc(app.icon)}" alt="" width="56" height="56" style="display:inline-block;border-radius:14px;border:0">` : ''}
        <div style="font-size:22px;font-weight:700;color:${color};margin-top:8px">${esc(name)}</div>
        ${app.tagline ? `<div style="font-size:14px;color:#8a7a82">${esc(app.tagline)}</div>` : ''}
      </td></tr>
      <tr><td style="padding:0 0 16px;font-size:16px;color:#2b2226">${hello} ${intro}</td></tr>
      ${cards}
      <tr><td style="padding:4px 8px 0;text-align:center;font-size:12px;line-height:1.6;color:#8a7a82">
        Você recebe este e-mail porque marcou “Novidades por e-mail” no seu perfil da ${esc(name)}.<br>
        <a href="${esc(unsub)}" style="color:#8a7a82">Não quero mais receber</a>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  const text = [
    `${helloText} ${intro}`, '',
    ...products.map((p) => `${p.title} · ${money(p.price)}\n${SITE}d/${p.id}/\n`),
    `Não quer mais receber? ${unsub}`,
  ].join('\n');

  return { subject, html, text, unsub };
}

async function rpc(fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${await res.text()}`);
  const body = await res.text();
  return body ? JSON.parse(body) : null;
}

async function main() {
  if (!NEWS_EMAIL_SECRET) throw new Error('Falta NEWS_EMAIL_SECRET.');
  const { app, products, people } = await rpc('news_email_pending', { p_secret: NEWS_EMAIL_SECRET });
  if (!products.length) { console.log('Nenhum doce novo para enviar.'); return; }

  const jobs = people
    .map((person) => ({ person, products: products.filter((p) => !person.categories?.length || person.categories.includes(p.category)) }))
    .filter((j) => j.products.length);
  console.log(`${products.length} doce(s) novo(s), ${jobs.length} pessoa(s) para avisar.`);

  if (PREVIEW && jobs[0]) { writeFileSync(PREVIEW, buildEmail({ app, ...jobs[0] }).html); console.log(`Prévia salva em ${PREVIEW}.`); }
  if (DRY_RUN) { console.log('DRY_RUN: nada foi enviado nem marcado.'); return; }
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) throw new Error('Falta GMAIL_USER ou GMAIL_APP_PASSWORD.');

  let sent = 0, failed = 0;
  if (jobs.length) {
    const { default: nodemailer } = await import('nodemailer');
    const mail = nodemailer.createTransport({ service: 'gmail', pool: true, maxConnections: 2, auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD.replace(/\s+/g, '') } });
    await mail.verify();
    for (const job of jobs) {
      const { subject, html, text, unsub } = buildEmail({ app, ...job });
      try {
        await mail.sendMail({
          from: { name: app.name || 'Cozinha Doce', address: GMAIL_USER },
          to: job.person.email, subject, html, text,
          headers: { 'List-Unsubscribe': `<${unsub}>` },
        });
        sent++;
      } catch (err) {
        failed++;
        console.error('Falha num envio:', err.responseCode || '', err.message);
      }
    }
    mail.close();
  }
  console.log(`Novidades: ${sent} e-mail(s) enviado(s), ${failed} falha(s).`);
  // Todas falharam: não marca (tenta de novo na próxima rodada) e o GitHub avisa por e-mail.
  if (failed && !sent) { process.exitCode = 1; return; }
  // Com alguma falha isolada marca mesmo assim, para ninguém receber o mesmo doce duas vezes.
  await rpc('news_email_mark', { p_secret: NEWS_EMAIL_SECRET, p_ids: products.map((p) => p.id) });
}

if (process.argv[1]?.endsWith('enviar-novidades.mjs')) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
