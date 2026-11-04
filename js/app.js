// Cozinha Doce — telas, rotas e interações.
import { createApi, configured } from './api.js';
import { resizePhoto, squareIcon, blobToBase64 } from './image.js';
import { pushActive, enablePush, disablePush, syncPush, isStandalone } from './push.js';
import { iconDataUrl, iconPng } from './icone.js';

// ===== Sem zoom (pinça e toque duplo) =====
['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault(), { passive: false }));
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

const $view = document.getElementById('view');
const $tabbar = document.getElementById('tabbar');
const $badge = document.getElementById('chat-badge');
let api;
let settings = {};
let categories = [];
let favIds = new Set();
let unreadCount = 0;
let stopRealtime = null;
let cleanups = [];
const chatHandlers = new Set();
let installPrompt = null;
let currentCtx = { alive: () => false, touched: false };

// ===================================================================
// Utilidades
// ===================================================================
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v) => (v == null || v === '' ? 'Sob consulta' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const catOf = (slug) => categories.find((c) => c.slug === slug);
const firstName = (n) => String(n || '').trim().split(/\s+/)[0];
const initials = (n) => (String(n || '?').trim()[0] || '?').toUpperCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const user = () => api.user;
const isAdmin = () => api.isAdmin;
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const parsePrice = (s) => {
  const t = String(s ?? '').replace(/[^\d,.]/g, '');
  if (!t) return null;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const fmtTime = (iso) => {
  const d = new Date(iso);
  const days = Math.floor((new Date(new Date().toDateString()) - new Date(d.toDateString())) / 864e5);
  if (days === 0) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (days === 1) return 'ontem';
  if (days < 7) return d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};
const fmtDay = (iso) => {
  const d = new Date(iso);
  const days = Math.floor((new Date(new Date().toDateString()) - new Date(d.toDateString())) / 864e5);
  return days === 0 ? 'Hoje' : days === 1 ? 'Ontem' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
};
const fmtPhone = (d) => {
  d = String(d || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
};
const waLink = (digits, text) => {
  let d = String(digits || '').replace(/\D/g, '');
  if (d.length <= 11) d = '55' + d;
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
};
const slugify = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
const appIcon = (big) => (big ? settings.icon_url : settings.icon_192_url || settings.icon_url) || (big ? 'icons/icon-512.png' : 'icons/icon-192.png');

const I = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2 0 3.6 1.1 5 2.9 1.4-1.8 3-2.9 5-2.9 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4.2-4.2"/></svg>',
  archive: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  whats: '<svg viewBox="0 0 24 24" style="fill:currentColor;stroke:none"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.2 14.1c-.2.6-1.3 1.2-1.8 1.3-.5 0-1 .3-3.3-.7-2.8-1.1-4.5-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .6l-.4.6-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.7-.1l1-1.2c.2-.3.4-.2.7-.1l2 1c.3.1.5.2.5.3.1.2.1.7-.1 1.3z"/></svg>',
  google: '<svg viewBox="0 0 48 48" width="20" height="20"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>',
};

// action (opcional): { label, run } vira um botão no aviso, como "Desfazer".
function toast(msg, ms = 2600, action = null) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('has-action', !!action);
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.onclick = () => { t.classList.remove('show'); action.run(); };
    t.append(' ', btn);
  }
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), action ? Math.max(ms, 6000) : ms);
}
const fail = (err) => { console.error(err); toast(err?.message || 'Algo deu errado. Tente de novo.', 4000); };

// ===================================================================
// Telas instantâneas (skill tela-instantanea): cada tela desenha na hora com o que ficou guardado
// da última vez e só redesenha se o banco trouxer algo diferente. O guardado vale só para este
// aparelho e esta conta, e é apagado ao sair. As permissões continuam nas regras do banco.
// ===================================================================
const SCREEN_PREFIX = 'cd-tela:';
const screenMem = new Map();
const screenLoading = new Map();
// Conversas (o administrador vê as de todos os clientes) e a lista de e-mails: só na memória.
const PRIVATE_SCREENS = /^(chat$|conversa:|novidades$)/;
// Iguais para todo mundo (cardápio, aparência, categorias): valem com ou sem conta.
const PUBLIC_SCREENS = /^(inicio$|ajustes$|cats$)/;
const screenKey = (name) => `${SCREEN_PREFIX}${PUBLIC_SCREENS.test(name) ? 'pub' : user()?.id || 'anon'}:${name}`;

function screenCached(name) {
  const key = screenKey(name);
  if (screenMem.has(key)) return screenMem.get(key);
  if (PRIVATE_SCREENS.test(name)) return null;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (saved) screenMem.set(key, saved);
    return saved;
  } catch {
    return null;
  }
}
function screenUpdate(name, data) {
  const key = screenKey(name);
  screenMem.set(key, data);
  if (PRIVATE_SCREENS.test(name)) return;
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
}
function screenForget(name) {
  const key = screenKey(name);
  screenMem.delete(key);
  screenLoading.delete(key);
  try { localStorage.removeItem(key); } catch {}
}
// Uma busca por vez para cada tela; o resultado fica guardado.
function screenFetch(name, fetcher) {
  const key = screenKey(name);
  if (!screenLoading.has(key)) {
    const p = fetcher()
      .then((data) => { screenUpdate(name, data); return data; })
      .finally(() => screenLoading.delete(key));
    screenLoading.set(key, p);
  }
  return screenLoading.get(key);
}
// Desenha na hora com o guardado e de novo se o banco trouxer algo diferente. Sem internet, fica
// com o guardado. `guard`: em formulários, não troca nada depois que a pessoa começou a mexer.
async function screenShow(ctx, name, fetcher, draw, { guard = false } = {}) {
  const cached = screenCached(name);
  const opened = JSON.stringify(cached);
  if (cached) draw(cached);
  let data;
  try {
    data = await screenFetch(name, fetcher);
  } catch (err) {
    if (cached) return;
    throw err;
  }
  if (!ctx.alive() || JSON.stringify(data) === opened) return;
  if (cached && (guard && ctx.touched)) return;
  const typing = document.activeElement;
  if (cached && $view.contains(typing) && /^(INPUT|TEXTAREA|SELECT)$/.test(typing.tagName)) return;
  draw(data);
}
// Apaga o guardado desta conta (ao sair).
function screenForgetUser(id) {
  for (const k of [...screenMem.keys()]) if (k.startsWith(`${SCREEN_PREFIX}${id}:`)) screenMem.delete(k);
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(`${SCREEN_PREFIX}${id}:`)) localStorage.removeItem(k);
    }
  } catch {}
}

// Quem busca o quê
const loadHome = () => api.listProducts({ limit: 300 });
const loadDrafts = () => api.listProducts({ status: 'draft' });
const loadChats = () => api.listConversations();
const homeCached = () => screenCached('inicio') || [];
// Doce conhecido de alguma lista guardada (para a página do doce abrir na hora).
const knownProduct = (id) => homeCached().find((p) => p.id === id) || (screenCached('rascunhos') || []).find((p) => p.id === id) || screenCached(`doce:${id}`);

// Depois de criar, editar, publicar ou apagar doces: confere as listas com o banco em segundo plano.
function refreshProducts(changedId) {
  if (changedId) screenForget(`doce:${changedId}`);
  screenFetch('inicio', loadHome).catch(() => {});
  if (isAdmin()) screenFetch('rascunhos', loadDrafts).catch(() => {});
}

// No Início, já busca em segundo plano as telas mais usadas.
function prefetchScreens() {
  const run = () => {
    if (!user()) return;
    screenFetch('chat', loadChats).catch(() => {});
    screenFetch('perfil', () => api.getProfile()).catch(() => {});
    if (isAdmin()) screenFetch('rascunhos', loadDrafts).catch(() => {});
  };
  ('requestIdleCallback' in window) ? requestIdleCallback(run, { timeout: 2000 }) : setTimeout(run, 800);
}

// ===================================================================
// Folhas, login
// ===================================================================
function sheet(html) {
  const root = document.getElementById('sheet-root');
  const back = document.createElement('div');
  back.className = 'sheet-backdrop';
  back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-grip"></div>${html}</div>`;
  const close = () => back.remove();
  back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) close(); });
  root.append(back);
  return { el: back.querySelector('.sheet'), close };
}
function confirmSheet(title, text, okLabel = 'Confirmar', danger = false) {
  return new Promise((resolve) => {
    const s = sheet(`<h2>${esc(title)}</h2><p class="muted">${esc(text)}</p>
      <div class="stack" style="margin-top:18px"><button class="btn block ${danger ? 'danger' : ''}" data-ok>${esc(okLabel)}</button>
      <button class="btn ghost block" data-close>Cancelar</button></div>`);
    s.el.querySelector('[data-ok]').onclick = () => { s.close(); resolve(true); };
    s.el.parentElement.addEventListener('click', (e) => { if (e.target === s.el.parentElement || e.target.closest('[data-close]')) resolve(false); });
  });
}
const googleBtn = (label = 'Entrar com o Google') => `<button class="btn btn-google block" data-login>${I.google} ${esc(label)}</button>`;
function needLogin(reason) {
  if (user()) return true;
  sheet(`<div class="center" style="font-size:52px">🍰</div><h2 class="center">Entre para continuar</h2>
    <p class="muted center">${esc(reason)}</p><div style="margin-top:18px">${googleBtn()}</div>
    ${configured ? '' : '<p class="small muted center">Modo demonstração: entra sem senha, só neste navegador.</p>'}`);
  return false;
}
const loginGate = (emoji, title, text) => `<section class="page empty" style="padding-top:60px"><div class="e">${emoji}</div><h2>${esc(title)}</h2>
  <p class="muted">${esc(text)}</p><div style="width:100%;max-width:340px;margin-top:8px">${googleBtn()}</div></section>`;
const pageHead = (title, { back = true, right = '' } = {}) => `<header class="page-head">
  ${back ? `<button class="icon-btn" data-back aria-label="Voltar">${I.back}</button>` : ''}<h1>${esc(title)}</h1>${right}</header>`;
const emptyBox = (emoji, title, text, extra = '') => `<div class="empty"><div class="e">${emoji}</div><h2>${esc(title)}</h2><p class="muted">${text}</p>${extra}</div>`;
const skeletonGrid = (n = 4) => `<div class="grid">${'<div class="skeleton" style="height:220px"></div>'.repeat(n)}</div>`;

// ===================================================================
// Aparência
// ===================================================================
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function applySettings(s) {
  settings = s;
  document.documentElement.style.setProperty('--primary', s.primary_color);
  try { localStorage.setItem('cd-cor', s.primary_color); } catch {}
  document.querySelector('meta[name="theme-color"]').content = s.primary_color;
  document.title = `${s.app_name} — ${s.tagline}`;
  document.querySelector('meta[name="apple-mobile-web-app-title"]').content = s.app_name;
  document.getElementById('favicon-link').href = appIcon(false);
  document.getElementById('apple-icon-link').href = s.icon_url || 'icons/apple-touch-icon.png?v=2';
  const m = api.manifestUrl();
  if (m) document.getElementById('manifest-link').href = m;
}
function applyTheme() {
  let t = '';
  try { t = localStorage.getItem('cd-tema') || ''; } catch {}
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

// ===================================================================
// Cartões e favoritos
// ===================================================================
const heartBtn = (id, cls = 'heart') => `<button class="${cls} ${favIds.has(id) ? 'on' : ''}" data-fav="${esc(id)}" aria-label="Favoritar">${I.heart}</button>`;
const productCard = (p) => `<a class="pcard" href="#/doce/${esc(p.id)}">
  <div class="pcard-img"><img loading="lazy" src="${esc(p.photos[0] || '')}" alt="${esc(p.title)}">
    ${p.featured ? '<span class="ribbon">⭐ Destaque</span>' : ''}${p.photos.length > 1 ? `<span class="more-photos">📷 ${p.photos.length}</span>` : ''}</div>
  ${heartBtn(p.id)}
  <div class="pcard-body"><div class="pcard-title">${esc(p.title)}</div><div class="pcard-price">${money(p.price)}</div></div></a>`;
const wideCard = (p) => `<a class="wide-card" href="#/doce/${esc(p.id)}"><img loading="lazy" src="${esc(p.photos[0] || '')}" alt="">
  <div class="grow"><div class="pcard-title">${esc(p.title)}</div><div class="pcard-price">${money(p.price)}</div>
  <div class="small muted" style="margin-top:2px;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden">${esc(p.description)}</div></div></a>`;

function paintHearts() {
  document.querySelectorAll('[data-fav]').forEach((b) => b.classList.toggle('on', favIds.has(b.dataset.fav)));
}
async function toggleFav(id) {
  if (!needLogin('Assim seus doces favoritos ficam guardados na sua conta.')) return;
  const on = !favIds.has(id);
  on ? favIds.add(id) : favIds.delete(id);
  screenUpdate('favs', [...favIds]);
  document.querySelectorAll(`[data-fav="${CSS.escape(id)}"]`).forEach((b) => {
    b.classList.toggle('on', on);
    b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
  });
  if (navigator.vibrate) navigator.vibrate(12);
  try {
    await api.setFavorite(id, on);
    toast(on ? 'Guardado nos favoritos ❤️' : 'Tirado dos favoritos');
  } catch (err) {
    on ? favIds.delete(id) : favIds.add(id);
    screenUpdate('favs', [...favIds]);
    paintHearts();
    fail(err);
  }
}

async function startChat(productId, photoUrl) {
  if (!needLogin('Para conversar sobre esta foto com a gente.')) return;
  try {
    const id = await api.startConversation(productId, photoUrl);
    location.hash = `#/chat/${id}`;
  } catch (err) { fail(err); }
}

document.addEventListener('click', async (e) => {
  const fav = e.target.closest('[data-fav]');
  if (fav) { e.preventDefault(); e.stopPropagation(); toggleFav(fav.dataset.fav); return; }
  if (e.target.closest('[data-login]')) {
    e.preventDefault();
    try {
      await api.signIn();
      document.querySelectorAll('.sheet-backdrop').forEach((b) => b.remove());
    } catch (err) { fail(err); }
    return;
  }
  if (e.target.closest('[data-back]')) {
    e.preventDefault();
    if (sessionStorage.getItem('cd-nav')) history.back(); // veio de outra tela do app
    else location.hash = '#/';
  }
});
// O dedo encostou num doce: já começa a baixar as fotos dele (o toque só vira clique ao soltar).
document.addEventListener('pointerdown', (e) => {
  const a = e.target.closest('a[href^="#/doce/"]');
  const p = a && knownProduct(a.getAttribute('href').slice(7));
  p?.photos?.slice(0, 2).forEach((u) => { new Image().src = u; });
}, { passive: true });
// Formulários: a pessoa começou a mexer nesta tela (screenShow com guard não troca mais nada).
document.addEventListener('input', () => { currentCtx.touched = true; }, true);

// ===================================================================
// Início
// ===================================================================
// O Início pronto fica guardado (fora da tela) enquanto a pessoa vê um doce: ao voltar, ele é
// recolocado como estava, sem desenhar os ~100 cartões de novo.
let homeDom = null;
const homeSig = () => [user()?.id, isAdmin(), settings.updated_at, settings.app_name, settings.tagline, settings.icon_url, JSON.stringify(categories)].join('|');

async function viewHome(ctx) {
  const cached = screenCached('inicio');
  const json = cached && JSON.stringify(cached);
  if (homeDom && cached && homeDom.json === json && homeDom.sig === homeSig()) {
    $view.replaceChildren(homeDom.node);
    paintHearts();
    startHero();
    const fresh = await screenFetch('inicio', loadHome).catch(() => null);
    if (fresh && ctx.alive() && JSON.stringify(fresh) !== json) drawHome(fresh);
  } else {
    await screenShow(ctx, 'inicio', loadHome, drawHome);
  }
  prefetchScreens();
}

let stopHero = null;
const FIRST_CARDS = 12;
function drawHome(all) {
  stopHero?.();
  let featured = all.filter((p) => p.featured);
  if (featured.length < 2) featured = [...featured, ...all.filter((p) => !p.featured)].slice(0, 5);
  const used = categories.filter((c) => all.some((p) => p.category === c.slug));
  const rows = used.map((c) => [c, all.filter((p) => p.category === c.slug)]).filter(([, l]) => l.length >= 2).slice(0, 3);
  const u = user();

  $view.innerHTML = `<div class="page">
    <header class="home-head">
      <div class="brand"><img class="brand-logo" src="${esc(appIcon(false))}" alt="">
        <div style="min-width:0"><div class="brand-name">${esc(settings.app_name)}</div><div class="brand-tag">${esc(settings.tagline)}</div></div></div>
      <a href="#/menu" aria-label="Menu">${u?.avatar ? `<img class="avatar" src="${esc(u.avatar)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar">${u ? initials(u.name) : '👤'}</span>`}</a>
    </header>
    ${configured ? '' : '<div class="demo-banner">🧪 <b>Modo demonstração.</b> Os dados ficam só neste navegador. Configure o Supabase para publicar de verdade (veja o README).</div>'}
    <div class="greet"><h1>Olá${u ? `, ${esc(firstName(u.name))}` : ''}! 👋<br>O que vai <em>adoçar</em> seu dia?</h1></div>
    <a class="search-pill" href="#/buscar?foco=1">${I.search}<span>Buscar macaron, brownie, suspiro…</span></a>

    ${all.length ? `
    <section class="hero" aria-label="Destaques">
      <div class="hero-track" id="hero">${featured.map((p, i) => `
        <a class="hero-card ${i === 0 ? 'is-active' : ''}" href="#/doce/${esc(p.id)}" data-i="${i}">
          <img src="${esc(p.photos[0])}" alt="" ${i ? 'loading="lazy"' : ''}>
          <div class="hero-info"><span class="kicker">${p.featured ? '⭐ Destaque' : '✨ Novidade'}</span><h2>${esc(p.title)}</h2>
          <div class="row"><b style="font-size:20px">${money(p.price)}</b><span class="hero-cta">Ver doce →</span></div></div>
        </a>`).join('')}</div>
      <div class="dots" id="hero-dots">${featured.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('')}</div>
    </section>

    <div class="stories" aria-label="Categorias">${used.map((c) => `
      <a class="story" href="#/buscar?cat=${esc(c.slug)}"><span class="story-ring"><span>${esc(c.emoji)}</span></span>${esc(c.name)}</a>`).join('')}</div>

    <section class="section"><div class="section-title"><h2>Fresquinhos ✨</h2><a href="#/buscar">Ver tudo</a></div>
      <div class="hscroll">${all.slice(0, 10).map(productCard).join('')}</div></section>

    ${!isAdmin() ? `<section class="pad section"><a class="chat-photo-cta" href="#/adicionar" style="margin:0">
      <span style="font-size:38px">💌</span><div class="grow"><b>Quer algo especial?</b><div class="small muted">Mande a foto de uma inspiração e a gente faz sob encomenda.</div></div><span class="chev">›</span></a></section>` : ''}

    ${rows.map(([c, list]) => `<section class="section"><div class="section-title"><h2>${esc(c.emoji)} ${esc(c.name)}</h2><a href="#/buscar?cat=${esc(c.slug)}">Ver todos</a></div>
      <div class="hscroll">${list.slice(0, 8).map(wideCard).join('')}</div></section>`).join('')}

    <section class="section"><div class="section-title"><h2>Todos os doces</h2><span class="small muted">${all.length} ${all.length === 1 ? 'opção' : 'opções'}</span></div>
      <div class="grid" id="all-grid"></div></section>`
    : emptyBox('🧁', 'O cardápio está saindo do forno', isAdmin() ? 'Adicione as fotos dos seus doces e a IA ajuda a preencher tudo.' : 'Volte em breve para ver as delícias.',
      isAdmin() ? '<a class="btn" href="#/adicionar">Adicionar doces</a>' : '')}
  </div>`;

  homeDom = { json: JSON.stringify(all), sig: homeSig(), node: $view.firstElementChild };
  const grid = document.getElementById('all-grid');
  if (grid) fillGrid(grid, all);
  startHero();
}

// Carrossel: marca o cartão do meio e passa sozinho a cada 4,5 s (para quando a pessoa toca).
function startHero() {
  stopHero?.();
  const track = document.getElementById('hero');
  if (!track) return;
  const cards = [...track.children];
  const dots = [...document.getElementById('hero-dots').children];
  let current = 0;
  const io = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (en.isIntersecting && en.intersectionRatio > 0.6) {
      current = Number(en.target.dataset.i);
      cards.forEach((c, i) => c.classList.toggle('is-active', i === current));
      dots.forEach((d, i) => d.classList.toggle('on', i === current));
    }
  }), { root: track, threshold: [0.6] });
  cards.forEach((c) => io.observe(c));
  let paused = false;
  const pause = () => { paused = true; clearTimeout(pause.t); pause.t = setTimeout(() => (paused = false), 8000); };
  track.addEventListener('touchstart', pause, { passive: true });
  track.addEventListener('pointerdown', pause);
  const timer = setInterval(() => {
    if (paused || document.hidden || cards.length < 2) return;
    const next = cards[(current + 1) % cards.length];
    track.scrollTo({ left: next.offsetLeft - (track.clientWidth - next.clientWidth) / 2, behavior: 'smooth' });
  }, 4500);
  const off = () => { track.removeEventListener('touchstart', pause); track.removeEventListener('pointerdown', pause); };
  stopHero = () => { clearInterval(timer); io.disconnect(); off(); stopHero = null; };
  cleanups.push(() => stopHero?.());
}

// ===================================================================
// Buscar (procura no cardápio guardado: abre e filtra na hora, sem esperar o banco)
// ===================================================================
// Grade de cartões: os primeiros na hora, o resto em lotes logo em seguida (sem travar o toque).
function fillGrid(grid, list, first = FIRST_CARDS) {
  grid.innerHTML = list.slice(0, first).map(productCard).join('');
  const rest = list.slice(first);
  const token = (grid._token = {});
  const more = () => {
    if (grid._token !== token || !rest.length) return;
    grid.insertAdjacentHTML('beforeend', rest.splice(0, 24).map(productCard).join(''));
    if (rest.length) (window.requestIdleCallback || setTimeout)(more, { timeout: 300 });
  };
  if (rest.length) (window.requestIdleCallback || setTimeout)(more, { timeout: 300 });
}

function filterProducts(list, { q, cat, sort }) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  let out = list.filter((p) => (!cat || p.category === cat) && words.every((w) => norm(`${p.title} ${p.description}`).includes(w)));
  if (sort === 'price_asc') out = [...out].sort((a, b) => (a.price ?? 1e9) - (b.price ?? 1e9));
  else if (sort === 'price_desc') out = [...out].sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
  return out;
}

async function viewSearch(ctx, _, query) {
  const f = { q: query.get('q') || '', cat: query.get('cat') || '', sort: query.get('ordem') || 'recent' };
  $view.innerHTML = `<div class="page">
    <header class="page-head" style="flex-direction:column;align-items:stretch;gap:10px">
      <h1>Buscar</h1>
      <label class="search-pill" style="margin:0">${I.search}<input id="q" class="grow" style="border:0;outline:0;background:none" type="search" enterkeyhint="search" placeholder="Macaron, brownie, suspiro…" value="${esc(f.q)}" autocomplete="off"></label>
    </header>
    <div class="chips" id="cats">
      <button class="chip ${f.cat ? '' : 'on'}" data-cat="">🍭 Todos</button>
      ${categories.map((c) => `<button class="chip ${c.slug === f.cat ? 'on' : ''}" data-cat="${esc(c.slug)}">${esc(c.emoji)} ${esc(c.name)}</button>`).join('')}
    </div>
    <div class="row between pad" style="margin:6px 0 12px">
      <span class="small muted" id="count"></span>
      <select id="sort" class="input" style="width:auto;padding:8px 12px;font-size:14px;font-weight:700">
        <option value="recent">Mais novos</option><option value="price_asc">Menor preço</option><option value="price_desc">Maior preço</option>
      </select>
    </div>
    <div id="results">${skeletonGrid()}</div>
  </div>`;
  const $q = document.getElementById('q');
  const $results = document.getElementById('results');
  document.getElementById('sort').value = f.sort;
  if (query.get('foco')) setTimeout(() => $q.focus(), 50);
  document.querySelector('#cats .chip.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });

  let all = homeCached();
  const draw = () => {
    if (!ctx.alive()) return;
    const params = new URLSearchParams();
    if (f.q) params.set('q', f.q);
    if (f.cat) params.set('cat', f.cat);
    if (f.sort !== 'recent') params.set('ordem', f.sort);
    history.replaceState(null, '', `#/buscar${params.size ? '?' + params : ''}`);
    const list = filterProducts(all, f);
    document.getElementById('count').textContent = `${list.length} ${list.length === 1 ? 'doce encontrado' : 'doces encontrados'}`;
    if (list.length) { $results.innerHTML = '<div class="grid"></div>'; fillGrid($results.firstElementChild, list); return; }
    $results.innerHTML = emptyBox('🔍', 'Nada por aqui', f.q ? `Não achamos "${esc(f.q)}". Que tal pedir sob encomenda?` : 'Ainda não há doces nesta categoria.',
        '<a class="btn soft" href="#/adicionar">💌 Pedir sob encomenda</a>');
  };
  let t;
  $q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { f.q = $q.value.trim(); draw(); }, 120); });
  document.getElementById('cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    f.cat = b.dataset.cat;
    document.querySelectorAll('#cats .chip').forEach((c) => c.classList.toggle('on', c === b));
    b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    draw();
  });
  document.getElementById('sort').addEventListener('change', (e) => { f.sort = e.target.value; draw(); });
  if (all.length) draw();
  // Confere o cardápio com o banco; só redesenha a lista se mudou.
  const fresh = await screenFetch('inicio', loadHome).catch((err) => { if (!all.length) throw err; return all; });
  if (!sameJson(fresh, all) || !all.length) { all = fresh; draw(); }
}

// ===================================================================
// Página do doce
// ===================================================================
async function viewProduct(ctx, [id]) {
  // Abre na hora com o doce que já veio no cardápio (ou nos rascunhos) e confere com o banco.
  if (!screenCached(`doce:${id}`)) {
    const known = knownProduct(id);
    if (known) screenUpdate(`doce:${id}`, known);
  }
  await screenShow(ctx, `doce:${id}`, () => api.getProduct(id), (p) => drawProduct(ctx, id, p));
  // Relacionados: do cardápio guardado (o banco já foi conferido acima ou em segundo plano).
  screenFetch('inicio', loadHome).then(() => ctx.alive() && drawRelated(id)).catch(() => {});
}

function drawRelated(id) {
  const p = screenCached(`doce:${id}`);
  const box = document.getElementById('related');
  if (!p || !box || !p.category) return;
  const rel = homeCached().filter((x) => x.category === p.category && x.id !== p.id).slice(0, 12);
  box.innerHTML = rel.length ? `<div class="section-title"><h2>Você também vai amar 💕</h2></div><div class="hscroll">${rel.map(productCard).join('')}</div>` : '';
}

function drawProduct(ctx, id, p) {
  if (!p || (p.status !== 'published' && !isAdmin())) {
    $view.innerHTML = pageHead('Doce') + emptyBox('🥲', 'Este doce saiu do cardápio', 'Mas tem muita coisa gostosa esperando por você.', '<a class="btn" href="#/">Ver o cardápio</a>');
    return;
  }
  const cat = catOf(p.category);
  // Link de compartilhamento: a página d/<id>/ tem a foto nas tags que o WhatsApp lê (scripts/build-site.mjs).
  const link = `${location.origin}${location.pathname.replace(/index.html$/, '')}d/${p.id}/`;
  // A foto já vai sendo preparada para o Compartilhar enviar junto (o iPhone exige que o
  // compartilhamento saia logo após o toque, sem esperar download).
  let shareFile = null;
  if (p.photos[0] && navigator.canShare) {
    fetch(p.photos[0]).then((r) => r.blob()).then((b) => {
      const f = new File([b], `${slugify(p.title) || 'doce'}.${/png/.test(b.type) ? 'png' : 'jpg'}`, { type: b.type || 'image/jpeg' });
      if (navigator.canShare({ files: [f] })) shareFile = f;
    }).catch(() => {});
  }
  $view.innerHTML = `<div class="page">
    <div class="gallery">
      <div class="gallery-top">
        <button class="icon-btn glass" data-back aria-label="Voltar">${I.back}</button>
        <div class="row"><button class="icon-btn glass" id="share" aria-label="Compartilhar">${I.share}</button>${heartBtn(p.id, 'heart')}</div>
      </div>
      <div class="gallery-track" id="gal">${p.photos.map((u, i) => `<img src="${esc(u)}" alt="${esc(p.title)} — foto ${i + 1}" ${i ? 'loading="lazy"' : ''}>`).join('')}</div>
      ${p.photos.length > 1 ? `<span class="gallery-count" id="gal-count">1/${p.photos.length}</span>` : ''}
    </div>
    <article class="detail">
      ${p.status !== 'published' ? '<p class="demo-banner" style="margin:0 0 12px">📝 Rascunho — só você está vendo.</p>' : ''}
      ${cat ? `<a class="cat" href="#/buscar?cat=${esc(cat.slug)}">${esc(cat.emoji)} ${esc(cat.name)}</a>` : ''}
      <h1>${esc(p.title)}</h1>
      <div class="price-tag">${money(p.price)}</div>
      ${p.photos.length > 1 ? `<div class="thumbs" id="thumbs">${p.photos.map((u, i) => `<button class="${i ? '' : 'on'}" data-i="${i}" aria-label="Foto ${i + 1}"><img src="${esc(u)}" alt=""></button>`).join('')}</div>` : ''}
      <p class="desc">${esc(p.description)}</p>

      <button class="chat-photo-cta" id="chat-photo" style="width:100%;text-align:left">
        <img id="chat-thumb" src="${esc(p.photos[0] || '')}" alt="">
        <div class="grow"><b>Conversar sobre esta foto</b><div class="small muted">Tire dúvidas, combine sabores, tamanho e entrega.</div></div>
        <span class="icon-btn" style="background:var(--primary);color:var(--on-primary);border:0">${I.chat}</span>
      </button>
      ${settings.whatsapp ? `<a class="btn whats block" target="_blank" rel="noopener" href="${esc(waLink(settings.whatsapp, `Olá! Tenho interesse em: ${p.title} (${money(p.price)})\n${link}`))}">${I.whats} Pedir pelo WhatsApp</a>` : ''}

      ${isAdmin() ? `<div class="admin-bar">
        <a class="btn sm soft" href="#/editar/${esc(p.id)}">${I.edit} Editar</a>
        <button class="btn sm ghost" id="feat">${p.featured ? '⭐ Tirar destaque' : '☆ Destacar'}</button>
        ${p.status === 'published' ? '<button class="btn sm ghost" id="unpub">🙈 Despublicar</button>' : ''}
      </div>` : ''}
    </article>
    <section class="section" id="related"></section>
  </div>`;
  drawRelated(id);

  const gal = document.getElementById('gal');
  let idx = 0;
  const setIdx = (i) => {
    idx = i;
    document.getElementById('chat-thumb').src = p.photos[i];
    const c = document.getElementById('gal-count');
    if (c) c.textContent = `${i + 1}/${p.photos.length}`;
    document.querySelectorAll('#thumbs button').forEach((b, j) => b.classList.toggle('on', j === i));
  };
  gal.addEventListener('scroll', () => {
    const i = Math.round(gal.scrollLeft / gal.clientWidth);
    if (i !== idx && p.photos[i]) setIdx(i);
  }, { passive: true });
  document.getElementById('thumbs')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (b) gal.scrollTo({ left: gal.clientWidth * Number(b.dataset.i), behavior: 'smooth' });
  });
  document.getElementById('chat-photo').onclick = () => startChat(p.id, p.photos[idx]);
  // Compartilhar: a foto vai junto, com nome, preço e link na legenda. Sem suporte a foto, vai o
  // link (que mostra a foto na prévia); no computador, copia o link.
  document.getElementById('share').onclick = async () => {
    const text = `${p.title} — ${money(p.price)}`;
    try {
      if (shareFile) await navigator.share({ files: [shareFile], title: p.title, text: `${text}
${link}` });
      else if (navigator.share) await navigator.share({ title: p.title, text, url: link });
      else { await navigator.clipboard.writeText(link); toast('Link copiado 🔗'); }
    } catch (err) {
      if (err?.name === 'AbortError') return; // a pessoa desistiu
      try { await navigator.share({ title: p.title, text, url: link }); } catch { await navigator.clipboard?.writeText(link).then(() => toast('Link copiado 🔗')).catch(() => {}); }
    }
  };
  document.getElementById('feat')?.addEventListener('click', async () => {
    try {
      const saved = await api.saveProduct({ id: p.id, featured: !p.featured });
      screenUpdate(`doce:${p.id}`, saved);
      toast(p.featured ? 'Saiu dos destaques' : 'Agora está nos destaques ⭐');
      refreshProducts();
      drawProduct(ctx, id, saved);
    } catch (err) { fail(err); }
  });
  document.getElementById('unpub')?.addEventListener('click', async () => {
    if (!(await confirmSheet('Despublicar este doce?', 'Ele sai do cardápio e volta para os rascunhos. Você pode publicar de novo quando quiser.', 'Despublicar'))) return;
    try {
      await api.saveProduct({ id: p.id, status: 'draft' });
      screenUpdate('inicio', homeCached().filter((x) => x.id !== p.id));
      screenForget('rascunhos');
      refreshProducts(p.id);
      toast('Voltou para os rascunhos');
      location.hash = '#/revisar';
    } catch (err) { fail(err); }
  });
}

// ===================================================================
// Adicionar
// ===================================================================
async function viewAdd() {
  if (!user()) { $view.innerHTML = loginGate('💌', 'Peça sob encomenda', 'Entre com o Google para mandar a foto de uma inspiração e conversar com a gente.'); return; }
  if (!isAdmin()) return viewCustomOrder();

  let mode = 'cada';
  let useAI = api.aiAvailable;
  $view.innerHTML = `<div class="page">
    ${pageHead('Adicionar doces', { back: false })}
    <div class="pad stack">
      <div id="drafts-banner"></div>
      <label class="drop" id="drop">
        <span class="big">📸</span>
        <b>Escolha várias fotos de uma vez</b>
        <span class="muted small">Toque para abrir a galeria ou arraste as fotos aqui.<br>${useAI ? 'A IA do Google já preenche título, valor, descrição e categoria.' : 'Depois você preenche os dados de cada doce.'}</span>
        <input type="file" id="files" accept="image/*" multiple hidden>
      </label>

      <div class="card stack">
        <div class="field"><span>Como separar as fotos?</span>
          <div class="segmented" id="mode"><button class="on" data-m="cada">1 foto = 1 doce</button><button data-m="junto">Todas = 1 doce</button></div></div>
        <div class="switch-row" style="padding:0">
          <div class="grow"><b>✨ Preencher com a IA do Google</b><div class="small muted">${api.aiAvailable ? 'Você revisa tudo antes de publicar.' : 'Disponível com o Supabase configurado.'}</div></div>
          <label class="switch"><input type="checkbox" id="ai" ${useAI ? 'checked' : ''} ${api.aiAvailable ? '' : 'disabled'}><i></i></label>
        </div>
      </div>

      <div class="progress-list" id="progress"></div>
      <div id="done"></div>
      <button class="btn ghost block" id="manual">✍️ Criar um doce preenchendo à mão</button>
    </div>
  </div>`;

  // Aviso dos rascunhos: na hora com o guardado, conferido com o banco em seguida.
  const banner = (drafts) => {
    const el = document.getElementById('drafts-banner');
    if (el) el.innerHTML = drafts?.length ? `<a class="chat-photo-cta" href="#/revisar" style="margin:0"><span style="font-size:32px">📝</span>
      <div class="grow"><b>${drafts.length} ${drafts.length === 1 ? 'rascunho esperando' : 'rascunhos esperando'} revisão</b><div class="small muted">Confira e publique</div></div><span>›</span></a>` : '';
  };
  banner(screenCached('rascunhos'));
  screenFetch('rascunhos', loadDrafts).then(banner).catch(() => {});

  const $files = document.getElementById('files');
  const $drop = document.getElementById('drop');
  document.getElementById('mode').onclick = (e) => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    mode = b.dataset.m;
    document.querySelectorAll('#mode button').forEach((x) => x.classList.toggle('on', x === b));
  };
  document.getElementById('ai').onchange = (e) => (useAI = e.target.checked);
  document.getElementById('manual').onclick = async () => {
    try { await api.saveProduct({ status: 'draft' }); screenForget('rascunhos'); location.hash = '#/revisar'; } catch (err) { fail(err); }
  };
  $files.onchange = () => { if ($files.files.length) processBatch([...$files.files], mode, useAI); $files.value = ''; };
  ['dragenter', 'dragover'].forEach((t) => $drop.addEventListener(t, (e) => { e.preventDefault(); $drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => $drop.addEventListener(t, () => $drop.classList.remove('over')));
  $drop.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/') || /\.hei[cf]$/i.test(f.name));
    if (files.length) processBatch(files, mode, useAI);
  });
}

const catMap = () => Object.fromEntries(categories.map((c) => [c.slug, c.name]));
async function aiFor(blobOrFile) {
  const small = await resizePhoto(blobOrFile, 768, 0.8);
  return api.aiFill(await blobToBase64(small), catMap());
}
const aiPatch = (r) => {
  const patch = { ai_fields: [] };
  if (r.title) { patch.title = r.title; patch.ai_fields.push('title'); }
  if (r.description) { patch.description = r.description; patch.ai_fields.push('description'); }
  if (r.category) { patch.category = r.category; patch.ai_fields.push('category'); }
  if (r.price != null) { patch.price = r.price; patch.ai_fields.push('price'); }
  return patch;
};

// Envia as fotos em lote: reduz, sobe, cria os rascunhos e pede à IA o primeiro preenchimento.
async function processBatch(files, mode, useAI) {
  const $p = document.getElementById('progress');
  const $done = document.getElementById('done');
  $done.innerHTML = '';
  if (files.length > 40) { toast('Escolha até 40 fotos por vez.'); files = files.slice(0, 40); }
  const items = files.map((f, i) => {
    const el = document.createElement('div');
    el.className = 'progress-item';
    el.innerHTML = `<img src="${URL.createObjectURL(f)}" alt=""><div class="grow"><div class="small"><b>Foto ${i + 1}</b> · <span data-s>na fila…</span></div><div class="bar"><i></i></div></div><span class="spin" hidden></span>`;
    $p.append(el);
    const set = (txt, pct, busy = true) => {
      el.querySelector('[data-s]').textContent = txt;
      el.querySelector('.bar i').style.width = pct + '%';
      el.querySelector('.spin').hidden = !busy;
    };
    return { file: f, set, url: null };
  });
  window.scrollTo({ top: $p.offsetTop - 80, behavior: 'smooth' });

  let created = 0;
  let aiErrors = 0;
  const work = async (it) => {
    try {
      it.set('preparando…', 15);
      const blob = await resizePhoto(it.file);
      it.set('enviando…', 40);
      it.url = await api.uploadPhoto(blob, 'produtos');
      if (mode === 'junto') { it.set('enviada ✓', 100, false); return; }
      let draft = await api.saveProduct({ status: 'draft', photos: [it.url] });
      created++;
      if (useAI) {
        it.set('✨ a IA está olhando o doce…', 70);
        try { draft = await api.saveProduct({ id: draft.id, ...aiPatch(await aiFor(blob)) }); } catch (err) { aiErrors++; console.warn(err); it.set(`sem IA: ${err.message}`, 90); await sleep(600); }
      }
      it.set(draft.title ? `pronto: ${draft.title}` : 'pronto para revisar', 100, false);
    } catch (err) {
      it.set(`erro: ${err.message}`, 100, false);
    }
  };
  const queue = [...items];
  await Promise.all([0, 1].map(async () => { while (queue.length) await work(queue.shift()); }));

  if (mode === 'junto') {
    const urls = items.map((i) => i.url).filter(Boolean);
    if (urls.length) {
      let draft = await api.saveProduct({ status: 'draft', photos: urls });
      created = 1;
      if (useAI) {
        items[0].set('✨ a IA está olhando o doce…', 90);
        try { draft = await api.saveProduct({ id: draft.id, ...aiPatch(await aiFor(items[0].file)) }); } catch (err) { aiErrors++; toast(`IA: ${err.message}`); }
        items[0].set(draft.title ? `pronto: ${draft.title}` : 'pronto para revisar', 100, false);
      }
    }
  }
  if (!created) return;
  // Os rascunhos novos já ficam guardados: a revisão abre na hora.
  await screenFetch('rascunhos', loadDrafts).catch(() => {});
  if (aiErrors) toast(`A IA não preencheu ${aiErrors} ${aiErrors === 1 ? 'foto' : 'fotos'}: complete à mão na revisão.`, 4500);
  $done.innerHTML = `<a class="btn block" href="#/revisar">Revisar e publicar (${created}) →</a>`;
  confetti();
}

// Cliente: encomenda personalizada a partir de uma foto de inspiração.
function viewCustomOrder() {
  let file = null;
  $view.innerHTML = `<div class="page">
    ${pageHead('Encomenda especial', { back: false })}
    <div class="pad stack">
      <p class="muted" style="margin:0">Viu um doce lindo por aí ou tem uma ideia para a sua festa? Mande a foto e conte o que precisa. A conversa fica ligada a essa foto. 💕</p>
      <label class="drop" id="drop"><span class="big" id="ins-emoji">🖼️</span><img id="ins-prev" hidden style="max-height:240px;border-radius:18px">
        <b>Escolher foto de inspiração</b><span class="small muted">Da galeria ou da câmera</span>
        <input type="file" id="ins" accept="image/*" hidden></label>
      <label class="field"><span>O que você precisa?</span>
        <textarea class="input" id="ins-text" rows="4" maxlength="1500" placeholder="Ex.: 60 macarons para casamento, tons de rosa e dourado, para o dia 20."></textarea></label>
      <button class="btn block" id="ins-send" disabled>💬 Enviar e conversar</button>
    </div>
  </div>`;
  const $send = document.getElementById('ins-send');
  const $text = document.getElementById('ins-text');
  const check = () => ($send.disabled = !file || !$text.value.trim());
  document.getElementById('ins').onchange = (e) => {
    file = e.target.files[0] || null;
    const prev = document.getElementById('ins-prev');
    if (file) { prev.src = URL.createObjectURL(file); prev.hidden = false; document.getElementById('ins-emoji').hidden = true; }
    check();
  };
  $text.oninput = check;
  $send.onclick = async () => {
    $send.disabled = true;
    $send.innerHTML = '<span class="spin"></span> Enviando…';
    try {
      const url = await api.uploadPhoto(await resizePhoto(file), 'encomendas');
      const id = await api.startConversation(null, url);
      await api.sendMessage(id, $text.value.trim());
      location.hash = `#/chat/${id}`;
    } catch (err) { fail(err); check(); $send.textContent = '💬 Enviar e conversar'; }
  };
}

// ===================================================================
// Revisar rascunhos / editar doce
// ===================================================================
async function viewReview(ctx) {
  if (!isAdmin()) { location.hash = '#/adicionar'; return; }
  await screenShow(ctx, 'rascunhos', loadDrafts, (drafts) => drawReview(drafts), { guard: true });
}

function drawReview(drafts) {
  $view.innerHTML = `<div class="page">
    ${pageHead('Revisar antes de publicar', { right: drafts.length ? `<span class="count chip on" style="padding:6px 12px">${drafts.length}</span>` : '' })}
    ${drafts.length ? `<p class="pad muted small" style="margin:0 0 12px">Os campos com <span class="ai-badge">✨ IA</span> foram sugeridos pela inteligência artificial — confira antes de publicar. Tudo é salvo sozinho.</p>
      <div class="pad stack" id="editor">${drafts.map((p, i) => editorCard(p, 'draft', i)).join('')}</div>
      <div class="sticky-bottom"><button class="btn block" id="pub-all">🚀 Publicar todos os prontos</button></div>`
    : emptyBox('🎉', 'Nada para revisar', 'Todos os doces já estão publicados.', '<a class="btn" href="#/adicionar">Adicionar mais doces</a>')}
  </div>`;
  if (!drafts.length) return;
  const ed = mountEditor(document.getElementById('editor'), drafts, 'draft');
  document.getElementById('pub-all').onclick = async () => {
    await ed.flush();
    const ready = [...ed.model.values()].filter(isComplete);
    if (!ready.length) { toast('Nenhum doce está completo ainda (título, valor e foto).'); return; }
    if (!(await confirmSheet(`Publicar ${ready.length} ${ready.length === 1 ? 'doce' : 'doces'}?`, 'Eles aparecem no cardápio na hora. Os incompletos continuam nos rascunhos.', 'Publicar'))) return;
    let n = 0;
    for (const p of ready) { try { await api.saveProduct({ id: p.id, status: 'published' }); ed.model.delete(p.id); n++; } catch (err) { fail(err); } }
    screenUpdate('rascunhos', [...ed.model.values()]);
    refreshProducts();
    toast(`${n} ${n === 1 ? 'doce publicado' : 'doces publicados'} 🎉`);
    confetti();
    drawReview([...ed.model.values()]);
  };
}

async function viewEdit(ctx, [id]) {
  if (!isAdmin()) { location.hash = '#/'; return; }
  if (!screenCached(`doce:${id}`)) {
    const known = knownProduct(id);
    if (known) screenUpdate(`doce:${id}`, known);
  }
  await screenShow(ctx, `doce:${id}`, () => api.getProduct(id), (p) => {
    if (!p) { $view.innerHTML = pageHead('Editar') + emptyBox('🤷', 'Doce não encontrado', ''); return; }
    const mode = p.status === 'draft' ? 'draft' : 'edit';
    $view.innerHTML = `<div class="page">${pageHead('Editar doce')}<div class="pad stack" id="editor">${editorCard(p, mode, 0)}</div></div>`;
    mountEditor(document.getElementById('editor'), [p], mode);
  }, { guard: true });
}

const isComplete = (p) => p.title?.trim() && p.price != null && p.photos?.length;

function editorCard(p, mode, index) {
  const ai = new Set(p.ai_fields || []);
  const tag = (f) => (ai.has(f) ? '<em class="ai-badge" data-ai-tag>✨ IA</em>' : '');
  const cls = (f, missing) => `input${ai.has(f) ? ' ai' : ''}${missing ? ' missing' : ''}`;
  return `<article class="draft" data-id="${esc(p.id)}">
    <div class="draft-photos">
      ${p.photos.map((u, i) => `<div class="draft-photo"><img src="${esc(u)}" alt="">
        ${i === 0 ? '<span class="first">Capa</span>' : `<button class="mv" data-act="cover" data-i="${i}" title="Usar como capa" aria-label="Usar como capa">★</button>`}
        <button class="x" data-act="rmphoto" data-i="${i}" aria-label="Tirar foto">✕</button></div>`).join('')}
      <label class="add-photo">＋<br>Foto<input type="file" accept="image/*" multiple hidden data-act="addphoto"></label>
    </div>
    <div class="draft-body">
      <label class="field"><span>Título ${tag('title')}</span>
        <input class="${cls('title', !p.title?.trim())}" data-f="title" value="${esc(p.title)}" maxlength="120" placeholder="Ex.: Macaron de pistache"></label>
      <div class="grid-2">
        <label class="field"><span>Valor ${tag('price')}</span><div class="money">
          <input class="${cls('price', p.price == null)}" data-f="price" inputmode="decimal" value="${p.price == null ? '' : Number(p.price).toFixed(2).replace('.', ',')}" placeholder="0,00"></div></label>
        <label class="field"><span>Categoria ${tag('category')}</span>
          <select class="${cls('category')}" data-f="category"><option value="">Escolha…</option>
          ${categories.map((c) => `<option value="${esc(c.slug)}" ${c.slug === p.category ? 'selected' : ''}>${esc(c.emoji)} ${esc(c.name)}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>Descrição ${tag('description')}</span>
        <textarea class="${cls('description')}" data-f="description" maxlength="2000" rows="3" placeholder="Conte do que é feito, tamanho, quantidade mínima…">${esc(p.description)}</textarea></label>
      <div class="switch-row" style="padding:0"><div class="grow"><b>⭐ Destaque</b><div class="small muted">Aparece no carrossel do início</div></div>
        <label class="switch"><input type="checkbox" data-f="featured" ${p.featured ? 'checked' : ''}><i></i></label></div>
      <div class="small muted" data-status>${mode === 'draft' ? 'Rascunho salvo' : ''}</div>
    </div>
    <div class="draft-actions">
      ${mode === 'draft' ? `
        <button class="btn sm" data-act="publish">🚀 Publicar</button>
        ${api.aiAvailable ? '<button class="btn sm soft" data-act="ai">✨ Refazer com IA</button>' : ''}
        ${index > 0 ? '<button class="btn sm ghost" data-act="merge" title="Junta as fotos deste card no doce de cima">⤴ Juntar ao de cima</button>' : ''}
        <button class="btn sm danger" data-act="delete">🗑 Excluir</button>`
      : `
        <button class="btn sm" data-act="save">💾 Salvar alterações</button>
        <button class="btn sm ghost" data-act="unpublish">🙈 Despublicar</button>
        <button class="btn sm danger" data-act="delete">🗑 Excluir</button>`}
    </div>
  </article>`;
}

function mountEditor(root, list, mode) {
  const model = new Map(list.map((p) => [p.id, { ...p, ai_fields: [...(p.ai_fields || [])], photos: [...p.photos] }]));
  const timers = new Map();
  const cardOf = (id) => root.querySelector(`.draft[data-id="${CSS.escape(id)}"]`);
  const status = (id, t) => { const s = cardOf(id)?.querySelector('[data-status]'); if (s) s.textContent = t; };
  const payload = (p) => ({ id: p.id, title: p.title, price: p.price, description: p.description, category: p.category || null, featured: p.featured, photos: p.photos, ai_fields: p.ai_fields });
  // Guarda o que já está salvo, para a próxima abertura mostrar a versão nova na hora.
  const removed = new Set();
  const remember = () => {
    model.forEach((p) => screenUpdate(`doce:${p.id}`, p));
    if (mode !== 'draft') return;
    // Junta com a lista guardada (a edição de um rascunho só mexe nele).
    const cur = (screenCached('rascunhos') || []).filter((x) => !removed.has(x.id)).map((x) => model.get(x.id) || x);
    model.forEach((p) => { if (!cur.some((x) => x.id === p.id)) cur.push(p); });
    screenUpdate('rascunhos', cur);
  };
  const save = async (id) => {
    clearTimeout(timers.get(id)); timers.delete(id);
    const p = model.get(id);
    if (!p) return;
    status(id, 'Salvando…');
    try { await api.saveProduct(payload(p)); status(id, 'Salvo ✓'); remember(); } catch (err) { status(id, 'Não salvou'); fail(err); }
  };
  const schedule = (id) => {
    if (mode !== 'draft') { status(id, 'Alterações não salvas'); return; }
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => save(id), 700));
    status(id, 'Editando…');
  };
  const flush = () => Promise.all([...timers.keys()].map(save));
  const redrawCard = (id) => {
    const c = cardOf(id);
    const i = [...root.children].indexOf(c);
    c.outerHTML = editorCard(model.get(id), mode, i);
  };
  const removeCard = (id) => {
    const c = cardOf(id);
    model.delete(id);
    removed.add(id);
    screenForget(`doce:${id}`);
    remember();
    c.style.transition = 'all .35s'; c.style.opacity = '0'; c.style.transform = 'scale(.95)';
    setTimeout(() => {
      c.remove();
      if (!root.children.length) drawReview([]);
      else [...root.children].forEach((el, i) => { if (i === 0) el.querySelector('[data-act="merge"]')?.remove(); });
    }, 350);
  };

  root.addEventListener('input', (e) => {
    const f = e.target.dataset.f;
    const card = e.target.closest('.draft');
    if (!f || !card) return;
    const p = model.get(card.dataset.id);
    if (f === 'price') p.price = parsePrice(e.target.value);
    else if (f === 'featured') p.featured = e.target.checked;
    else p[f] = e.target.value;
    p.ai_fields = p.ai_fields.filter((x) => x !== f);
    e.target.classList.remove('ai');
    e.target.closest('.field')?.querySelector('[data-ai-tag]')?.remove();
    if (f === 'title') e.target.classList.toggle('missing', !p.title.trim());
    if (f === 'price') e.target.classList.toggle('missing', p.price == null);
    schedule(p.id);
  });
  root.addEventListener('change', async (e) => {
    const card = e.target.closest('.draft');
    if (!card) return;
    if (e.target.dataset.f === 'category' || e.target.dataset.f === 'featured') e.target.dispatchEvent(new Event('input', { bubbles: true }));
    if (e.target.dataset.act !== 'addphoto') return;
    const p = model.get(card.dataset.id);
    const files = [...e.target.files].slice(0, 10 - p.photos.length);
    if (!files.length) { toast('Cada doce tem até 10 fotos.'); return; }
    status(p.id, `Enviando ${files.length} ${files.length === 1 ? 'foto' : 'fotos'}…`);
    try {
      for (const f of files) p.photos.push(await api.uploadPhoto(await resizePhoto(f), 'produtos'));
      redrawCard(p.id);
      mode === 'draft' ? await save(p.id) : status(p.id, 'Alterações não salvas');
    } catch (err) { fail(err); }
  });
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    const card = e.target.closest('.draft');
    if (!b || !card || b.tagName === 'INPUT') return;
    const id = card.dataset.id;
    const p = model.get(id);
    const act = b.dataset.act;
    try {
      if (act === 'cover' || act === 'rmphoto') {
        e.preventDefault();
        const i = Number(b.dataset.i);
        const [url] = p.photos.splice(i, 1);
        if (act === 'cover') p.photos.unshift(url);
        else if (mode === 'draft') api.removePhotos([url]).catch(() => {});
        redrawCard(id);
        mode === 'draft' ? await save(id) : status(id, 'Alterações não salvas');
      } else if (act === 'publish') {
        await flush();
        if (!isComplete(p)) { toast('Falta ' + [!p.title?.trim() && 'título', p.price == null && 'valor', !p.photos.length && 'foto'].filter(Boolean).join(', ') + '.'); return; }
        b.disabled = true;
        await api.saveProduct({ ...payload(p), status: 'published' });
        refreshProducts(id);
        toast('Publicado! Já está no cardápio 🎉');
        removeCard(id);
      } else if (act === 'ai') {
        if (!p.photos.length) { toast('Adicione uma foto primeiro.'); return; }
        b.disabled = true; b.innerHTML = '<span class="spin"></span> Olhando…';
        const blob = await (await fetch(p.photos[0])).blob();
        Object.assign(p, aiPatch(await aiFor(blob)));
        redrawCard(id);
        await save(id);
        toast('Preenchido pela IA ✨ — confira');
      } else if (act === 'merge') {
        const prevCard = card.previousElementSibling;
        const prev = prevCard && model.get(prevCard.dataset.id);
        if (!prev) return;
        if (prev.photos.length + p.photos.length > 10) { toast('O doce de cima ficaria com mais de 10 fotos.'); return; }
        prev.photos.push(...p.photos);
        await save(prev.id);
        await api.deleteProduct({ ...p, photos: [] });
        redrawCard(prev.id);
        removeCard(id);
        toast('Fotos juntadas no doce de cima');
      } else if (act === 'delete') {
        if (!(await confirmSheet('Excluir este doce?', 'As fotos e os dados dele serão apagados.', 'Excluir', true))) return;
        clearTimeout(timers.get(id)); timers.delete(id);
        await api.deleteProduct(p);
        screenUpdate('inicio', homeCached().filter((x) => x.id !== id));
        refreshProducts(id);
        toast('Doce excluído');
        if (mode === 'edit') { location.hash = '#/'; return; }
        removeCard(id);
      } else if (act === 'save') {
        if (!isComplete(p)) { toast('Um doce publicado precisa de título, valor e foto.'); return; }
        await save(id);
        screenUpdate('inicio', homeCached().map((x) => (x.id === id ? { ...x, ...payload(p) } : x)));
        refreshProducts();
        toast('Alterações salvas ✓');
        location.hash = `#/doce/${id}`;
      } else if (act === 'unpublish') {
        await api.saveProduct({ ...payload(p), status: 'draft' });
        screenUpdate('inicio', homeCached().filter((x) => x.id !== id));
        screenForget('rascunhos');
        refreshProducts(id);
        toast('Voltou para os rascunhos');
        location.hash = '#/revisar';
      }
    } catch (err) {
      fail(err);
      b.disabled = false;
      if (act === 'ai') b.innerHTML = '✨ Refazer com IA';
    }
  });
  cleanups.push(() => flush());
  return { model, flush };
}

// ===================================================================
// Chat
// ===================================================================
const isUnread = (c) => {
  const u = user();
  if (!u || !c.last_sender || c.last_sender === u.id) return false;
  const seen = isAdmin() && c.customer_id !== u.id ? c.admin_read_at : c.customer_read_at;
  return new Date(c.last_message_at) > new Date(seen);
};
function paintUnread(list) {
  unreadCount = user() ? (list || []).filter(isUnread).length : 0;
  $badge.hidden = !unreadCount;
  $badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
  if ('setAppBadge' in navigator) (unreadCount ? navigator.setAppBadge(unreadCount) : navigator.clearAppBadge()).catch?.(() => {});
}
async function refreshUnread() {
  if (!user()) { paintUnread([]); return; }
  paintUnread(screenCached('chat'));
  try { paintUnread(await screenFetch('chat', loadChats)); } catch { /* sem rede */ }
}

// Arquivar (supabase/002_arquivar_conversas.sql): o cliente arquiva o lado dele; os administradores,
// o lado da loja. Mensagem nova desarquiva; 30 dias arquivada, a conversa é apagada para quem arquivou.
const adminSide = (c) => isAdmin() && c.customer_id !== user()?.id;
const myArchivedAt = (c) => (adminSide(c) ? c.admin_archived_at : c.customer_archived_at);
const daysLeft = (iso) => Math.max(0, 30 - Math.floor((Date.now() - new Date(iso)) / 864e5));
async function setArchived(c, archive) {
  await api.archiveConversation(c.id, archive);
  const at = archive ? new Date().toISOString() : null;
  const patch = adminSide(c) ? { admin_archived_at: at } : { customer_archived_at: at };
  if (archive) Object.assign(patch, adminSide(c) ? { admin_read_at: at } : { customer_read_at: at });
  Object.assign(c, patch);
  const list = screenCached('chat');
  if (list) screenUpdate('chat', list.map((x) => (x.id === c.id ? { ...x, ...patch } : x)));
  refreshUnread();
}

const convRow = (c) => {
  const who = isAdmin() && c.customer_id !== user().id ? c.customer?.name || 'Cliente' : settings.app_name;
  const un = isUnread(c);
  const arch = myArchivedAt(c);
  return `<a class="conv ${un ? 'unread' : ''}" href="#/chat/${esc(c.id)}" draggable="false">
    <span class="conv-photo"><img src="${esc(c.photo_url)}" alt="" loading="lazy" draggable="false">
      ${isAdmin() && c.customer_id !== user().id ? (c.customer?.avatar_url ? `<img class="avatar" src="${esc(c.customer.avatar_url)}" alt="" referrerpolicy="no-referrer" draggable="false">` : `<span class="avatar">${initials(who)}</span>`) : ''}</span>
    <span class="grow"><div class="conv-title">${esc(c.title)}</div><div class="conv-last">${esc(who)}: ${esc(c.last_message || 'Conversa iniciada')}</div>
      ${arch ? `<div class="conv-expire">Apagada em ${daysLeft(arch)} ${daysLeft(arch) === 1 ? 'dia' : 'dias'}</div>` : ''}</span>
    <span class="stack" style="gap:6px;justify-items:end"><span class="conv-time">${fmtTime(c.last_message_at)}</span>${un ? '<span class="unread-dot"></span>' : ''}</span></a>`;
};
// Linha com o fundo da ação por trás (aparece ao arrastar para a esquerda).
const swipeRow = (c, archived) => `<div class="conv-swipe" data-id="${esc(c.id)}">
  <span class="conv-swipe-bg ${archived ? 'restore' : ''}" aria-hidden="true">${I.archive}${archived ? 'Desarquivar' : 'Arquivar'}</span>${convRow(c)}</div>`;

// Arrastar para a esquerda: passando de 35% da largura, onSwipe(wrap) age (devolve true; com
// false a linha volta ao lugar). A rolagem vertical continua normal.
function swipeRows(list, onSwipe) {
  let row = null;
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dragging = false;
  list.addEventListener('pointerdown', (e) => {
    row = e.button === 0 ? e.target.closest('.conv-swipe > .conv') : null;
    startX = e.clientX;
    startY = e.clientY;
    dx = 0;
    dragging = false;
  });
  list.addEventListener('pointermove', (e) => {
    if (!row) return;
    const x = e.clientX - startX;
    const y = e.clientY - startY;
    if (!dragging) {
      if (Math.abs(y) > 10 && Math.abs(y) > Math.abs(x)) return void (row = null); // está rolando a lista
      if (x > -10) return;
      dragging = true;
      row.setPointerCapture(e.pointerId);
      row.classList.add('dragging');
    }
    dx = Math.min(0, x);
    row.style.transform = `translateX(${dx}px)`;
  });
  const end = async () => {
    if (!row) return;
    const r = row;
    row = null;
    r.classList.remove('dragging');
    if (!dragging) return;
    setTimeout(() => (dragging = false)); // depois do clique que o soltar dispara
    if (-dx < r.offsetWidth * 0.35) return void (r.style.transform = '');
    const wrap = r.closest('.conv-swipe');
    r.style.transform = 'translateX(-100%)';
    wrap.classList.add('removing');
    if (await onSwipe(wrap)) {
      wrap.hidden = true;
    } else {
      wrap.classList.remove('removing');
      r.style.transform = '';
    }
  };
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
  // Soltar depois de arrastar não abre a conversa.
  list.addEventListener('click', (e) => dragging && e.preventDefault(), true);
}

async function viewChats(ctx) {
  if (!user()) { $view.innerHTML = loginGate('💬', 'Converse com a gente', 'Toque em "Conversar sobre esta foto" em qualquer doce. Entre com o Google para ver suas conversas.'); return; }
  let current = [];
  let openArchived = false;
  const draw = (list) => {
    current = list;
    const active = list.filter((c) => !myArchivedAt(c));
    const archived = list.filter((c) => myArchivedAt(c));
    $view.innerHTML = `<div class="page">${pageHead(isAdmin() ? 'Conversas com clientes' : 'Chat', { back: false })}
      ${list.length ? `
        ${active.length ? `<p class="small muted pad" style="margin:0 0 4px">Arraste uma conversa para a esquerda para arquivar.</p>
          <div id="conv-list">${active.map((c) => swipeRow(c, false)).join('')}</div>`
        : '<p class="muted pad center" style="margin:18px 0">Nenhuma conversa aberta. 🎉</p>'}
        ${archived.length ? `<details class="archived" id="archived" ${openArchived ? 'open' : ''}>
          <summary><span class="li-ico">${I.archive}</span><b class="grow">Arquivadas</b><span class="count">${archived.length}</span></summary>
          <p class="small muted pad" style="margin:0 0 4px">São apagadas para você 30 dias depois de arquivadas. Mensagem nova traz a conversa de volta. Arraste para a esquerda para desarquivar.</p>
          <div id="arch-list">${archived.map((c) => swipeRow(c, true)).join('')}</div></details>` : ''}`
      : emptyBox('💬', 'Nenhuma conversa ainda', 'Cada conversa nasce de uma foto: abra um doce e toque em <b>Conversar sobre esta foto</b>.', '<a class="btn" href="#/">Ver o cardápio</a>')}</div>`;
    document.getElementById('archived')?.addEventListener('toggle', (e) => (openArchived = e.target.open));
    for (const id of ['conv-list', 'arch-list']) {
      const el = document.getElementById(id);
      if (el) swipeRows(el, (wrap) => onSwipe(wrap, id === 'conv-list'));
    }
  };
  const onSwipe = async (wrap, archive) => {
    const c = current.find((x) => x.id === wrap.dataset.id);
    if (!c) return false;
    try {
      await setArchived(c, archive);
    } catch (err) {
      fail(err);
      return false;
    }
    // Depois da animação, redesenha (vai para "Arquivadas", ou volta para a lista).
    setTimeout(() => ctx.alive() && draw(screenCached('chat') || current), 220);
    toast(archive ? 'Conversa arquivada.' : 'Conversa desarquivada.', 2600, {
      label: 'Desfazer',
      run: async () => {
        try { await setArchived(c, !archive); } catch (err) { return fail(err); }
        if (ctx.alive()) draw(screenCached('chat') || current);
      },
    });
    return true;
  };
  // Mensagem nova: confere a lista e redesenha.
  const h = () => screenFetch('chat', loadChats).then((l) => ctx.alive() && draw(l)).catch(() => {});
  chatHandlers.add(h);
  cleanups.push(() => chatHandlers.delete(h));
  await screenShow(ctx, 'chat', loadChats, draw);
}

async function viewChat(ctx, [id]) {
  if (!user()) { $view.innerHTML = loginGate('💬', 'Entre para ver a conversa', ''); return; }
  const me = user().id;
  const key = `conversa:${id}`;
  // Abre na hora com o que já se sabe (a conversa da lista e o doce do cardápio).
  let st = screenCached(key);
  if (!st) {
    const c = (screenCached('chat') || []).find((x) => x.id === id);
    if (c) st = { c, product: c.product_id ? knownProduct(c.product_id) || null : null, msgs: null };
  }
  let pageDrawn = false;
  let msgs = st?.msgs || null;

  const loadAll = async () => {
    const c = await api.getConversation(id);
    if (!c) return { c: null };
    const [product, list] = await Promise.all([c.product_id ? api.getProduct(c.product_id) : null, api.listMessages(id)]);
    return { c, product, msgs: list };
  };
  const remember = () => screenUpdate(key, { ...st, msgs });

  const drawMsgs = () => {
    const $msgs = document.getElementById('msgs');
    if (!$msgs) return;
    const adminView = isAdmin() && st.c.customer_id !== me;
    const p = st.product;
    const about = `<div class="chat-about"><img src="${esc(st.c.photo_url)}" alt="">
      <div><b>Conversa sobre esta foto</b>${p ? `<br>${esc(p.title)} · <b>${money(p.price)}</b><br><a href="#/doce/${esc(p.id)}" style="color:var(--primary);font-weight:800">Ver doce →</a>` : '<br><span class="muted">Foto de inspiração para encomenda</span>'}</div></div>`;
    let lastDay = '';
    $msgs.innerHTML = about + (msgs == null ? '<p class="center muted small"><span class="spin" style="display:inline-block;vertical-align:middle"></span></p>' : msgs.map((m) => {
      const day = fmtDay(m.created_at);
      const sep = day !== lastDay ? `<div class="day-sep">${day}</div>` : '';
      lastDay = day;
      return `${sep}<div class="bubble ${m.sender_id === me ? 'me' : 'them'}">${esc(m.body)}<time>${new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time></div>`;
    }).join('') + (msgs.length ? '' : `<p class="center muted small">${adminView ? 'O cliente ainda não escreveu.' : 'Diga oi! A gente responde por aqui e avisa no seu celular. 💕'}</p>`));
    $msgs.scrollTop = $msgs.scrollHeight;
    const q = document.getElementById('quick');
    if (q) q.hidden = (msgs || []).filter((m) => m.sender_id === me).length > 1;
  };

  const drawPage = () => {
    pageDrawn = true;
    const c = st.c;
    const adminView = isAdmin() && c.customer_id !== me;
    $view.innerHTML = `<div class="chat-page">
      <header class="page-head">
        <button class="icon-btn" data-back aria-label="Voltar">${I.back}</button>
        <img src="${esc(c.photo_url)}" alt="" style="width:42px;height:42px;border-radius:12px;object-fit:cover">
        <div class="grow"><div style="font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.title)}</div>
          <div class="small muted">${adminView ? esc(c.customer?.name || 'Cliente') : `${esc(settings.app_name)} · responde rapidinho`}</div></div>
        ${adminView && c.customer?.whatsapp ? `<a class="icon-btn" style="color:#25d366" target="_blank" rel="noopener" href="${esc(waLink(c.customer.whatsapp, `Olá, ${firstName(c.customer.name)}! Aqui é da ${settings.app_name}.`))}" aria-label="WhatsApp do cliente">${I.whats}</a>` : ''}
        <button class="icon-btn" id="arch" aria-label="${myArchivedAt(c) ? 'Desarquivar conversa' : 'Arquivar conversa'}" title="${myArchivedAt(c) ? 'Desarquivar' : 'Arquivar'}">${I.archive}</button>
      </header>
      <div class="chat-scroll" id="msgs"></div>
      ${!adminView ? `<div class="quick" id="quick">${['Ainda tem disponível?', 'Qual o prazo?', 'Faz em outra cor?', 'Quero encomendar! 🙌'].map((t) => `<button class="chip">${t}</button>`).join('')}</div>` : ''}
      <form class="chat-input" id="form">
        <textarea class="input" id="text" rows="1" maxlength="2000" placeholder="Escreva sua mensagem…" enterkeyhint="send"></textarea>
        <button class="send-btn" aria-label="Enviar">${I.send}</button>
      </form>
    </div>`;
    drawMsgs();
    // Arquivar pela conversa (alternativa ao gesto de arrastar na lista).
    document.getElementById('arch').onclick = async () => {
      const archive = !myArchivedAt(st.c);
      try { await setArchived(st.c, archive); } catch (err) { return fail(err); }
      remember();
      if (archive) {
        toast('Conversa arquivada. Ela é apagada para você em 30 dias.', 2600, { label: 'Desfazer', run: () => setArchived(st.c, false).then(remember).catch(fail) });
        location.hash = '#/chat';
      } else {
        toast('Conversa desarquivada.');
        drawPage();
      }
    };

    const $text = document.getElementById('text');
    const grow = () => { $text.style.height = 'auto'; $text.style.height = Math.min($text.scrollHeight, 120) + 'px'; };
    $text.addEventListener('input', grow);
    $text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && matchMedia('(hover: hover)').matches) { e.preventDefault(); document.getElementById('form').requestSubmit(); }
    });
    const send = async (body) => {
      body = body.trim();
      if (!body) return;
      msgs ||= [];
      const temp = { id: `tmp-${Date.now()}`, sender_id: me, body, created_at: new Date().toISOString() };
      msgs.push(temp);
      drawMsgs();
      try {
        const saved = await api.sendMessage(id, body);
        const i = msgs.indexOf(temp);
        if (msgs.some((m) => m.id === saved.id)) msgs.splice(i, 1); else msgs[i] = saved;
        remember();
        drawMsgs();
      } catch (err) {
        msgs = msgs.filter((m) => m !== temp);
        drawMsgs();
        $text.value = body;
        fail(err);
      }
    };
    document.getElementById('form').onsubmit = (e) => {
      e.preventDefault();
      const v = $text.value;
      $text.value = '';
      grow();
      send(v);
      $text.focus();
    };
    document.getElementById('quick')?.addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (b) send(b.textContent); });
  };

  const h = (m) => {
    if (!m || m.conversation_id !== id || !msgs || msgs.some((x) => x.id === m.id)) return;
    if (m.sender_id === me && msgs.some((x) => String(x.id).startsWith('tmp-') && x.body === m.body)) return;
    msgs.push(m);
    remember();
    drawMsgs();
    api.markRead(id).then(refreshUnread);
  };
  chatHandlers.add(h);
  cleanups.push(() => chatHandlers.delete(h));

  if (st?.c) drawPage();
  const fresh = await loadAll().catch((err) => { if (st?.c) return null; throw err; });
  if (!ctx.alive()) return;
  if (fresh) {
    if (!fresh.c) { $view.innerHTML = pageHead('Chat') + emptyBox('🤷', 'Conversa não encontrada', ''); return; }
    // Mensagens que chegaram em tempo real enquanto o banco respondia continuam na tela.
    const extra = (msgs || []).filter((m) => !String(m.id).startsWith('tmp-') && !fresh.msgs.some((x) => x.id === m.id));
    const nextMsgs = [...fresh.msgs, ...extra];
    const changed = !sameJson(nextMsgs, msgs) || !sameJson(fresh.product, st?.product);
    st = { c: fresh.c, product: fresh.product };
    msgs = nextMsgs;
    remember();
    if (!pageDrawn) drawPage(); else if (changed) drawMsgs();
  }
  api.markRead(id).then(refreshUnread);
}

function startRealtime() {
  stopRealtime?.();
  stopRealtime = null;
  if (!user()) return;
  let t;
  stopRealtime = api.subscribeChat(
    (m) => { chatHandlers.forEach((h) => h(m)); clearTimeout(t); t = setTimeout(refreshUnread, 400); },
    () => { clearTimeout(t); t = setTimeout(refreshUnread, 400); },
  );
}

// ===================================================================
// Menu, perfil, favoritos
// ===================================================================
function viewMenu() {
  const u = user();
  const drafts = isAdmin() ? (screenCached('rascunhos') || []).length : 0;
  const theme = (() => { try { return localStorage.getItem('cd-tema') || ''; } catch { return ''; } })();
  const themeLabel = { '': 'Automático', light: 'Claro', dark: 'Escuro' }[theme];
  const li = (href, ico, label, right = '<span class="chev">›</span>', attrs = '') =>
    `<${href ? `a href="${href}"` : 'button'} class="li" ${attrs}><span class="li-ico">${ico}</span><span class="grow">${label}</span>${right}</${href ? 'a' : 'button'}>`;
  const count = (n, id) => `<span id="${id}">${n ? `<span class="count">${n}</span>` : '<span class="chev">›</span>'}</span>`;

  $view.innerHTML = `<div class="page">
    ${pageHead('Menu', { back: false })}
    <section class="profile-card">
      ${u ? `<div class="row" style="position:relative;z-index:1">
        ${u.avatar ? `<img class="avatar lg" src="${esc(u.avatar)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar lg">${initials(u.name)}</span>`}
        <div class="grow"><h2>${esc(u.name)}</h2><div style="opacity:.85;font-size:14px;overflow:hidden;text-overflow:ellipsis">${esc(u.email)}</div>
        ${isAdmin() ? '<span class="chip" style="margin-top:6px;background:rgba(255,255,255,.25);border:0;color:#fff;padding:3px 10px;font-size:12px">👑 Administrador</span>' : ''}</div></div>
        <a class="btn sm" href="#/perfil" style="margin-top:14px;background:#fff;color:#3b2a2f;position:relative;z-index:1">Editar perfil</a>`
      : `<div style="position:relative;z-index:1"><div style="font-size:40px">🍰</div><h2>Faça parte da ${esc(settings.app_name)}</h2>
        <p style="opacity:.9;margin:6px 0 14px">Entre para favoritar, conversar sobre os doces e receber novidades.</p>${googleBtn()}</div>`}
    </section>

    ${u ? `<div class="list-title">Minha conta</div><nav class="list">
      ${li('#/perfil', '👤', 'Meu perfil')}
      ${li('#/favoritos', '❤️', 'Favoritos', count(favIds.size, 'm-favs'))}
      ${li('#/chat', '💬', 'Mensagens', count(unreadCount, 'm-chat'))}
      <div class="li"><span class="li-ico">🔔</span><span class="grow">Notificações no celular</span><label class="switch"><input type="checkbox" id="notif"><i></i></label></div>
    </nav>` : ''}

    ${isAdmin() ? `<div class="list-title">Administração</div><nav class="list">
      ${li('#/admin/aparencia', '🎨', 'Aparência: cores e ícone')}
      ${li('#/admin/categorias', '🏷️', 'Categorias')}
      ${li('#/revisar', '📝', 'Rascunhos', count(drafts, 'm-drafts'))}
      ${li('#/admin/novidades', '📧', 'Quem quer novidades por e-mail')}
    </nav>` : ''}

    <div class="list-title">App</div><nav class="list">
      ${!isStandalone() ? li('', '📲', 'Instalar o app no celular', '<span class="chev">›</span>', 'id="install"') : ''}
      ${li('', '🌗', 'Tema', `<span class="muted small">${themeLabel}</span>`, 'id="theme"')}
      ${li('privacidade.html', '🔒', 'Política de privacidade')}
      ${li('termos.html', '📄', 'Termos de uso')}
      ${u ? li('', '🚪', 'Sair da conta', '', 'id="logout"') : ''}
    </nav>
    <p class="center small muted" style="margin:22px 0 0">${esc(settings.app_name)} · feito com 💕</p>
  </div>`;

  // Números e o interruptor chegam depois, sem segurar a tela.
  const $notif = document.getElementById('notif');
  if ($notif) {
    pushActive().then((on) => { $notif.checked = on; }).catch(() => {});
    $notif.addEventListener('change', (e) => togglePush(e.target));
  }
  if (isAdmin()) screenFetch('rascunhos', loadDrafts).then((d) => {
    const el = document.getElementById('m-drafts');
    if (el) el.innerHTML = d.length ? `<span class="count">${d.length}</span>` : '<span class="chev">›</span>';
  }).catch(() => {});
  document.getElementById('theme').onclick = () => {
    const next = { '': 'light', light: 'dark', dark: '' }[theme];
    try { next ? localStorage.setItem('cd-tema', next) : localStorage.removeItem('cd-tema'); } catch {}
    applyTheme();
    viewMenu();
  };
  document.getElementById('install')?.addEventListener('click', showInstall);
  document.getElementById('logout')?.addEventListener('click', async () => {
    if (!(await confirmSheet('Sair da conta?', 'Você continua vendo o cardápio, mas sem favoritos e conversas.', 'Sair'))) return;
    const id = user()?.id;
    await disablePush(api).catch(() => {});
    await api.signOut();
    if (id) screenForgetUser(id);
    toast('Até logo! 👋');
  });
}

async function togglePush(input) {
  if (input.checked) {
    const r = await enablePush(api).catch((err) => { fail(err); return 'erro'; });
    if (r === 'ativo') { toast('Pronto! Você vai receber os avisos no celular 🔔'); return true; }
    input.checked = false;
    if (r === 'ios-instalar') sheet(`<h2>📲 Instale o app primeiro</h2><p class="muted">No iPhone, as notificações só funcionam com o app na tela de início:</p>
      <ol><li>Toque em <b>Compartilhar</b> (o quadrado com a seta) no Safari;</li><li>Escolha <b>Adicionar à Tela de Início</b>;</li><li>Abra o app pelo ícone e ative de novo.</li></ol>
      <button class="btn block" data-close>Entendi</button>`);
    else if (r === 'negado') toast('As notificações estão bloqueadas. Libere nas configurações do navegador.', 4500);
    else if (r === 'sem-chave') toast('As notificações ainda não foram configuradas pelo administrador.', 4000);
    else if (r === 'sem-suporte') toast('Este navegador não recebe notificações.', 4000);
    return false;
  }
  await disablePush(api).catch(fail);
  toast('Notificações desligadas neste aparelho');
  return false;
}

function showInstall() {
  if (installPrompt) { installPrompt.prompt(); installPrompt.userChoice.finally(() => (installPrompt = null)); return; }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  sheet(`<div class="center"><img src="${esc(appIcon(true))}" alt="" class="icon-preview" style="margin:0 auto 12px"></div>
    <h2 class="center">Leve a ${esc(settings.app_name)} no bolso</h2>
    ${ios ? '<ol><li>Toque em <b>Compartilhar</b> (quadrado com seta) no Safari;</li><li>Escolha <b>Adicionar à Tela de Início</b>;</li><li>Toque em <b>Adicionar</b>.</li></ol>'
      : '<ol><li>Abra o menu do navegador (⋮);</li><li>Toque em <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</li></ol>'}
    <button class="btn block" data-close>Entendi</button>`);
}

async function viewProfile(ctx) {
  if (!user()) { $view.innerHTML = loginGate('👤', 'Seu perfil', 'Entre com o Google para salvar seus dados e receber mensagens.'); return; }
  const u = user();
  // Primeira vez sem nada guardado: já abre com o nome e o e-mail da conta.
  if (!screenCached('perfil')) screenUpdate('perfil', { id: u.id, name: u.name, email: u.email, avatar_url: u.avatar, categories: [], email_news: false, push_news: false, _provisorio: true });
  await screenShow(ctx, 'perfil', () => api.getProfile(), (p) => drawProfile(ctx, p), { guard: true });
}

function drawProfile(ctx, p) {
  const chosen = new Set(p.categories || []);
  const u = user();
  const msgsBox = (convs) => (convs?.length ? `<div style="margin:0 -18px">${convs.slice(0, 3).map(convRow).join('')}</div>`
    : '<p class="muted small" style="margin:0">Quando a gente responder, as mensagens aparecem aqui e no seu celular.</p>');
  $view.innerHTML = `<div class="page">
    ${pageHead('Meu perfil')}
    <div class="pad stack">
      <div class="card row">
        ${u.avatar ? `<img class="avatar lg" src="${esc(u.avatar)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar lg">${initials(p.name)}</span>`}
        <div class="grow"><b style="font-size:18px">${esc(p.name || u.name)}</b><div class="small muted">${esc(p.email || u.email)}</div><div class="small muted">Conta Google</div></div>
      </div>

      <div class="card stack">
        <div class="row between"><h2 style="font-size:19px">💬 Mensagens</h2><a href="#/chat" class="small" style="color:var(--primary);font-weight:800">Ver todas</a></div>
        <div id="p-msgs">${msgsBox(screenCached('chat'))}</div>
      </div>

      <form class="card stack" id="pf">
        <label class="field"><span>Nome</span><input class="input" name="name" value="${esc(p.name || '')}" maxlength="80" autocomplete="name"></label>
        <label class="field"><span>WhatsApp</span><input class="input" name="whatsapp" inputmode="tel" value="${esc(fmtPhone(p.whatsapp))}" placeholder="(61) 99999-9999" autocomplete="tel"></label>
        <label class="field"><span>Região onde mora</span><input class="input" name="region" value="${esc(p.region || '')}" maxlength="80" placeholder="Ex.: Asa Norte, Brasília" autocomplete="address-level2"></label>
        <div class="field"><span>Doces que você mais gosta</span>
          <div class="chips wrap" id="pcats">${categories.map((c) => `<button type="button" class="chip ${chosen.has(c.slug) ? 'on' : ''}" data-c="${esc(c.slug)}">${esc(c.emoji)} ${esc(c.name)}</button>`).join('')}</div>
          <span class="small muted" style="font-weight:400">Usamos para avisar quando sair novidade do que você gosta.</span></div>
        <div>
          <div class="switch-row"><div class="grow"><b>📧 Novidades por e-mail</b><div class="small muted">Lançamentos e promoções, sem exagero.</div></div>
            <label class="switch"><input type="checkbox" name="email_news" ${p.email_news ? 'checked' : ''}><i></i></label></div>
          <div class="switch-row"><div class="grow"><b>🔔 Notificações no celular</b><div class="small muted">Respostas do chat neste aparelho.</div></div>
            <label class="switch"><input type="checkbox" id="pnotif"><i></i></label></div>
          <div class="switch-row"><div class="grow"><b>🍰 Avisar doce novo</b><div class="small muted">Notificação quando sair doce das suas categorias.</div></div>
            <label class="switch"><input type="checkbox" name="push_news" ${p.push_news ? 'checked' : ''}><i></i></label></div>
        </div>
        <button class="btn block" ${p._provisorio ? 'disabled' : ''} id="pf-save">Salvar perfil</button>
      </form>
      <button class="btn danger block" id="del">Excluir minha conta</button>
    </div>
  </div>`;

  screenFetch('chat', loadChats).then((l) => { const el = document.getElementById('p-msgs'); if (ctx.alive() && el) el.innerHTML = msgsBox(l); }).catch(() => {});
  const $pn = document.getElementById('pnotif');
  pushActive().then((on) => { $pn.checked = on; }).catch(() => {});

  document.getElementById('pcats').onclick = (e) => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    ctx.touched = true;
    chosen.has(b.dataset.c) ? chosen.delete(b.dataset.c) : chosen.add(b.dataset.c);
    b.classList.toggle('on');
  };
  const form = document.getElementById('pf');
  form.whatsapp.addEventListener('input', (e) => { e.target.value = fmtPhone(e.target.value.replace(/\D/g, '').slice(0, 11)); });
  $pn.onchange = (e) => togglePush(e.target);
  form.push_news.addEventListener('change', async (e) => {
    if (e.target.checked && !(await pushActive())) {
      $pn.checked = true;
      if (!(await togglePush($pn))) e.target.checked = false;
    }
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const wa = form.whatsapp.value.replace(/\D/g, '');
    if (wa && (wa.length < 10 || wa.length > 11)) { toast('Confira o WhatsApp com DDD.'); return; }
    try {
      const saved = await api.saveProfile({ name: form.name.value.trim() || null, whatsapp: wa || null, region: form.region.value.trim() || null, categories: [...chosen], email_news: form.email_news.checked, push_news: form.push_news.checked });
      screenUpdate('perfil', saved);
      toast('Perfil salvo ✓');
    } catch (err) { fail(err); }
  };
  document.getElementById('del').onclick = async () => {
    if (!(await confirmSheet('Excluir sua conta?', 'Apagamos seu perfil, favoritos e conversas. Isso não tem volta.', 'Excluir para sempre', true))) return;
    try {
      const id = user().id;
      await disablePush(api).catch(() => {});
      await api.deleteAccount();
      screenForgetUser(id);
      toast('Conta excluída. Sentiremos sua falta 💔');
      location.hash = '#/';
    } catch (err) { fail(err); }
  };
}

async function viewFavorites(ctx) {
  if (!user()) { $view.innerHTML = loginGate('❤️', 'Seus favoritos', 'Entre com o Google para guardar os doces que você amou.'); return; }
  // Os favoritos são doces do cardápio: filtra o cardápio guardado (na hora) e confere com o banco.
  await screenShow(ctx, 'inicio', loadHome, (all) => {
    const byId = new Map(all.map((p) => [p.id, p]));
    const list = [...favIds].map((id) => byId.get(id)).filter(Boolean);
    $view.innerHTML = `<div class="page">${pageHead('Favoritos')}
      ${list.length ? `<div class="grid">${list.map(productCard).join('')}</div>`
      : emptyBox('💝', 'Nenhum favorito ainda', 'Toque no coração dos doces que você amar para guardar aqui.', '<a class="btn" href="#/">Explorar doces</a>')}</div>`;
  });
}

// ===================================================================
// Administração
// ===================================================================
const PRESETS = [
  ['Morango', '#e5568a'], ['Framboesa', '#c2185b'], ['Chocolate', '#7b4a2e'], ['Caramelo', '#d9822b'],
  ['Pistache', '#5a9b4c'], ['Menta', '#2a9d8f'], ['Lavanda', '#8a6fd1'], ['Mirtilo', '#4a6fd8'],
];
const swatches = (id, chosen) => `<div class="swatches" id="${id}">${PRESETS.map(([n, c]) => `<button type="button" class="swatch ${c === chosen ? 'on' : ''}" style="background:${c}" data-c="${c}" title="${n}" aria-label="${n}"></button>`).join('')}
  <label class="swatch custom ${chosen && !PRESETS.some(([, c]) => c === chosen) ? 'on' : ''}" title="Outra cor"><input type="color" value="${esc(chosen || '#e5568a')}"></label></div>`;
const markSwatch = (box, c) => box.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('on', x.dataset.c === c || (x.classList.contains('custom') && !!c && !PRESETS.some(([, p]) => p === c))));

// Aparência: abre na hora com a aparência que o app já está usando.
function viewAppearance() {
  if (!isAdmin()) { location.hash = '#/menu'; return; }
  const s = { ...settings };
  // Ícone: 'manter' (o atual), 'macaron' (desenho com o fundo escolhido), 'foto' (imagem enviada) ou 'padrao'.
  let iconMode = 'manter';
  let iconBg = (() => { try { return localStorage.getItem('cd-icone-fundo') || '#e5568a'; } catch { return '#e5568a'; } })();
  let iconFile = null;
  const iconPreview = () => (iconMode === 'macaron' ? iconDataUrl(iconBg) : iconMode === 'foto' ? URL.createObjectURL(iconFile) : iconMode === 'padrao' ? 'icons/icon-512.png' : appIcon(true));

  $view.innerHTML = `<div class="page">${pageHead('Aparência')}
    <div class="pad stack">
      <div class="card stack">
        <h2 style="font-size:19px">🎨 Cor do app</h2>
        <p class="small muted" style="margin:-6px 0 0">Botões, preços, menus e destaques de todas as telas.</p>
        ${swatches('sw', s.primary_color)}
        <div class="preview-phone">
          <div class="row"><img class="brand-logo" id="pv-icon" src="${esc(appIcon(false))}" alt=""><div><div class="brand-name" id="pv-name">${esc(s.app_name)}</div><div class="brand-tag" id="pv-tag">${esc(s.tagline)}</div></div></div>
          <div class="row"><span class="btn sm">Botão</span><span class="chip on">Chip</span><span class="pcard-price">R$ 42,00</span></div>
        </div>
      </div>

      <div class="card stack">
        <h2 style="font-size:19px">🧁 Ícone do app</h2>
        <div class="row" style="align-items:flex-start"><img class="icon-preview" id="icon-prev" src="${esc(iconPreview())}" alt="">
          <div class="grow stack" style="gap:8px">
            <b class="small">Cor do fundo do ícone</b>
            ${swatches('isw', iconMode === 'macaron' ? iconBg : null)}
            <button type="button" class="btn sm ghost" id="icon-same">Igual à cor do app</button>
          </div></div>
        <div class="row" style="flex-wrap:wrap">
          <label class="btn sm soft">📷 Usar minha imagem<input type="file" id="icon" accept="image/*" hidden></label>
          <button type="button" class="btn sm ghost" id="icon-reset">Ícone padrão (rosa)</button>
        </div>
        <p class="small muted" style="margin:0">Escolha uma cor de fundo para o macaron ou envie uma imagem quadrada. Quem instalar o app depois da troca já recebe o ícone novo; quem já instalou pode precisar reinstalar.</p>
      </div>

      <form class="card stack" id="af">
        <label class="field"><span>Nome do app</span><input class="input" name="app_name" value="${esc(s.app_name)}" maxlength="40" required></label>
        <label class="field"><span>Frase</span><input class="input" name="tagline" value="${esc(s.tagline)}" maxlength="80"></label>
        <label class="field"><span>WhatsApp da loja <span class="small muted" style="font-weight:400">(opcional, mostra "Pedir pelo WhatsApp")</span></span>
          <input class="input" name="whatsapp" inputmode="tel" value="${esc(fmtPhone(s.whatsapp))}" placeholder="(61) 99999-9999"></label>
        <button class="btn block" id="save">Salvar aparência</button>
      </form>
    </div></div>`;

  const showIcon = () => {
    const url = iconPreview();
    document.getElementById('icon-prev').src = url;
    document.getElementById('pv-icon').src = url;
    markSwatch(document.getElementById('isw'), iconMode === 'macaron' ? iconBg : null);
  };
  const setColor = (c) => {
    s.primary_color = c;
    document.documentElement.style.setProperty('--primary', c);
    markSwatch(document.getElementById('sw'), c);
  };
  const setIconBg = (c) => { iconMode = 'macaron'; iconBg = c; iconFile = null; showIcon(); };
  document.getElementById('sw').addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) setColor(b.dataset.c); });
  document.querySelector('#sw input[type=color]').oninput = (e) => setColor(e.target.value);
  document.getElementById('isw').addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) setIconBg(b.dataset.c); });
  document.querySelector('#isw input[type=color]').oninput = (e) => setIconBg(e.target.value);
  document.getElementById('icon-same').onclick = () => setIconBg(s.primary_color);
  const form = document.getElementById('af');
  form.app_name.oninput = (e) => (document.getElementById('pv-name').textContent = e.target.value);
  form.tagline.oninput = (e) => (document.getElementById('pv-tag').textContent = e.target.value);
  form.whatsapp.oninput = (e) => { e.target.value = fmtPhone(e.target.value.replace(/\D/g, '').slice(0, 11)); };
  document.getElementById('icon').onchange = (e) => { if (e.target.files[0]) { iconFile = e.target.files[0]; iconMode = 'foto'; showIcon(); } };
  document.getElementById('icon-reset').onclick = () => { iconMode = 'padrao'; iconFile = null; showIcon(); };
  cleanups.push(() => document.documentElement.style.setProperty('--primary', settings.primary_color));

  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById('save');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Salvando…';
    try {
      const wa = form.whatsapp.value.replace(/\D/g, '');
      const patch = { primary_color: s.primary_color, app_name: form.app_name.value.trim() || 'Cozinha Doce', tagline: form.tagline.value.trim(), whatsapp: wa || null };
      if (iconMode === 'macaron') {
        patch.icon_url = await api.uploadPhoto(await iconPng(iconBg, 512), 'app');
        patch.icon_192_url = await api.uploadPhoto(await iconPng(iconBg, 192), 'app');
        try { localStorage.setItem('cd-icone-fundo', iconBg); } catch {}
      } else if (iconMode === 'foto') {
        patch.icon_url = await api.uploadPhoto(await squareIcon(iconFile, 512), 'app');
        patch.icon_192_url = await api.uploadPhoto(await squareIcon(iconFile, 192), 'app');
      } else if (iconMode === 'padrao') {
        patch.icon_url = null;
        patch.icon_192_url = null;
      }
      const saved = { ...settings, ...(await api.saveSettings(patch)) };
      applySettings(saved);
      screenUpdate('ajustes', saved);
      toast('Aparência salva ✨');
      viewAppearance();
    } catch (err) {
      fail(err);
      btn.disabled = false;
      btn.textContent = 'Salvar aparência';
    }
  };
}

async function viewCategories(ctx) {
  if (!isAdmin()) { location.hash = '#/menu'; return; }
  const reload = async () => {
    categories = await screenFetch('cats', () => api.listCategories());
    drawCategories(ctx);
  };
  const drawCategories = () => {
    $view.innerHTML = `<div class="page">${pageHead('Categorias')}
      <div class="pad stack">
        <div class="list" style="margin:0" id="cl">${categories.map((c, i) => `
          <div class="li" data-slug="${esc(c.slug)}">
            <input class="input" data-k="emoji" value="${esc(c.emoji)}" style="width:56px;text-align:center;padding:8px" maxlength="4" aria-label="Emoji">
            <input class="input grow" data-k="name" value="${esc(c.name)}" maxlength="40" aria-label="Nome">
            <button class="icon-btn" data-mv="-1" ${i ? '' : 'disabled'} aria-label="Subir">↑</button>
            <button class="icon-btn" data-del aria-label="Excluir" style="color:var(--danger)">✕</button>
          </div>`).join('')}</div>
        <form class="card row" id="nc">
          <input class="input" name="emoji" placeholder="🍰" style="width:64px;text-align:center" maxlength="4">
          <input class="input grow" name="name" placeholder="Nova categoria" maxlength="40" required>
          <button class="btn sm">Adicionar</button>
        </form>
        <p class="small muted">Os doces de uma categoria excluída ficam sem categoria (continuam publicados).</p>
      </div></div>`;
    const list = document.getElementById('cl');
    list.addEventListener('change', async (e) => {
      const row = e.target.closest('[data-slug]');
      const k = e.target.dataset.k;
      if (!row || !k) return;
      const c = categories.find((x) => x.slug === row.dataset.slug);
      c[k] = e.target.value.trim() || c[k];
      screenUpdate('cats', categories);
      try { await api.saveCategory(c); toast('Categoria salva ✓'); } catch (err) { fail(err); }
    });
    list.addEventListener('click', async (e) => {
      const row = e.target.closest('[data-slug]');
      if (!row) return;
      const i = categories.findIndex((x) => x.slug === row.dataset.slug);
      try {
        if (e.target.closest('[data-mv]') && i > 0) {
          [categories[i - 1], categories[i]] = [categories[i], categories[i - 1]];
          categories.forEach((c, pos) => (c.position = pos));
          screenUpdate('cats', categories);
          drawCategories();
          await Promise.all(categories.map((c) => api.saveCategory(c)));
        } else if (e.target.closest('[data-del]')) {
          if (!(await confirmSheet(`Excluir "${categories[i].name}"?`, 'Os doces dela ficam sem categoria.', 'Excluir', true))) return;
          await api.deleteCategory(categories[i].slug);
          await reload();
        }
      } catch (err) { fail(err); }
    });
    document.getElementById('nc').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      let slug = slugify(f.name.value) || 'categoria';
      while (categories.some((c) => c.slug === slug)) slug = (slug + '_2').slice(-30);
      try {
        await api.saveCategory({ slug, name: f.name.value.trim(), emoji: f.emoji.value.trim() || '🍬', position: categories.length });
        toast('Categoria criada ✓');
        await reload();
      } catch (err) { fail(err); }
    };
  };
  await screenShow(ctx, 'cats', () => api.listCategories(), (cats) => { categories = cats; drawCategories(); }, { guard: true });
}

async function viewNewsletter(ctx) {
  if (!isAdmin()) { location.hash = '#/menu'; return; }
  $view.innerHTML = `<div class="page">${pageHead('Novidades por e-mail')}<div class="pad">${skeletonGrid(2)}</div></div>`;
  await screenShow(ctx, 'novidades', () => api.newsletterList(), (list) => {
    $view.innerHTML = `<div class="page">${pageHead('Novidades por e-mail')}
      <div class="pad stack">
        <div class="card row between"><div><b style="font-size:26px;font-family:var(--font-display)">${list.length}</b><div class="small muted">${list.length === 1 ? 'pessoa aceitou' : 'pessoas aceitaram'} receber novidades</div></div>
          <div class="stack" style="gap:8px"><button class="btn sm" id="copy" ${list.length ? '' : 'disabled'}>Copiar e-mails</button><button class="btn sm ghost" id="csv" ${list.length ? '' : 'disabled'}>Baixar planilha</button></div></div>
        <p class="small muted" style="margin:0">Cole os e-mails no campo "Cco" (cópia oculta) ou importe a planilha no seu serviço de e-mail marketing. Respeite quem pedir para sair.</p>
        ${list.length ? `<div class="list" style="margin:0">${list.map((p) => `<div class="li" style="font-weight:600"><span class="li-ico">📧</span><span class="grow"><b>${esc(p.name || '—')}</b><div class="small muted">${esc(p.email)}${p.region ? ' · ' + esc(p.region) : ''}</div>
          <div class="small muted">${(p.categories || []).map((s) => catOf(s)?.emoji || '').join(' ')}</div></span></div>`).join('')}</div>` : emptyBox('📭', 'Ninguém ainda', 'Quem marcar "Novidades por e-mail" no perfil aparece aqui.')}
      </div></div>`;
    document.getElementById('copy').onclick = async () => { await navigator.clipboard.writeText(list.map((p) => p.email).join(', ')); toast('E-mails copiados ✓'); };
    document.getElementById('csv').onclick = () => {
      const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const rows = [['Nome', 'E-mail', 'Região', 'Categorias'], ...list.map((p) => [p.name, p.email, p.region, (p.categories || []).map((s) => catOf(s)?.name || s).join(', ')])];
      const blob = new Blob(['﻿' + rows.map((r) => r.map(q).join(';')).join('\n')], { type: 'text/csv' });
      Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'novidades-cozinha-doce.csv' }).click();
    };
  });
}

// ===================================================================
// Confete (publicou!)
// ===================================================================
function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  Object.assign(c.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: 70 });
  c.width = innerWidth; c.height = innerHeight;
  document.body.append(c);
  const ctx = c.getContext('2d');
  const colors = [settings.primary_color, '#f6b04a', '#ffd6e4', '#8b6cff', '#3fb79a'];
  const bits = Array.from({ length: 90 }, () => ({ x: innerWidth / 2, y: innerHeight * 0.6, vx: (Math.random() - 0.5) * 12, vy: -Math.random() * 14 - 6, r: Math.random() * 6 + 3, c: colors[(Math.random() * colors.length) | 0], a: Math.random() * 6 }));
  let f = 0;
  (function tick() {
    ctx.clearRect(0, 0, c.width, c.height);
    bits.forEach((b) => { b.x += b.vx; b.y += b.vy; b.vy += 0.42; b.a += 0.2; ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a); ctx.fillStyle = b.c; ctx.fillRect(-b.r / 2, -b.r / 4, b.r, b.r / 2); ctx.restore(); });
    if (++f < 110) requestAnimationFrame(tick); else c.remove();
  })();
}

// ===================================================================
// Rotas
// ===================================================================
const ROUTES = [
  [/^\/$/, viewHome, 'inicio'],
  [/^\/buscar$/, viewSearch, 'buscar'],
  [/^\/adicionar$/, viewAdd, 'adicionar'],
  [/^\/revisar$/, viewReview, 'adicionar'],
  [/^\/editar\/([^/]+)$/, viewEdit, 'adicionar'],
  [/^\/doce\/([^/]+)$/, viewProduct, ''],
  [/^\/chat$/, viewChats, 'chat'],
  [/^\/chat\/([^/]+)$/, viewChat, 'chat', true],
  [/^\/menu$/, viewMenu, 'menu'],
  [/^\/perfil$/, viewProfile, 'menu'],
  [/^\/favoritos$/, viewFavorites, 'menu'],
  [/^\/admin\/aparencia$/, viewAppearance, 'menu'],
  [/^\/admin\/categorias$/, viewCategories, 'menu'],
  [/^\/admin\/novidades$/, viewNewsletter, 'menu'],
];
let renderSeq = 0;
const scrollPos = new Map();
let lastHash = location.hash;
let navByLink = false;
document.addEventListener('click', (e) => { if (e.target.closest('a[href^="#"]')) navByLink = true; }, true);
// Ponto de referência da rolagem: o primeiro doce visível e onde ele estava na tela. Cartões fora
// da tela têm altura estimada, então só o número de pixels não basta para voltar ao mesmo lugar.
function scrollAnchor() {
  const links = [...$view.querySelectorAll('a[href^="#/doce/"]')];
  const i = links.findIndex((a) => a.getBoundingClientRect().bottom > 70);
  return { y: window.scrollY, i, top: i >= 0 ? links[i].getBoundingClientRect().top : 0 };
}
function restoreScroll(pos) {
  window.scrollTo(0, pos.y);
  const fix = (n) => {
    const a = $view.querySelectorAll('a[href^="#/doce/"]')[pos.i];
    if (!a) return;
    const d = a.getBoundingClientRect().top - pos.top;
    if (Math.abs(d) > 2) window.scrollBy(0, d);
    if (n) requestAnimationFrame(() => fix(n - 1));
  };
  if (pos.i >= 0) fix(3);
}
async function render() {
  scrollPos.set(lastHash, scrollAnchor());
  lastHash = location.hash;
  const restore = !navByLink && scrollPos.get(location.hash);
  navByLink = false;
  const my = ++renderSeq;
  const ctx = { alive: () => my === renderSeq, touched: false };
  currentCtx = ctx;
  cleanups.forEach((fn) => { try { fn(); } catch {} });
  cleanups = [];
  document.querySelectorAll('.sheet-backdrop').forEach((b) => b.remove());
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const query = new URLSearchParams(qs || '');
  const route = ROUTES.find(([re]) => re.test(path)) || ROUTES[0];
  const params = path.match(route[0])?.slice(1).map(decodeURIComponent) || [];
  document.body.classList.toggle('no-tabbar', !!route[3]);
  $tabbar.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === route[2]));
  try {
    // A tela já está desenhada quando a função volta pela primeira vez (com o guardado). Só então
    // rola: rolar antes faria o celular medir a tela antiga (o Início inteiro) à toa.
    const done = route[1](ctx, params, query);
    if (restore) restoreScroll(restore); else window.scrollTo(0, 0);
    await done;
  } catch (err) {
    if (!ctx.alive()) return;
    console.error(err);
    $view.innerHTML = emptyBox('😵', 'Não deu para carregar', esc(err.message || 'Confira sua internet e tente de novo.'), '<button class="btn" onclick="location.reload()">Tentar de novo</button>');
  }
}
window.addEventListener('hashchange', () => { sessionStorage.setItem('cd-nav', '1'); render(); });
// Redesenha a tela atual com dados novos que chegaram (aparência, categorias, conta) sem atrapalhar quem digita.
function rerenderQuietly() {
  if (currentCtx.touched) return;
  const typing = document.activeElement;
  if ($view.contains(typing) && /^(INPUT|TEXTAREA|SELECT)$/.test(typing.tagName)) return;
  render();
}

// ===================================================================
// Início do app
// ===================================================================
function loadUserData() {
  favIds = new Set(user() ? screenCached('favs') || [] : []);
  paintHearts();
  startRealtime();
  refreshUnread();
  if (!user()) return;
  syncPush(api);
  screenFetch('favs', () => api.listFavoriteIds()).then((ids) => { favIds = new Set(ids); paintHearts(); }).catch(() => {});
}

async function boot() {
  applyTheme();
  api = await createApi();
  await api.init();
  // Volta do login do Google: tira o ?code= do endereço.
  if (location.search) history.replaceState(null, '', location.pathname + location.hash);
  // Aparência e categorias: na hora com o guardado; o banco confere em seguida.
  const cachedSettings = screenCached('ajustes');
  const firstTime = { app_name: 'Cozinha Doce', tagline: '', icon_url: null, icon_192_url: null, whatsapp: null,
    primary_color: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#7b4a2e' };
  applySettings({ ...firstTime, ...(cachedSettings || {}) });
  categories = screenCached('cats') || [];
  loadUserData();
  api.onAuth(async (u) => {
    loadUserData();
    if (u) { toast(`Bem-vindo(a), ${firstName(u.name)}! 🍰`); prefetchScreens(); }
    render();
  });
  api.onAdminChange(() => rerenderQuietly());
  render();

  const [s, cats] = await Promise.all([
    screenFetch('ajustes', () => api.getSettings()).catch(() => null),
    screenFetch('cats', () => api.listCategories()).catch(() => null),
  ]);
  const changed = (s && !sameJson(s, cachedSettings)) || (cats && !sameJson(cats, categories));
  if (s) applySettings(s);
  if (cats) categories = cats;
  if (changed) rerenderQuietly();
}

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data?.type === 'push') refreshUnread(); });
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
document.addEventListener('visibilitychange', () => { if (!document.hidden && api) refreshUnread(); });

boot().catch((err) => {
  console.error(err);
  $view.innerHTML = emptyBox('😵', 'O app não abriu', esc(err.message), '<button class="btn" onclick="location.reload()">Tentar de novo</button>');
});
