// Service worker: abre rápido, funciona com internet ruim e mostra as notificações.
// Arquivos do app: rede primeiro, cache como reserva. Dados do Supabase: sempre da rede.
const CACHE = 'cozinha-doce-v10';
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/api.js',
  'js/config.js',
  'js/image.js',
  'js/push.js',
  'js/icone.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/favicon.png',
  'privacidade.html',
  'termos.html',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  const cdn = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname);
  if (!sameOrigin && !cdn) return;

  if (cdn) {
    // Bibliotecas com versão fixa e fontes: cache primeiro.
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })),
    );
    return;
  }

  // Fotos e ícones: mostra o que já está guardado na hora e atualiza em segundo plano.
  if (/\/(fotos|icons)\//.test(url.pathname)) {
    e.respondWith(
      caches.open(CACHE).then((c) => c.match(req).then((hit) => {
        const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; });
        if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
        return net;
      })),
    );
    return;
  }

  e.respondWith(
    fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./'))),
  );
});

self.addEventListener('push', (e) => {
  let msg = {};
  try { msg = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((wins) => {
      wins.forEach((w) => w.postMessage({ type: 'push', url: msg.url }));
      // A pessoa já está vendo esta tela: não precisa de aviso.
      if (msg.url && wins.some((w) => w.focused && w.visibilityState === 'visible' && w.url === msg.url)) return;
      return self.registration.showNotification(msg.title || 'Cozinha Doce', {
        body: msg.body || 'Tem novidade docinha para você.',
        icon: 'icons/icon-192.png',
        badge: 'icons/badge-96.png',
        image: msg.image || undefined,
        tag: msg.tag,
        renotify: !!msg.tag,
        data: { url: msg.url || './#/' },
      });
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => w.url.startsWith(self.registration.scope));
      if (win) return win.focus().then(() => win.navigate(url)).catch(() => self.clients.openWindow(url));
      return self.clients.openWindow(url);
    }),
  );
});
