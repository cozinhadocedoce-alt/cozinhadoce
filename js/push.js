// Notificações no celular (Web Push): só inscreve o aparelho. O envio sai do Supabase (função enviar-push).
import { CONFIG } from './config.js';

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// 'ok' | 'ios-instalar' (iPhone só recebe com o app na tela de início) | 'sem-chave' | 'sem-suporte'
export function pushSupport() {
  if (isIOS() && !isStandalone()) return 'ios-instalar';
  if (!('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window)) return 'sem-suporte';
  if (!CONFIG.VAPID_PUBLIC_KEY) return 'sem-chave';
  return 'ok';
}

const keyBytes = (b64) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function pushActive() {
  if (pushSupport() !== 'ok' || Notification.permission !== 'granted') return false;
  return !!(await currentSubscription());
}

// Precisa vir de um toque. Devolve 'ativo' | 'negado' | o motivo de pushSupport().
export async function enablePush(api) {
  const support = pushSupport();
  if (support !== 'ok') return support;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'negado';
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(CONFIG.VAPID_PUBLIC_KEY) }));
  await api.savePushSubscription(sub);
  return 'ativo';
}

export async function disablePush(api) {
  if (pushSupport() !== 'ok') return;
  const sub = await currentSubscription();
  if (!sub) return;
  await api.removePushSubscription(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
}

// Ao entrar: se o aparelho já tinha aceitado, garante que a inscrição está nesta conta.
export async function syncPush(api) {
  if (await pushActive()) await api.savePushSubscription(await currentSubscription()).catch(() => {});
}
