-- =====================================================================
-- Cozinha Doce — arquivar conversas (só para quem arquivou)
-- Rode depois do schema.sql, no SQL Editor do Supabase.
--
-- Arrastar uma conversa para a esquerda no Chat a arquiva para quem arrastou
-- (o cliente, ou os administradores). A outra pessoa continua vendo tudo.
-- Mensagem nova desarquiva a conversa dos dois lados.
-- Depois de 30 dias arquivada, ela é apagada para quem arquivou: some da lista e
-- as mensagens antigas não aparecem mais para essa pessoa. Se chegar mensagem
-- nova, ela volta só com o que é novo. Quando os dois lados apagaram, a conversa
-- sai do banco (limpeza diária às 6h, horário de Brasília).
-- =====================================================================

alter table public.conversations
  add column if not exists customer_archived_at timestamptz,
  add column if not exists admin_archived_at timestamptz,
  add column if not exists customer_deleted_at timestamptz,
  add column if not exists admin_deleted_at timestamptz;

-- O mesmo cliente pode abrir uma conversa nova sobre a mesma foto depois de apagar a antiga.
alter table public.conversations drop constraint if exists conversations_customer_id_product_id_photo_url_key;
create index if not exists conversations_photo_idx on public.conversations (customer_id, product_id, photo_url);

-- A partir de quando um lado não vê mais as mensagens: apagou, ou arquivou há mais de 30 dias.
create or replace function public.conv_cutoff(p_deleted timestamptz, p_archived timestamptz)
returns timestamptz language sql stable as $$
  select nullif(greatest(
    coalesce(p_deleted, '-infinity'),
    coalesce(case when p_archived <= now() - interval '30 days' then p_archived end, '-infinity')
  ), '-infinity'::timestamptz)
$$;

-- A conversa aparece para um lado se não foi apagada para ele, ou se chegou mensagem depois.
create or replace function public.conv_visible(p_deleted timestamptz, p_archived timestamptz, p_last timestamptz)
returns boolean language sql stable as $$
  select public.conv_cutoff(p_deleted, p_archived) is null or p_last > public.conv_cutoff(p_deleted, p_archived)
$$;

drop policy if exists "conversas: cliente e admin" on public.conversations;
create policy "conversas: cliente e admin" on public.conversations for select using (
  (customer_id = auth.uid() and public.conv_visible(customer_deleted_at, customer_archived_at, last_message_at))
  or (public.is_admin() and public.conv_visible(admin_deleted_at, admin_archived_at, last_message_at))
);

-- Mensagens: cada lado só lê as que chegaram depois de a conversa ser apagada para ele.
drop policy if exists "mensagens: quem participa lê" on public.messages;
create policy "mensagens: quem participa lê" on public.messages for select using (
  exists (
    select 1 from public.conversations c
    where c.id = conversation_id and (
      (c.customer_id = auth.uid() and messages.created_at > coalesce(public.conv_cutoff(c.customer_deleted_at, c.customer_archived_at), '-infinity'))
      or (public.is_admin() and messages.created_at > coalesce(public.conv_cutoff(c.admin_deleted_at, c.admin_archived_at), '-infinity'))
    )
  )
);

-- Arquiva (p_archive = true) ou desarquiva (false) para quem chamou. Arquivar também marca como lida.
create or replace function public.archive_conversation(p_conv uuid, p_archive boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.'; end if;
  select customer_id into v_customer from public.conversations where id = p_conv;
  if v_customer is null then raise exception 'Conversa não encontrada.'; end if;
  if v_customer = auth.uid() then
    update public.conversations set
      customer_archived_at = case when p_archive then now() end,
      customer_read_at = case when p_archive then now() else customer_read_at end
    where id = p_conv;
  elsif public.is_admin() then
    update public.conversations set
      admin_archived_at = case when p_archive then now() end,
      admin_read_at = case when p_archive then now() else admin_read_at end
    where id = p_conv;
  else
    raise exception 'Conversa não encontrada.';
  end if;
end $$;
revoke execute on function public.archive_conversation(uuid, boolean) from anon, public;
grant execute on function public.archive_conversation(uuid, boolean) to authenticated;

-- Abrir conversa sobre uma foto: reaproveita a que o cliente ainda vê; se ele apagou a antiga, abre outra.
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
    where customer_id = auth.uid() and product_id is not distinct from p_product and photo_url = p_photo
      and public.conv_visible(customer_deleted_at, customer_archived_at, last_message_at)
    order by created_at desc limit 1;
  if v_id is null then
    insert into conversations (product_id, photo_url, title, customer_id)
      values (p_product, p_photo, v_title, auth.uid()) returning id into v_id;
  else
    update conversations set customer_archived_at = null where id = v_id; -- reabriu: sai do arquivo
  end if;
  return v_id;
end $$;

-- Mensagem nova: atualiza o resumo, desarquiva dos dois lados e avisa no celular.
create or replace function public.messages_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update conversations c set
    last_message = left(new.body, 140),
    last_message_at = new.created_at,
    last_sender = new.sender_id,
    customer_archived_at = null,
    admin_archived_at = null,
    customer_read_at = case when c.customer_id = new.sender_id then new.created_at else c.customer_read_at end,
    admin_read_at = case when c.customer_id = new.sender_id then c.admin_read_at else new.created_at end
  where c.id = new.conversation_id;
  perform public.call_push_hook(jsonb_build_object('type', 'message', 'id', new.id));
  return new;
end $$;

-- Limpeza diária: arquivadas há mais de 30 dias viram apagadas; apagadas pelos dois lados saem do banco.
create or replace function public.purge_archived_conversations()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  update public.conversations set customer_deleted_at = customer_archived_at, customer_archived_at = null
    where customer_archived_at <= now() - interval '30 days';
  update public.conversations set admin_deleted_at = admin_archived_at, admin_archived_at = null
    where admin_archived_at <= now() - interval '30 days';
  delete from public.conversations
    where customer_deleted_at >= last_message_at and admin_deleted_at >= last_message_at;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke execute on function public.purge_archived_conversations() from anon, public, authenticated;

create extension if not exists pg_cron;
select cron.unschedule('limpar-conversas-arquivadas') where exists (select 1 from cron.job where jobname = 'limpar-conversas-arquivadas');
select cron.schedule('limpar-conversas-arquivadas', '0 9 * * *', $$select public.purge_archived_conversations()$$);
