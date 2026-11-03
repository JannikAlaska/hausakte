// Installing the web version as an app: Android/Chrome offers its own install dialog (captured here),
// on iPad/iPhone it is "Share > Add to Home Screen" in Safari.
import { isSupabaseMode } from './supa.js';

let deferred = null;
let installed = false;
const subs = new Set();
const notify = () => subs.forEach((f) => f());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    notify();
  });
}

export const isAndroid = () => typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
const inNativeApp = () => typeof window !== 'undefined' && !!window.HausakteAndroid;
export const isStandalone = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);
export const isAppleMobile = () => typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

const DISMISS = 'hausakte-install-hint';
export function installHintDismissed() {
  try {
    const t = Number(localStorage.getItem(DISMISS) || 0);
    return Date.now() - t < 30 * 864e5;
  } catch {
    return false;
  }
}
export function dismissInstallHint() {
  try {
    localStorage.setItem(DISMISS, String(Date.now()));
  } catch {}
  notify();
}

// what the install hint can offer right now: 'prompt' (Chrome's install dialog), 'android' (the APK),
// 'apple' (instructions) or null
export function installMode() {
  if (!isSupabaseMode() || installed || isStandalone() || inNativeApp()) return null;
  if (isAndroid()) return 'android';
  if (deferred) return 'prompt';
  if (isAppleMobile()) return 'apple';
  return null;
}
export const canPromptInstall = () => !!deferred;

export async function promptInstall() {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  e.prompt();
  const choice = await e.userChoice.catch(() => null);
  notify();
  return choice?.outcome === 'accepted';
}

export function useInstall() {
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const f = () => tick((n) => n + 1);
    subs.add(f);
    return () => subs.delete(f);
  }, []);
  return { mode: installHintDismissed() ? null : installMode(), canPrompt: !!deferred, prompt: promptInstall, dismiss: dismissInstallHint };
}

// an action sent by the Android app (widget) while the page was already open
let pendingAction = null;
export function setPendingAction(a) {
  pendingAction = ['rechnung', 'notiz', 'todo'].includes(a) ? a : null;
}

// app shortcuts (long press on the app icon): ?aktion=rechnung|notiz|todo - read once, then removed from the address
export function takeShortcut() {
  if (pendingAction) {
    const a = pendingAction;
    pendingAction = null;
    return a;
  }
  if (typeof location === 'undefined') return null;
  const p = new URLSearchParams(location.search);
  const a = p.get('aktion');
  if (!a) return null;
  p.delete('aktion');
  const q = p.toString();
  try {
    history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
  } catch {}
  return ['rechnung', 'notiz', 'todo'].includes(a) ? a : null;
}
