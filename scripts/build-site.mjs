import{cpSync as f,existsSync as _,mkdirSync as p,readFileSync as A,rmSync as w,writeFileSync as l}from"node:fs";const o="_site",E=["index.html","404.html","privacidade.html","termos.html","sair.html","manifest.webmanifest","sw.js","css","js","icons","fotos"];w(o,{recursive:!0,force:!0}),p(o);for(const t of E)_(t)&&f(t,`${o}/${t}`,{recursive:!0});l(`${o}/.nojekyll`,"");const R=A("js/config.js","utf8"),m=t=>R.match(new RegExp(`${t}:\\s*['"]([^'"]+)['"]`))?.[1],n=m("SUPABASE_URL"),d=m("SUPABASE_ANON_KEY"),u=(process.env.SITE_URL||"").replace(/\/?$/,"/");(!n||n.includes("SEU-PROJETO"))&&(console.log("Supabase ainda não configurado em js/config.js; pulando páginas de compartilhamento."),process.exit(0));const e=t=>String(t??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]),U=t=>t==null?"Sob consulta":Number(t).toLocaleString("pt-BR",{style:"currency",currency:"BRL"}),g={apikey:d,Authorization:`Bearer ${d}`},[r,h]=await Promise.all([fetch(`${n}/rest/v1/products?select=id,title,price,description,photos&status=eq.published&order=published_at.desc&limit=2000`,{headers:g}),fetch(`${n}/rest/v1/app_settings?select=app_name,tagline,icon_url&id=eq.1`,{headers:g})]);r.ok||(console.error("Falha ao ler os doces do Supabase:",r.status,await r.text()),process.exit(0));const $=await r.json(),i=h.ok&&(await h.json())[0]||{},y=i.app_name||"Cozinha Doce";for(const t of $){const c=`${t.title} · ${U(t.price)}`,a=(t.description||i.tagline||"").replace(/\s+/g," ").slice(0,200),S=t.photos?.[0]||i.icon_url||`${u}icons/icon-512.png`,s=`../../#/doce/${t.id}`;p(`${o}/d/${t.id}`,{recursive:!0}),l(`${o}/d/${t.id}/index.html`,`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(c)} — ${e(y)}</title>
<meta name="description" content="${e(a)}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="${e(y)}">
<meta property="og:title" content="${e(c)}">
<meta property="og:description" content="${e(a)}">
<meta property="og:image" content="${e(S)}">
<meta property="og:image:alt" content="${e(t.title)}">
<meta property="og:url" content="${e(u)}d/${t.id}/">
<meta property="product:price:amount" content="${t.price??""}">
<meta property="product:price:currency" content="BRL">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=${s}">
<script>location.replace(${JSON.stringify(s)});<\/script>
</head>
<body><a href="${s}">Ver o doce</a></body>
</html>
`)}console.log(`Geradas ${$.length} páginas de compartilhamento.`);
