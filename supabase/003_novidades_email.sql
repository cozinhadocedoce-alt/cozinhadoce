-- =====================================================================
-- Cozinha Doce — novidades por e-mail
-- Cole no SQL Editor do Supabase e clique em Run (pode rodar de novo).
-- Quem envia é o agendamento "Enviar novidades por e-mail" do GitHub
-- (scripts/enviar-novidades.mjs), com o Gmail da Cozinha Doce.
-- A senha que o GitHub usa para pedir a lista fica no Vault, com o nome
-- 'news_email_secret' (veja o README).
-- =====================================================================

-- Doce que já teve o e-mail de novidade enviado (cada doce vai uma vez só).
alter table public.products add column if not exists news_emailed_at timestamptz;

-- Código de cada pessoa para o link "não quero mais receber" (sem precisar entrar).
alter table public.profiles add column if not exists email_token uuid not null default gen_random_uuid();
create unique index if not exists profiles_email_token_idx on public.profiles (email_token);

-- Doces publicados antes de hoje não geram e-mail (só os das últimas 24 horas).
update public.products set news_emailed_at = now()
where status = 'published' and news_emailed_at is null
  and coalesce(published_at, created_at) < now() - interval '24 hours';

-- Confere a senha guardada no Vault.
create or replace function public.news_email_auth(p_secret text)
returns void language plpgsql security definer set search_path = public as $$
declare v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'news_email_secret';
  if v_secret is null or p_secret is null or p_secret <> v_secret then
    raise exception 'Sem permissão.';
  end if;
end $$;
revoke execute on function public.news_email_auth(text) from public, anon, authenticated;

-- O que falta enviar: doces novos (até 3 dias), quem aceitou e os dados do app.
create or replace function public.news_email_pending(p_secret text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.news_email_auth(p_secret);
  return jsonb_build_object(
    'app', (select jsonb_build_object('name', app_name, 'tagline', tagline, 'color', primary_color, 'icon', icon_url)
            from app_settings where id = 1),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'title', p.title, 'price', p.price, 'description', p.description,
               'category', p.category, 'category_name', c.name, 'category_emoji', c.emoji, 'photo', p.photos[1])
             order by p.published_at)
      from products p left join categories c on c.slug = p.category
      where p.status = 'published' and p.news_emailed_at is null
        and p.published_at > now() - interval '3 days'), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'email', email, 'categories', categories, 'token', email_token))
      from profiles where email_news and email like '%_@_%'), '[]'::jsonb)
  );
end $$;
grant execute on function public.news_email_pending(text) to anon, authenticated;

-- Marca os doces como enviados.
create or replace function public.news_email_mark(p_secret text, p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.news_email_auth(p_secret);
  update products set news_emailed_at = now() where id = any (p_ids) and news_emailed_at is null;
end $$;
grant execute on function public.news_email_mark(text, uuid[]) to anon, authenticated;

-- Link "não quero mais receber" do rodapé do e-mail (página sair.html).
create or replace function public.news_unsubscribe(p_token uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update profiles set email_news = false where email_token = p_token;
  return found;
end $$;
grant execute on function public.news_unsubscribe(uuid) to anon, authenticated;
