// Notificação no celular (Web Push). Chamada só pelo próprio banco (função call_push_hook):
//  - { type: 'message', id }  mensagem nova no chat -> avisa a outra pessoa da conversa
//  - { type: 'product', id }  doce publicado        -> avisa quem pediu novidades no celular
// Segredos: PUSH_HOOK_SECRET (o mesmo guardado no Vault), VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e SITE_URL.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

type Sub = { endpoint: string; p256dh: string; auth: string };

Deno.serve(async (req) => {
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });

  const secret = Deno.env.get('PUSH_HOOK_SECRET');
  if (!secret || req.headers.get('x-hook-secret') !== secret) return reply(401, { error: 'Sem permissão.' });
  const pub = Deno.env.get('VAPID_PUBLIC_KEY');
  const priv = Deno.env.get('VAPID_PRIVATE_KEY');
  const site = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '');
  if (!pub || !priv || !site) return reply(503, { error: 'Notificações não configuradas.' });
  webpush.setVapidDetails(site.startsWith('https') ? site : 'mailto:contato@cozinhadoce.app', pub, priv);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { type, id } = await req.json().catch(() => ({}));

  const { data: settings } = await db.from('app_settings').select('app_name').eq('id', 1).single();
  const appName = settings?.app_name ?? 'Cozinha Doce';

  let userIds: string[] = [];
  let payload: Record<string, string> = {};

  if (type === 'message') {
    const { data: msg } = await db.from('messages').select('id, body, sender_id, conversation_id, created_at').eq('id', id).single();
    if (!msg || Date.now() - new Date(msg.created_at).getTime() > 5 * 60_000) return reply(200, { sent: 0 });
    const { data: conv } = await db.from('conversations').select('id, title, customer_id, photo_url').eq('id', msg.conversation_id).single();
    if (!conv) return reply(200, { sent: 0 });
    if (msg.sender_id === conv.customer_id) {
      // Cliente escreveu: avisa os administradores.
      const { data: admins } = await db.from('admins').select('user_id');
      userIds = (admins ?? []).map((a) => a.user_id).filter((u) => u !== msg.sender_id);
      const { data: p } = await db.from('profiles').select('name').eq('id', msg.sender_id).single();
      payload = { title: p?.name ?? 'Cliente', body: `Sobre "${conv.title}": ${msg.body}` };
    } else {
      userIds = [conv.customer_id];
      payload = { title: appName, body: `Sobre "${conv.title}": ${msg.body}` };
    }
    payload.url = `${site}/#/chat/${conv.id}`;
    payload.tag = `chat-${conv.id}`;
    payload.image = conv.photo_url;
  } else if (type === 'product') {
    const { data: prod } = await db.from('products').select('id, title, price, category, photos, status').eq('id', id).single();
    if (!prod || prod.status !== 'published') return reply(200, { sent: 0 });
    // Quem aceitou novidades e (não escolheu categorias ou escolheu a deste doce).
    const { data: people } = await db.from('profiles').select('id, categories').eq('push_news', true);
    userIds = (people ?? []).filter((p) => !p.categories?.length || p.categories.includes(prod.category)).map((p) => p.id);
    const price = Number(prod.price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    payload = { title: `Novidade na ${appName} 🍰`, body: `${prod.title} · ${price}`, url: `${site}/#/doce/${prod.id}`, tag: `doce-${prod.id}`, image: prod.photos?.[0] ?? '' };
  } else {
    return reply(400, { error: 'Tipo inválido.' });
  }

  if (!userIds.length) return reply(200, { sent: 0 });
  const { data: subs } = await db.from('push_subscriptions').select('endpoint, p256dh, auth').in('user_id', userIds.slice(0, 5000));

  let sent = 0;
  await Promise.all((subs ?? []).map(async (s: Sub) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 24 * 3600, urgency: 'high' });
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
      else console.error('push', status, (err as Error).message);
    }
  }));
  return reply(200, { sent });
});
