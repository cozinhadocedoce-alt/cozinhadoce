// Preenche título, descrição, categoria e preço de um doce a partir da foto, com o Gemini (IA do Google).
// A chave GEMINI_API_KEY fica só nos segredos desta função; o site nunca a vê.
// Só o administrador usa, com limite por hora (função ai_take_quota em supabase/schema.sql).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-3.5-flash-lite'; // o mesmo do Desapega
const MAX_IMAGE = 1_500_000; // base64 de uma foto já reduzida no celular

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PROMPT = (categories: Record<string, string>) => `Você ajuda uma confeitaria artesanal chamada "Cozinha Doce" a anunciar seus doces.
Olhe a foto e responda em português do Brasil, com tom gostoso e convidativo, sem exageros:
- titulo: nome curto e atraente do doce (até 50 caracteres). Ex.: "Bolo de pote de ninho com morango", "Brigadeiro gourmet de pistache".
- descricao: 2 ou 3 frases que dão água na boca, contando o que aparece na foto (massa, recheio, cobertura, decoração).
  Não invente ingredientes que não dá para ver; use "parece" quando não tiver certeza. Não fale de preço.
- categoria: a chave que melhor se encaixa, entre: ${Object.entries(categories).map(([k, v]) => `${k} (${v})`).join(', ')}.
- preco_sugerido: preço justo em reais para venda artesanal no Brasil (unidade, fatia, pote ou cento, conforme a foto), ou null se não der para estimar.
Se houver vários doces, descreva o conjunto (ex.: "Caixa com 12 brigadeiros sortidos").`;

Deno.serve(async (req) => {
  const headers = { ...cors, 'Content-Type': 'application/json' };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY') ?? req.headers.get('apikey') ?? '', {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return reply(401, { error: 'Entre na sua conta para usar a IA.' });

  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) return reply(503, { error: 'A IA ainda não está configurada (falta GEMINI_API_KEY).' });

  let body: { image?: string; categories?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: 'Pedido inválido.' });
  }
  const image = String(body.image ?? '');
  const categories = body.categories ?? {};
  const keys = Object.keys(categories);
  if (!image || image.length > MAX_IMAGE || !/^[A-Za-z0-9+/=]+$/.test(image)) return reply(400, { error: 'Foto inválida ou grande demais.' });
  if (!keys.length || keys.length > 40 || keys.some((k) => !/^[a-z0-9_]{2,30}$/.test(k) || String(categories[k]).length > 40)) {
    return reply(400, { error: 'Categorias inválidas.' });
  }

  const quota = await sb.rpc('ai_take_quota');
  if (quota.error) return reply(429, { error: quota.error.message });

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data: image } }, { text: PROMPT(categories) }] }],
      generation_config: {
        temperature: 0.4,
        response_mime_type: 'application/json',
        response_schema: {
          type: 'OBJECT',
          properties: {
            titulo: { type: 'STRING' },
            descricao: { type: 'STRING' },
            categoria: { type: 'STRING', enum: keys },
            preco_sugerido: { type: 'NUMBER', nullable: true },
          },
          required: ['titulo', 'descricao', 'categoria'],
        },
      },
    }),
  });
  if (!res.ok) {
    console.error('Gemini', res.status, (await res.text()).slice(0, 500));
    return reply(502, { error: res.status === 429 ? 'A IA está ocupada agora. Tente de novo em instantes.' : 'A IA não conseguiu analisar a foto.' });
  }

  try {
    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
    const out = JSON.parse(text);
    const price = Number(out.preco_sugerido);
    return reply(200, {
      title: String(out.titulo ?? '').trim().slice(0, 120),
      description: String(out.descricao ?? '').trim().slice(0, 2000),
      category: keys.includes(out.categoria) ? out.categoria : keys.includes('outros') ? 'outros' : keys[0],
      price: Number.isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : null,
    });
  } catch (err) {
    console.error('Resposta da IA', err);
    return reply(502, { error: 'A IA não conseguiu analisar a foto.' });
  }
});
