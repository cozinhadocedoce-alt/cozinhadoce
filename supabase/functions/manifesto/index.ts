// Manifesto do app com a cor e o ícone escolhidos pelo administrador.
// O index.html troca o manifest.webmanifest fixo por este endereço quando o Supabase está configurado,
// então quem instala o app depois de uma troca já recebe o ícone novo.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  // Endereço do site (start_url/scope): só https ou localhost.
  let site = url.searchParams.get('site') ?? Deno.env.get('SITE_URL') ?? '';
  if (!/^https:\/\/[^\s]+$|^http:\/\/localhost(:\d+)?\//.test(site)) site = Deno.env.get('SITE_URL') ?? '/';
  if (!site.endsWith('/')) site += '/';

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });
  const { data: s } = await db.from('app_settings').select('*').eq('id', 1).single();
  const name = s?.app_name ?? 'Cozinha Doce';
  const color = s?.primary_color ?? '#e5568a';

  const icons = s?.icon_url
    ? [
        { src: s.icon_192_url ?? s.icon_url, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: s.icon_url, sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: s.icon_url, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ]
    : [
        { src: `${site}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: `${site}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: `${site}icons/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ];

  const manifest = {
    id: site,
    name,
    short_name: name,
    description: s?.tagline ?? 'Doces feitos com carinho',
    lang: 'pt-BR',
    start_url: `${site}#/`,
    scope: site,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#fff8f3',
    theme_color: color,
    icons,
  };
  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' },
  });
});
