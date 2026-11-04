// Camada de dados do app. Duas implementações com as mesmas funções:
//  - Supabase (produção): login Google, banco com RLS, fotos no Storage, chat em tempo real, IA na Edge Function.
//  - Demonstração (sem configurar nada): tudo fica no localStorage deste navegador.
import { CONFIG } from './config.js';

export const configured = !CONFIG.SUPABASE_URL.includes('SEU-PROJETO');
const BASE_URL = location.origin + location.pathname.replace(/index\.html$/, '');

const DEFAULT_SETTINGS = {
  app_name: 'Cozinha Doce',
  tagline: 'Macarons e doces finos · Milena Andrade',
  primary_color: '#7b4a2e',
  icon_url: null,
  icon_192_url: null,
  whatsapp: null,
};

// =====================================================================
// Supabase
// =====================================================================
function supabaseApi(sb) {
  let user = null; // { id, email, name, avatar }
  let admin = false;
  const listeners = new Set();

  const toUser = (u) => u && {
    id: u.id,
    email: u.email,
    name: u.user_metadata?.full_name || u.user_metadata?.name || u.email?.split('@')[0],
    avatar: u.user_metadata?.avatar_url || null,
  };
  const ok = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };
  // "É administrador?" abre na hora com a última resposta guardada neste aparelho; o banco confere
  // em segundo plano (as permissões de verdade estão nas regras do banco, não aqui).
  const adminKey = (id) => `cd-admin:${id}`;
  const adminChanged = new Set();
  const cachedAdmin = () => {
    try { return !!user && localStorage.getItem(adminKey(user.id)) === '1'; } catch { return false; }
  };
  const refreshAdmin = async () => {
    if (!user) { admin = false; return; }
    const id = user.id;
    const { data, error } = await sb.from('admins').select('user_id').eq('user_id', id).maybeSingle();
    if (error || user?.id !== id) return;
    const next = !!data;
    try { localStorage.setItem(adminKey(id), next ? '1' : '0'); } catch {}
    if (next !== admin) { admin = next; adminChanged.forEach((cb) => cb(admin)); }
  };
  const pathFromUrl = (url) => {
    const i = String(url).indexOf('/object/public/fotos/');
    return i < 0 ? null : decodeURIComponent(url.slice(i + '/object/public/fotos/'.length));
  };

  return {
    mode: 'supabase',
    async init() {
      const { data } = await sb.auth.getSession();
      user = toUser(data.session?.user);
      admin = cachedAdmin();
      refreshAdmin().catch(() => {});
      sb.auth.onAuthStateChange(async (event, session) => {
        const next = toUser(session?.user);
        if ((next?.id ?? null) === (user?.id ?? null) && event !== 'USER_UPDATED') return;
        user = next;
        admin = cachedAdmin();
        await refreshAdmin().catch(() => {});
        listeners.forEach((cb) => cb(user));
      });
    },
    get user() { return user; },
    get isAdmin() { return admin; },
    onAuth(cb) { listeners.add(cb); },
    onAdminChange(cb) { adminChanged.add(cb); },
    async signIn() {
      const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: BASE_URL } });
      if (error) throw error;
    },
    async signOut() {
      await sb.auth.signOut();
    },

    // ---------- Aparência ----------
    async getSettings() {
      const { data } = await sb.from('app_settings').select('*').eq('id', 1).maybeSingle();
      return { ...DEFAULT_SETTINGS, ...(data || {}) };
    },
    async saveSettings(patch) {
      return ok(await sb.from('app_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1).select().single());
    },
    manifestUrl() {
      return `${CONFIG.SUPABASE_URL}/functions/v1/manifesto?site=${encodeURIComponent(BASE_URL)}`;
    },

    // ---------- Categorias ----------
    async listCategories() {
      return ok(await sb.from('categories').select('*').order('position').order('name'));
    },
    async saveCategory(cat) {
      return ok(await sb.from('categories').upsert(cat).select().single());
    },
    async deleteCategory(slug) {
      ok(await sb.from('categories').delete().eq('slug', slug));
    },

    // ---------- Doces ----------
    async listProducts({ status = 'published', category, q, sort = 'recent', limit = 200, ids, featured } = {}) {
      let query = sb.from('products').select('*').eq('status', status);
      if (category) query = query.eq('category', category);
      if (featured) query = query.eq('featured', true);
      if (ids) query = query.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
      if (q) {
        const term = q.replace(/[%,()*\\]/g, ' ').trim();
        if (term) query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%`);
      }
      if (sort === 'price_asc') query = query.order('price', { ascending: true, nullsFirst: false });
      else if (sort === 'price_desc') query = query.order('price', { ascending: false, nullsFirst: false });
      else if (status === 'draft') query = query.order('created_at', { ascending: true });
      else query = query.order('published_at', { ascending: false, nullsFirst: false });
      return ok(await query.limit(limit));
    },
    async getProduct(id) {
      return ok(await sb.from('products').select('*').eq('id', id).maybeSingle());
    },
    async saveProduct(p) {
      const row = { ...p };
      delete row.created_at; delete row.updated_at; delete row.published_at; delete row.created_by;
      if (row.id) return ok(await sb.from('products').update(row).eq('id', row.id).select().single());
      return ok(await sb.from('products').insert(row).select().single());
    },
    async deleteProduct(p) {
      ok(await sb.from('products').delete().eq('id', p.id));
      // Doce já publicado pode ter conversas que mostram as fotos: elas ficam no Storage.
      if (p.status === 'draft') await this.removePhotos(p.photos || []);
    },
    async uploadPhoto(blob, folder = 'produtos') {
      const ext = blob.type === 'image/png' ? 'png' : 'jpg';
      const dir = folder === 'encomendas' ? `encomendas/${user.id}` : folder;
      const path = `${dir}/${crypto.randomUUID()}.${ext}`;
      ok(await sb.storage.from('fotos').upload(path, blob, { contentType: blob.type, cacheControl: '31536000' }));
      return sb.storage.from('fotos').getPublicUrl(path).data.publicUrl;
    },
    async removePhotos(urls) {
      const paths = urls.map(pathFromUrl).filter(Boolean);
      if (paths.length) await sb.storage.from('fotos').remove(paths);
    },

    // ---------- Favoritos ----------
    async listFavoriteIds() {
      if (!user) return [];
      return ok(await sb.from('favorites').select('product_id').order('created_at', { ascending: false })).map((f) => f.product_id);
    },
    async setFavorite(productId, on) {
      if (on) ok(await sb.from('favorites').upsert({ user_id: user.id, product_id: productId }));
      else ok(await sb.from('favorites').delete().eq('product_id', productId).eq('user_id', user.id));
    },

    // ---------- Perfil ----------
    async getProfile() {
      if (!user) return null;
      const p = ok(await sb.from('profiles').select('*').eq('id', user.id).maybeSingle());
      return p || { id: user.id, name: user.name, email: user.email, avatar_url: user.avatar, categories: [] };
    },
    async saveProfile(patch) {
      return ok(await sb.from('profiles').update(patch).eq('id', user.id).select().single());
    },
    async deleteAccount() {
      ok(await sb.rpc('delete_my_account'));
      await sb.auth.signOut();
    },

    // ---------- Chat ----------
    async listConversations() {
      if (!user) return [];
      let q = sb.from('conversations').select('*, customer:profiles(name, avatar_url, whatsapp)').order('last_message_at', { ascending: false }).limit(100);
      if (!admin) q = q.eq('customer_id', user.id);
      return ok(await q);
    },
    async getConversation(id) {
      return ok(await sb.from('conversations').select('*, customer:profiles(name, avatar_url, whatsapp)').eq('id', id).maybeSingle());
    },
    async startConversation(productId, photoUrl) {
      return ok(await sb.rpc('start_conversation', { p_product: productId, p_photo: photoUrl }));
    },
    async listMessages(conversationId) {
      return ok(await sb.from('messages').select('*').eq('conversation_id', conversationId).order('id').limit(500));
    },
    async sendMessage(conversationId, body) {
      return ok(await sb.from('messages').insert({ conversation_id: conversationId, body }).select().single());
    },
    async markRead(conversationId) {
      await sb.rpc('mark_conversation_read', { p_conversation: conversationId });
    },
    // Arquiva (true) ou desarquiva (false) só para quem chamou (supabase/002_arquivar_conversas.sql).
    async archiveConversation(conversationId, archive = true) {
      ok(await sb.rpc('archive_conversation', { p_conv: conversationId, p_archive: archive }));
    },
    subscribeChat(onMessage, onConversation) {
      const ch = sb.channel(`chat-${user.id}-${Date.now()}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => onMessage(p.new))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, (p) => onConversation?.(p.new))
        .subscribe();
      return () => sb.removeChannel(ch);
    },

    // ---------- IA ----------
    async aiFill(base64, categories) {
      const { data, error } = await sb.functions.invoke('preencher-doce', { body: { image: base64, categories } });
      if (error) {
        let msg = error.message;
        try { msg = (await error.context.json()).error || msg; } catch {}
        throw new Error(msg);
      }
      return data;
    },
    aiAvailable: true,

    // ---------- Notificações ----------
    async savePushSubscription(sub) {
      const { keys } = sub.toJSON();
      ok(await sb.rpc('save_push_subscription', { p_endpoint: sub.endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth }));
    },
    async removePushSubscription(endpoint) {
      ok(await sb.from('push_subscriptions').delete().eq('endpoint', endpoint));
    },
    async newsletterList() {
      return ok(await sb.rpc('newsletter_list'));
    },
  };
}

// =====================================================================
// Demonstração (localStorage)
// =====================================================================
const svgPhoto = (emoji, c1, c2) =>
  'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="800" height="800" fill="url(#g)"/><g fill="#fff" opacity=".35"><circle cx="120" cy="140" r="14"/><circle cx="660" cy="110" r="10"/><circle cx="700" cy="620" r="16"/><circle cx="90" cy="650" r="9"/><circle cx="400" cy="90" r="7"/></g><text x="400" y="470" font-size="330" text-anchor="middle">${emoji}</text></svg>`,
  );

function demoSeed() {
  const now = Date.now();
  const P = (i, title, price, category, emojis, description, featured = false) => ({
    id: `demo-${i}`,
    title, price, category, description, featured,
    photos: emojis.map(([e, a, b]) => svgPhoto(e, a, b)),
    status: 'published',
    ai_fields: [],
    created_at: new Date(now - i * 3600e3).toISOString(),
    published_at: new Date(now - i * 3600e3).toISOString(),
  });
  return {
    settings: { ...DEFAULT_SETTINGS },
    categories: [
      ['bolos', 'Bolos', '🎂'], ['brigadeiros', 'Brigadeiros', '🍫'], ['docinhos_festa', 'Docinhos de festa', '🍬'],
      ['tortas', 'Tortas', '🥧'], ['cupcakes', 'Cupcakes', '🧁'], ['cookies', 'Cookies', '🍪'],
      ['sobremesas', 'Sobremesas', '🍮'], ['presentes', 'Kits e presentes', '🎁'], ['outros', 'Outros', '🍩'],
    ].map(([slug, name, emoji], position) => ({ slug, name, emoji, position })),
    products: [
      P(1, 'Bolo de ninho com morango', 89.9, 'bolos', [['🎂', '#ffd6e4', '#ff8fb3'], ['🍓', '#ffe3ec', '#ff6f91']], 'Massa fofinha de baunilha, recheio cremoso de leite ninho e morangos frescos. Perfeito para aniversários e para adoçar o domingo.', true),
      P(2, 'Caixa com 12 brigadeiros gourmet', 42, 'brigadeiros', [['🍫', '#f3d9c6', '#8b5a3c']], 'Brigadeiros enroladinhos na hora, com chocolate belga e granulado crocante. Sabores sortidos: tradicional, ninho e pistache.', true),
      P(3, 'Torta de limão', 64.5, 'tortas', [['🥧', '#fbf6c9', '#c6e377']], 'Base amanteigada e crocante, creme de limão azedinho na medida e merengue maçaricado por cima.', true),
      P(4, 'Cupcakes de red velvet (6 un.)', 36, 'cupcakes', [['🧁', '#ffe0e6', '#d94c6a']], 'Massa aveludada com toque de cacau e cobertura de cream cheese. Lindos para presentear.'),
      P(5, 'Cookies recheados de Nutella', 9.5, 'cookies', [['🍪', '#f7e3c8', '#c98b4b']], 'Crocantes por fora, macios por dentro e com um coração generoso de Nutella.'),
      P(6, 'Pudim de leite condensado', 48, 'sobremesas', [['🍮', '#fff1cf', '#e7a33e']], 'Lisinho, sem furinhos, com calda de caramelo dourada. Receita de família.'),
      P(7, 'Cento de docinhos de festa', 120, 'docinhos_festa', [['🍬', '#e9ddff', '#9b7bff'], ['🍭', '#ffe1f4', '#ff7cc8']], 'Beijinho, brigadeiro, cajuzinho e bicho-de-pé. Escolha até 4 sabores para sua festa.'),
      P(8, 'Kit café da tarde', 75, 'presentes', [['🎁', '#d8f3ec', '#5cc6a7']], 'Caixa presenteável com bolo de pote, 4 brigadeiros, 2 cookies e cartão escrito à mão.', true),
      P(9, 'Donuts glaceados', 7, 'outros', [['🍩', '#ffe6d6', '#ff9a6b']], 'Fofinhos e cobertos com glacê colorido e confeitos. Unidade.'),
    ],
    favorites: [],
    profile: null,
    conversations: [],
    messages: [],
    user: null,
  };
}

function demoApi() {
  const KEY = 'cozinha-doce-demo';
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY)) || demoSeed(); } catch { db = demoSeed(); }
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {
      throw new Error('O espaço da demonstração neste navegador acabou. Apague alguns doces ou configure o Supabase.');
    }
  };
  const listeners = new Set();
  const chatListeners = new Set();
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));
  const emitMsg = (m, c) => chatListeners.forEach(([a, b]) => { a(clone(m)); b?.(clone(c)); });

  return {
    mode: 'demo',
    async init() {},
    get user() { return db.user; },
    get isAdmin() { return !!db.user; }, // na demonstração, quem entra administra
    onAuth(cb) { listeners.add(cb); },
    onAdminChange() {},
    async signIn() {
      db.user = { id: 'demo-user', email: 'voce@exemplo.com', name: 'Você', avatar: null };
      db.profile ||= { id: 'demo-user', name: 'Você', email: 'voce@exemplo.com', avatar_url: null, whatsapp: null, region: '', categories: [], email_news: false, push_news: false };
      save();
      listeners.forEach((cb) => cb(db.user));
    },
    async signOut() {
      db.user = null;
      save();
      listeners.forEach((cb) => cb(null));
    },

    async getSettings() { return { ...DEFAULT_SETTINGS, ...db.settings }; },
    async saveSettings(patch) { Object.assign(db.settings, patch); save(); return clone(db.settings); },
    manifestUrl() { return null; },

    async listCategories() { return clone(db.categories).sort((a, b) => a.position - b.position); },
    async saveCategory(cat) {
      const i = db.categories.findIndex((c) => c.slug === cat.slug);
      if (i >= 0) db.categories[i] = { ...db.categories[i], ...cat };
      else db.categories.push(cat);
      save();
      return cat;
    },
    async deleteCategory(slug) {
      db.categories = db.categories.filter((c) => c.slug !== slug);
      db.products.forEach((p) => { if (p.category === slug) p.category = null; });
      save();
    },

    async listProducts({ status = 'published', category, q, sort = 'recent', limit = 200, ids, featured } = {}) {
      await wait();
      const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      let list = db.products.filter((p) => p.status === status);
      if (category) list = list.filter((p) => p.category === category);
      if (featured) list = list.filter((p) => p.featured);
      if (ids) list = list.filter((p) => ids.includes(p.id));
      if (q) list = list.filter((p) => norm(p.title + ' ' + p.description).includes(norm(q)));
      if (sort === 'price_asc') list.sort((a, b) => (a.price ?? 1e9) - (b.price ?? 1e9));
      else if (sort === 'price_desc') list.sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
      else if (status === 'draft') list.sort((a, b) => a.created_at.localeCompare(b.created_at));
      else list.sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));
      return clone(list.slice(0, limit));
    },
    async getProduct(id) { return clone(db.products.find((p) => p.id === id) || null); },
    async saveProduct(p) {
      const now = new Date().toISOString();
      let row = p.id && db.products.find((x) => x.id === p.id);
      if (!row) {
        row = { id: uid(), title: '', price: null, description: '', category: null, photos: [], status: 'draft', featured: false, ai_fields: [], created_at: now };
        db.products.push(row);
      }
      const wasPublished = row.status === 'published';
      Object.assign(row, p, { id: row.id, updated_at: now });
      if (row.status === 'published') {
        if (!row.title.trim() || row.price == null || !row.photos.length) {
          row.status = wasPublished ? 'published' : 'draft';
          throw new Error('Para publicar, o doce precisa de título, valor e pelo menos uma foto.');
        }
        if (!wasPublished) { row.published_at = now; row.ai_fields = []; }
      }
      save();
      return clone(row);
    },
    async deleteProduct(p) { db.products = db.products.filter((x) => x.id !== p.id); db.favorites = db.favorites.filter((f) => f !== p.id); save(); },
    async uploadPhoto(blob) {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
    },
    async removePhotos() {},

    async listFavoriteIds() { return db.user ? [...db.favorites] : []; },
    async setFavorite(id, on) {
      db.favorites = db.favorites.filter((f) => f !== id);
      if (on) db.favorites.unshift(id);
      save();
    },

    async getProfile() { return db.user ? clone(db.profile) : null; },
    async saveProfile(patch) { Object.assign(db.profile, patch); save(); return clone(db.profile); },
    async deleteAccount() { localStorage.removeItem(KEY); db = demoSeed(); listeners.forEach((cb) => cb(null)); },

    async listConversations() {
      if (!db.user) return [];
      const expired = (c) => c.customer_archived_at && Date.now() - new Date(c.customer_archived_at) > 30 * 864e5;
      return clone(db.conversations.filter((c) => !expired(c))).map((c) => ({ ...c, customer: { name: db.profile?.name, avatar_url: null, whatsapp: db.profile?.whatsapp } }))
        .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at));
    },
    async getConversation(id) {
      const c = db.conversations.find((x) => x.id === id);
      return c ? { ...clone(c), customer: { name: db.profile?.name, avatar_url: null, whatsapp: db.profile?.whatsapp } } : null;
    },
    async startConversation(productId, photoUrl) {
      let c = db.conversations.find((x) => x.product_id === productId && x.photo_url === photoUrl);
      if (!c) {
        const prod = db.products.find((p) => p.id === productId);
        const now = new Date().toISOString();
        c = { id: uid(), product_id: productId, photo_url: photoUrl, title: prod?.title || 'Encomenda personalizada', customer_id: db.user.id, created_at: now, last_message_at: now, last_message: null, last_sender: null, customer_read_at: now, admin_read_at: now };
        db.conversations.push(c);
        save();
      }
      return c.id;
    },
    async listMessages(id) { return clone(db.messages.filter((m) => m.conversation_id === id)); },
    async sendMessage(conversationId, body) {
      const c = db.conversations.find((x) => x.id === conversationId);
      const m = { id: Date.now(), conversation_id: conversationId, sender_id: db.user.id, body, created_at: new Date().toISOString() };
      db.messages.push(m);
      Object.assign(c, { last_message: body, last_message_at: m.created_at, last_sender: m.sender_id, customer_read_at: m.created_at, customer_archived_at: null });
      save();
      // Resposta automática, para dar para ver como fica o chat.
      if (db.messages.filter((x) => x.conversation_id === conversationId && x.sender_id === 'loja').length < 1) {
        setTimeout(() => {
          const r = { id: Date.now(), conversation_id: conversationId, sender_id: 'loja', body: 'Oi! 💕 Aqui é a Cozinha Doce. Recebemos sua mensagem e já respondemos. (Esta é uma resposta automática da demonstração.)', created_at: new Date().toISOString() };
          db.messages.push(r);
          Object.assign(c, { last_message: r.body, last_message_at: r.created_at, last_sender: 'loja', customer_archived_at: null });
          save();
          emitMsg(r, c);
        }, 1400);
      }
      return clone(m);
    },
    async markRead(id) {
      const c = db.conversations.find((x) => x.id === id);
      if (c) { c.customer_read_at = new Date().toISOString(); save(); }
    },
    async archiveConversation(id, archive = true) {
      const c = db.conversations.find((x) => x.id === id);
      if (!c) throw new Error('Conversa não encontrada.');
      c.customer_archived_at = archive ? new Date().toISOString() : null;
      if (archive) c.customer_read_at = new Date().toISOString();
      save();
    },
    subscribeChat(onMessage, onConversation) {
      const pair = [onMessage, onConversation];
      chatListeners.add(pair);
      return () => chatListeners.delete(pair);
    },

    async aiFill() { throw new Error('A IA do Google funciona quando o Supabase estiver configurado (veja o README).'); },
    aiAvailable: false,

    async savePushSubscription() {},
    async removePushSubscription() {},
    async newsletterList() {
      return db.profile?.email_news ? [{ name: db.profile.name, email: db.profile.email, region: db.profile.region, categories: db.profile.categories }] : [];
    },
  };
}

export async function createApi() {
  if (!configured) return demoApi();
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
  const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true },
  });
  return supabaseApi(sb);
}
