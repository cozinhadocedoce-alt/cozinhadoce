-- =====================================================================
-- Cozinha Doce — saudação do Início editável
-- Cole no SQL Editor do Supabase e clique em Run (pode rodar de novo).
-- O administrador muda em Menu → Aparência. Na pergunta, a palavra entre
-- *asteriscos* aparece na cor do app (ex.: O que vai *adoçar* seu dia?).
-- =====================================================================

alter table public.app_settings
  add column if not exists greet_hello text not null default 'Olá'
    check (length(greet_hello) between 1 and 30),
  add column if not exists greet_text text not null default 'O que vai *adoçar* seu dia?'
    check (length(greet_text) between 1 and 80);
