// Preencha com os dados do seu projeto Supabase (Project Settings > API).
// A chave "anon"/"publishable" é pública por natureza: a segurança vem das regras RLS do supabase/schema.sql.
// Enquanto SUPABASE_URL tiver "SEU-PROJETO", o app roda em MODO DEMONSTRAÇÃO (dados só neste navegador).
export const CONFIG = {
  SUPABASE_URL: 'https://qaurhdtozcfwjhdvwysd.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_gVCeFcUEkc8s9RWhIgRacA_xQaTF4PC',
  // Chave pública das notificações (gere com: npx web-push generate-vapid-keys). A privada vai só para o Supabase.
  VAPID_PUBLIC_KEY: '',
};
