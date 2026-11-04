-- =====================================================================
-- Cozinha Doce — banco de dados (Supabase / Postgres)
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.
-- Pode rodar de novo sem perder dados (tudo usa "if not exists"/"or replace").
-- =====================================================================

create extension if not exists pg_net;

-- ---------- Administradores ----------
create table if not exists public.admins (
  user_id uuid primary key references auth.users on delete cascade
);
alter table public.admins enable row level security;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;

drop policy if exists "admins: cada um se vê" on public.admins;
create policy "admins: cada um se vê" on public.admins for select using (user_id = auth.uid());

-- ---------- Aparência do app (uma linha só) ----------
create table if not exists public.app_settings (
  id int primary key default 1 check (id = 1),
  app_name text not null default 'Cozinha Doce' check (length(app_name) between 1 and 40),
  tagline text not null default 'Doces feitos com carinho' check (length(tagline) <= 80),
  primary_color text not null default '#e5568a' check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  icon_url text,      -- ícone 512x512 enviado pelo administrador
  icon_192_url text,  -- mesmo ícone em 192x192
  whatsapp text check (whatsapp is null or whatsapp ~ '^[0-9]{10,13}$'),
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id) values (1) on conflict do nothing;
alter table public.app_settings enable row level security;
drop policy if exists "aparência: todos leem" on public.app_settings;
create policy "aparência: todos leem" on public.app_settings for select using (true);
drop policy if exists "aparência: admin altera" on public.app_settings;
create policy "aparência: admin altera" on public.app_settings for update using (public.is_admin()) with check (public.is_admin());

-- ---------- Categorias ----------
create table if not exists public.categories (
  slug text primary key check (slug ~ '^[a-z0-9_]{2,30}$'),
  name text not null check (length(name) between 1 and 40),
  emoji text not null default '🍬' check (length(emoji) <= 16),
  position int not null default 0
);
insert into public.categories (slug, name, emoji, position) values
  ('bolos', 'Bolos', '🎂', 1),
  ('brigadeiros', 'Brigadeiros', '🍫', 2),
  ('docinhos_festa', 'Docinhos de festa', '🍬', 3),
  ('tortas', 'Tortas', '🥧', 4),
  ('cupcakes', 'Cupcakes', '🧁', 5),
  ('cookies', 'Cookies', '🍪', 6),
  ('brownies', 'Brownies', '🟫', 7),
  ('sobremesas', 'Sobremesas', '🍮', 8),
  ('presentes', 'Kits e presentes', '🎁', 9),
  ('outros', 'Outros', '🍩', 99)
on conflict do nothing;
alter table public.categories enable row level security;
drop policy if exists "categorias: todos leem" on public.categories;
create policy "categorias: todos leem" on public.categories for select using (true);
drop policy if exists "categorias: admin altera" on public.categories;
create policy "categorias: admin altera" on public.categories for all using (public.is_admin()) with check (public.is_admin());

-- ---------- Perfis ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text check (length(name) <= 80),
  email text,
  avatar_url text,
  whatsapp text check (whatsapp is null or whatsapp ~ '^[0-9]{10,13}$'),
  region text check (length(region) <= 80),
  categories text[] not null default '{}' check (cardinality(categories) <= 20),
  email_news boolean not null default false, -- aceita receber novidades por e-mail
  push_news boolean not null default false,  -- aceita aviso no celular quando sai doce novo
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "perfil: dono e admin leem" on public.profiles;
create policy "perfil: dono e admin leem" on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists "perfil: dono altera" on public.profiles;
create policy "perfil: dono altera" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- Cria o perfil no primeiro login (nome e foto vêm do Google).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, email, avatar_url)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
          new.email,
          new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Contas que já existiam antes deste arquivo também ganham perfil.
insert into public.profiles (id, name, email, avatar_url)
select id, coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', split_part(email, '@', 1)), email, raw_user_meta_data->>'avatar_url'
from auth.users
on conflict (id) do nothing;

-- ---------- Doces (anúncios) ----------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  title text not null default '' check (length(title) <= 120),
  price numeric(10,2) check (price is null or price >= 0),
  description text not null default '' check (length(description) <= 2000),
  category text references public.categories (slug) on update cascade on delete set null,
  photos text[] not null default '{}' check (cardinality(photos) <= 10),
  status text not null default 'draft' check (status in ('draft', 'published')),
  featured boolean not null default false,
  ai_fields text[] not null default '{}', -- campos preenchidos pela IA ainda não revisados
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  -- Só publica completo: título, preço e pelo menos uma foto.
  constraint publicado_completo check (
    status = 'draft' or (length(trim(title)) > 0 and price is not null and cardinality(photos) > 0)
  )
);
create index if not exists products_status_idx on public.products (status, published_at desc);
alter table public.products enable row level security;
drop policy if exists "doces: publicados para todos" on public.products;
create policy "doces: publicados para todos" on public.products for select using (status = 'published' or public.is_admin());
drop policy if exists "doces: admin altera" on public.products;
create policy "doces: admin altera" on public.products for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.products_before_save()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.status = 'published' and (tg_op = 'INSERT' or old.status <> 'published') then
    new.published_at := now();
    new.ai_fields := '{}';
  end if;
  return new;
end $$;
drop trigger if exists products_before_save on public.products;
create trigger products_before_save before insert or update on public.products
  for each row execute function public.products_before_save();

-- ---------- Favoritos ----------
create table if not exists public.favorites (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  product_id uuid not null references public.products on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
alter table public.favorites enable row level security;
drop policy if exists "favoritos: só os meus" on public.favorites;
create policy "favoritos: só os meus" on public.favorites for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Chat (cada conversa nasce de uma foto) ----------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products on delete set null,
  photo_url text not null,
  title text not null check (length(title) <= 120),
  customer_id uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  last_message text,
  last_message_at timestamptz not null default now(),
  last_sender uuid,
  customer_read_at timestamptz not null default now(),
  admin_read_at timestamptz not null default 'epoch',
  unique (customer_id, product_id, photo_url)
);
create index if not exists conversations_customer_idx on public.conversations (customer_id, last_message_at desc);
create index if not exists conversations_recent_idx on public.conversations (last_message_at desc);
alter table public.conversations enable row level security;
drop policy if exists "conversas: cliente e admin" on public.conversations;
create policy "conversas: cliente e admin" on public.conversations for select using (customer_id = auth.uid() or public.is_admin());

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations on delete cascade,
  sender_id uuid not null default auth.uid() references auth.users on delete cascade,
  body text not null check (length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_idx on public.messages (conversation_id, id);
alter table public.messages enable row level security;
drop policy if exists "mensagens: quem participa lê" on public.messages;
create policy "mensagens: quem participa lê" on public.messages for select using (
  exists (select 1 from public.conversations c where c.id = conversation_id and (c.customer_id = auth.uid() or public.is_admin()))
);
drop policy if exists "mensagens: quem participa escreve" on public.messages;
create policy "mensagens: quem participa escreve" on public.messages for insert with check (
  sender_id = auth.uid() and
  exists (select 1 from public.conversations c where c.id = conversation_id and (c.customer_id = auth.uid() or public.is_admin()))
);

-- Abre (ou reabre) a conversa sobre uma foto. Foto de um doce publicado, ou foto de inspiração
-- que a própria pessoa enviou (pasta encomendas/<id da pessoa>/ no Storage).
create or replace function public.start_conversation(p_product uuid, p_photo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_title text;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta para conversar.'; end if;
  if p_product is not null then
    select title into v_title from products
      where id = p_product and status = 'published' and p_photo = any (photos);
    if v_title is null then raise exception 'Foto não encontrada neste doce.'; end if;
  else
    if p_photo not like '%/storage/v1/object/public/fotos/encomendas/' || auth.uid() || '/%' then
      raise exception 'Foto inválida.';
    end if;
    v_title := 'Encomenda personalizada';
  end if;

  select id into v_id from conversations
    where customer_id = auth.uid() and product_id is not distinct from p_product and photo_url = p_photo;
  if v_id is null then
    insert into conversations (product_id, photo_url, title, customer_id)
      values (p_product, p_photo, v_title, auth.uid()) returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.mark_conversation_read(p_conversation uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then
    update conversations set admin_read_at = now() where id = p_conversation;
  else
    update conversations set customer_read_at = now() where id = p_conversation and customer_id = auth.uid();
  end if;
end $$;

-- Atualiza o resumo da conversa e dispara a notificação no celular.
create or replace function public.messages_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update conversations c set
    last_message = left(new.body, 140),
    last_message_at = new.created_at,
    last_sender = new.sender_id,
    customer_read_at = case when c.customer_id = new.sender_id then new.created_at else c.customer_read_at end,
    admin_read_at = case when c.customer_id = new.sender_id then c.admin_read_at else new.created_at end
  where c.id = new.conversation_id;
  perform public.call_push_hook(jsonb_build_object('type', 'message', 'id', new.id));
  return new;
end $$;
drop trigger if exists messages_after_insert on public.messages;
create trigger messages_after_insert after insert on public.messages
  for each row execute function public.messages_after_insert();

-- Tempo real do chat
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.conversations;
exception when duplicate_object then null; end $$;

-- ---------- Notificações no celular (Web Push) ----------
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "push: só os meus" on public.push_subscriptions;
create policy "push: só os meus" on public.push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.'; end if;
  insert into push_subscriptions (endpoint, user_id, p256dh, auth)
    values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;

-- Chama a função enviar-push. O endereço e a senha ficam no Vault (veja o README, passo 6);
-- sem eles nada acontece e o app continua funcionando, só sem aviso no celular.
create or replace function public.call_push_hook(p_body jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_hook_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_hook_secret';
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(
    url := v_url,
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', v_secret)
  );
exception when others then
  raise warning 'push: %', sqlerrm; -- nunca impede a mensagem ou o doce de ser salvo
end $$;

-- Doce publicado: avisa quem pediu novidades no celular.
create or replace function public.products_after_publish()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status <> 'published') then
    perform public.call_push_hook(jsonb_build_object('type', 'product', 'id', new.id));
  end if;
  return new;
end $$;
drop trigger if exists products_after_publish on public.products;
create trigger products_after_publish after insert or update of status on public.products
  for each row execute function public.products_after_publish();

-- ---------- IA (Gemini): limite de uso ----------
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  used_at timestamptz not null default now()
);
alter table public.ai_usage enable row level security;

create or replace function public.ai_take_quota()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Só o administrador usa o preenchimento automático.'; end if;
  if (select count(*) from ai_usage where user_id = auth.uid() and used_at > now() - interval '1 hour') >= 200 then
    raise exception 'Limite de 200 fotos por hora atingido. Tente mais tarde.';
  end if;
  insert into ai_usage (user_id) values (auth.uid());
  delete from ai_usage where used_at < now() - interval '2 days';
end $$;

-- ---------- Lista de quem quer novidades por e-mail (só administrador) ----------
create or replace function public.newsletter_list()
returns table (name text, email text, region text, categories text[])
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Só o administrador.'; end if;
  return query select p.name, p.email, p.region, p.categories from profiles p where p.email_news order by p.name;
end $$;

-- ---------- Excluir a própria conta (LGPD) ----------
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.'; end if;
  delete from storage.objects where bucket_id = 'fotos' and name like 'encomendas/' || auth.uid() || '/%';
  delete from auth.users where id = auth.uid();
end $$;

-- ---------- Fotos (Storage) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "fotos: admin envia" on storage.objects;
create policy "fotos: admin envia" on storage.objects for insert to authenticated with check (
  bucket_id = 'fotos' and (
    public.is_admin() or
    ((storage.foldername(name))[1] = 'encomendas' and (storage.foldername(name))[2] = auth.uid()::text)
  )
);
drop policy if exists "fotos: admin apaga" on storage.objects;
create policy "fotos: admin apaga" on storage.objects for delete to authenticated using (
  bucket_id = 'fotos' and (
    public.is_admin() or
    ((storage.foldername(name))[1] = 'encomendas' and (storage.foldername(name))[2] = auth.uid()::text)
  )
);

-- =====================================================================
-- Depois de entrar no app com a sua conta Google, torne-se administrador:
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'SEU-EMAIL@gmail.com';
-- =====================================================================
