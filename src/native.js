// Android app (WebView around this page): home screen widgets get their figures from here, widgets and
// launcher shortcuts send commands ("aktion:todo", "ansicht:grundriss"), and the back key closes what is open.
import { getUI, setUI, go, closeDrawer } from './ui/state.js';
import { agenda, invoicesSummary, progress, attention } from './cockpit.js';
import { liveProjects, isDone } from './metrics.js';
import { invOf } from './invoices.js';
import { todayISO, isISO } from './util.js';
import { setPendingAction } from './pwa.js';

const A = typeof window !== 'undefined' ? window.HausakteAndroid : null;
export const isAndroidApp = !!A;
export const appVersion = () => {
  try {
    return A?.version() || null;
  } catch {
    return null;
  }
};

// what the widgets show (see android/.../WidgetData.java)
export function widgetPayload(data, today = todayISO()) {
  const ag = agenda(data, today);
  const inv = invoicesSummary(data, today);
  const pr = progress(data, today);
  const open = liveProjects(data.projects).filter((p) => !isDone(p));
  const todos = open.flatMap((p) => (p.constraints || []).filter((c) => !c.done && (c.text || '').trim()));
  const item = (x) => ({ date: x.date, title: x.title, sub: x.sub || '', kind: x.kind });
  return {
    v: 1,
    at: Date.now(),
    house: data.house?.name || '',
    today: ag.today.slice(0, 4).map((x) => ({ title: x.title, sub: x.sub || '' })),
    next: [...ag.soon, ...ag.more, ...ag.funding].filter((x) => x.date > today).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 8).map(item),
    invoices: { open: inv.sums.open, openN: inv.sums.openN, overdue: inv.sums.overdue, overdueN: inv.sums.overdueN, nextDue: inv.nextDue ? invOf(inv.nextDue).due : null },
    todos: todos.length,
    todosLate: todos.filter((c) => isISO(c.due) && c.due < today).length,
    progress: { done: pr.done, total: pr.total },
    attention: attention(data, today).length,
  };
}

let last = '';
let timer = null;
export function pushWidgets(data) {
  if (!A || !data?.loaded || !data.house) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      const p = widgetPayload(data);
      const key = JSON.stringify({ ...p, at: 0 });
      if (key === last) return;
      last = key;
      A.setWidgetData(JSON.stringify(p));
    } catch {}
  }, 1500);
}

// text file to the phone's Downloads (instead of a browser download)
export function saveTextFile(name, mime, text) {
  if (!A) return false;
  try {
    A.saveText(name, mime, text);
    return true;
  } catch {
    return false;
  }
}

if (A) {
  document.documentElement.classList.add('is-android-app');
  window.__hausakteCommand = (cmd) => {
    const [kind, arg] = String(cmd || '').split(':');
    if (kind === 'aktion') {
      setPendingAction(arg);
      if (getUI().drawer) closeDrawer();
      go('cockpit');
      window.dispatchEvent(new CustomEvent('hausakte-aktion', { detail: arg }));
    } else if (kind === 'ansicht') {
      if (getUI().drawer) closeDrawer();
      go(arg);
    }
    return true;
  };
  window.__hausakteBack = () => {
    const u = getUI();
    if (document.querySelector('.more-menu')) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      return true;
    }
    if (u.drawer) {
      closeDrawer();
      return true;
    }
    if (u.selection) {
      setUI({ selection: null });
      return true;
    }
    if (u.view !== 'cockpit') {
      go('cockpit');
      return true;
    }
    return false;
  };
}
