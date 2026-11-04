# Cozinha Doce 🧁

PWA para apresentar e vender doces. Mesmo jeito do Desapega: **HTML + JavaScript puro** (sem build), **Supabase** (login Google, banco com RLS, fotos, chat em tempo real) e **Gemini** (IA do Google) numa Edge Function.

> Sem configurar nada, o app abre em **modo demonstração**: dados de exemplo guardados só no navegador, e quem entra vira administrador. Assim você já vê e testa tudo.
> Para testar: `npx serve -l 8000 .` e abra `http://localhost:8000/`.

## O que tem

| Menu | O que faz |
|---|---|
| **Início** | Carrossel de destaques que passa sozinho, categorias em bolinhas (estilo stories), "Fresquinhos", faixas por categoria e grade com todos os doces |
| **Buscar** | Busca por texto, chips de categoria e ordem por preço |
| **Adicionar** | **Administrador:** escolhe várias fotos de uma vez (1 foto = 1 doce, ou todas num doce só), a IA preenche título, valor, descrição e categoria, e tudo vira **rascunho para revisar antes de publicar** (campos da IA marcados com ✨, salvamento automático, juntar fotos, trocar capa, publicar um por um ou todos). **Cliente:** encomenda especial com uma foto de inspiração |
| **Chat** | Cada conversa nasce de **uma foto** do doce (a que estava na tela). Tempo real, respostas rápidas e aviso no celular |
| **Menu** | Perfil, favoritos, mensagens, notificações, tema claro/escuro, instalar o app, **Política de privacidade** e **Termos de uso**. Administrador: **Aparência (cor e ícone)**, categorias, rascunhos e lista de quem quer novidades por e-mail |

**Perfil:** mensagens recentes, WhatsApp, região onde mora, categorias preferidas, novidades por e-mail, notificações no celular, aviso de doce novo e excluir a conta.

## Passo a passo

### 1. Supabase
1. Crie um projeto em [supabase.com](https://supabase.com).
2. Em **SQL Editor**, rode todo o [`supabase/schema.sql`](supabase/schema.sql).
3. Em **Project Settings → API**, copie a **Project URL** e a chave **anon/publishable** para [`js/config.js`](js/config.js).
4. **Authentication → URL Configuration:** Site URL = endereço do site publicado; em Redirect URLs, adicione também `http://localhost:8000/`.
5. **Authentication → Providers → Google:** ative e informe o Client ID/Secret do [Google Cloud Console](https://console.cloud.google.com/apis/credentials) (Aplicativo da Web, com a Callback URL que o Supabase mostra).
6. Entre no app com sua conta Google e, no SQL Editor, torne-se administrador:
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = 'SEU-EMAIL@gmail.com';
   ```

### 1b. Arquivar conversas
Rode [`supabase/002_arquivar_conversas.sql`](supabase/002_arquivar_conversas.sql) no SQL Editor: arrastar uma conversa para a esquerda no Chat a arquiva (só para quem arrastou, com Desfazer). Mensagem nova desarquiva. Depois de 30 dias arquivada, a conversa é apagada para quem arquivou; quando os dois lados apagaram, ela sai do banco (limpeza diária com `pg_cron`).

### 2. Funções (IA, notificações e ícone)
Com a [CLI do Supabase](https://supabase.com/docs/guides/cli) (`npx supabase login`):
```bash
# gera a chave pública e a privada das notificações
npx web-push generate-vapid-keys
# GEMINI_API_KEY: crie em aistudio.google.com/apikey
npx supabase secrets set --project-ref SEU_REF \
  GEMINI_API_KEY=... \
  VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... \
  PUSH_HOOK_SECRET=uma-senha-longa-qualquer \
  SITE_URL=https://SEU-USUARIO.github.io/cozinha-doce
for f in preencher-doce enviar-push manifesto; do npx supabase functions deploy $f --project-ref SEU_REF --no-verify-jwt; done
```
- Cole a chave **pública** VAPID em `VAPID_PUBLIC_KEY` no `js/config.js`.
- Para o banco chamar a função de notificações, rode no SQL Editor:
  ```sql
  select vault.create_secret('https://SEU_REF.supabase.co/functions/v1/enviar-push', 'push_hook_url');
  select vault.create_secret('a-mesma-senha-do-PUSH_HOOK_SECRET', 'push_hook_secret');
  ```
- Modelo da IA: padrão `gemini-3.5-flash-lite` (o mesmo do Desapega). Para trocar: segredo `GEMINI_MODEL`. Limite: 200 fotos por hora.

### 3. Publicar (GitHub Pages)
```bash
git init -b main && git add . && git commit -m "Cozinha Doce"
git remote add origin https://github.com/SEU-USUARIO/cozinha-doce.git && git push -u origin main
```
No GitHub: **Settings → Pages → Deploy from a branch → main / (root)**.

## Como funcionam alguns detalhes
- **Cor do app:** salva em `app_settings`, aplicada como `--primary`; todo o visual deriva dela (degradês, chips, botões).
- **Ícone:** o administrador envia uma imagem; o app recorta um quadrado de 512 e 192 px e usa no topo, na aba do navegador, no iPhone e no manifesto dinâmico (função `manifesto`). Quem já instalou pode precisar reinstalar para ver o ícone novo.
- **Publicar só completo:** o banco recusa doce publicado sem título, valor e foto (constraint `publicado_completo`).
- **Notificações:** mensagem nova avisa a outra pessoa da conversa; doce publicado avisa quem ligou "Avisar doce novo" (filtrando pelas categorias preferidas). No iPhone, só com o app instalado na tela de início.
- **Novidades por e-mail:** o app guarda quem aceitou; a lista (copiar ou baixar planilha) fica em **Menu → Quem quer novidades por e-mail**, para usar no seu serviço de e-mail.
- **Ícones PNG:** gerados de `icons/icon.svg` com `npm install && npm run icons`.

## Estrutura
```
index.html  manifest.webmanifest  sw.js  privacidade.html  termos.html
css/style.css        visual (claro e escuro)
js/config.js         URL e chave do Supabase, chave pública VAPID
js/api.js            dados: Supabase ou modo demonstração
js/app.js            telas e rotas
js/image.js          reduz fotos e recorta o ícone no aparelho
js/push.js           inscrição das notificações
supabase/schema.sql  tabelas, regras (RLS), gatilhos e Storage
supabase/functions/  preencher-doce (Gemini) · enviar-push · manifesto
```
