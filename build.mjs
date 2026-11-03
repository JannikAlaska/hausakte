// Bundles src/ into one HTML page for the artifact (dist/index.html), a local test page (dist/test.html)
// and the self-hosted site for Vercel (web/index.html, talks to Supabase).
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createTemplate } from './src/template.js';

const root = path.dirname(new URL(import.meta.url).pathname);
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });

const minify = !process.argv.includes('--dev');
const result = await esbuild.build({
  entryPoints: [path.join(root, 'src/main.jsx')],
  bundle: true,
  write: false,
  format: 'esm',
  target: 'es2020',
  minify,
  sourcemap: false,
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  loader: { '.jsx': 'jsx' },
  external: ['three', 'three/addons/*'],
  legalComments: 'none',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');

const FONTS =
  'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700&family=Figtree:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap';

function page({ react, reactDom, three, addons, fonts = true, head = '' }) {
  return `<title>Hausakte</title>${head}
<meta name="claude:viewport-fit-sides" content="cover">
${fonts ? `<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link rel="stylesheet" href="${FONTS}">` : ''}
<style>
${css}
</style>
<div id="app" class="app-root"><div class="boot"><div class="boot-mark"></div><p>Hausakte wird geladen …</p></div></div>
<script src="${react}"></script>
<script src="${reactDom}"></script>
<script type="importmap">{"imports":{"three":"${three}","three/addons/":"${addons}"}}</script>
<script type="module">
${js}
</script>
`;
}

const prod = page({
  react: 'https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js',
  reactDom: 'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js',
  three: 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
  addons: 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/',
});
fs.writeFileSync(path.join(dist, 'index.html'), prod);

const skeleton = (body) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${body}</body></html>`;
const test = page({
  react: '/node_modules/react/umd/react.production.min.js',
  reactDom: '/node_modules/react-dom/umd/react-dom.production.min.js',
  three: '/node_modules/three/build/three.module.js',
  addons: '/node_modules/three/examples/jsm/',
  fonts: false,
});
fs.writeFileSync(path.join(dist, 'test.html'), skeleton(test));

// ---------- self-hosted site (Vercel + Supabase) ----------
// The publishable key is meant for browsers; access is enforced by row level security.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kowakeiwjrwiqoshwiun.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_au_XPVxgIjzU4rrQa7Ev9Q_RgEl29ki';
// installable app (PWA): manifest, icons and service worker come from public/
// iPad start screens (light and dark) for the app added to the home screen
const SPLASH = JSON.parse(fs.readFileSync(path.join(root, 'public/splash/splash.json'), 'utf8'))
  .map((x) => `<link rel="apple-touch-startup-image" media="${x.media}" href="${x.href}">`)
  .join('\n');
function webDoc({ supabase, sw = true, ...libs }) {
  const head = `
<script>window.HAUSAKTE_CONFIG = ${JSON.stringify({ supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_KEY })};</script>
<script src="${supabase}"></script>`;
  const html = page({ ...libs, head });
  const at = html.indexOf('<div id="app"');
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1c2131" media="(prefers-color-scheme: dark)">
<meta name="robots" content="noindex">
<meta name="application-name" content="Hausakte">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Hausakte">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="format-detection" content="telephone=no">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<link rel="icon" href="/icons/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
${SPLASH}
${sw ? `<script>if ('serviceWorker' in navigator && window.isSecureContext && !/^(127\\.|localhost$)/.test(location.hostname)) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));</script>\n` : ''}${html.slice(0, at)}</head>
<body>
${html.slice(at)}</body>
</html>
`;
}
const web = path.join(root, 'web');
fs.mkdirSync(web, { recursive: true });
const WEB_LIBS = {
  supabase: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js',
  react: 'https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js',
  reactDom: 'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js',
  three: 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
  addons: 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/',
};
fs.writeFileSync(path.join(web, 'index.html'), webDoc(WEB_LIBS));
// every three.js addon the code imports, for the service worker's offline copy
const addonFiles = new Set();
const scan = (dir) => {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) scan(p);
    else if (/\.(js|jsx)$/.test(f)) for (const m of fs.readFileSync(p, 'utf8').matchAll(/from 'three\/addons\/([^']+)'/g)) addonFiles.add(m[1]);
  }
};
scan(path.join(root, 'src'));
const LIB_URLS = [WEB_LIBS.supabase, WEB_LIBS.react, WEB_LIBS.reactDom, WEB_LIBS.three, ...[...addonFiles].map((f) => WEB_LIBS.addons + f), FONTS];
// static files of the installed app; the service worker gets the build hash so a new build replaces its cache
const pub = path.join(root, 'public');
const copyDir = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) {
    const a = path.join(from, f),
      b = path.join(to, f);
    if (fs.statSync(a).isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
};
copyDir(pub, web);
const version = crypto.createHash('sha256').update(fs.readFileSync(path.join(web, 'index.html'))).digest('hex').slice(0, 12);
fs.writeFileSync(path.join(web, 'sw.js'), fs.readFileSync(path.join(pub, 'sw.js'), 'utf8').replace('__VERSION__', version).replace('__LIBS__', JSON.stringify(LIB_URLS, null, 1)));

// local test of the self-hosted site against a mock client (see scripts in the scratchpad)
fs.writeFileSync(
  path.join(dist, 'test-web.html'),
  webDoc({
    supabase: '/dist/mock-supabase.js',
    react: '/node_modules/react/umd/react.production.min.js',
    reactDom: '/node_modules/react-dom/umd/react-dom.production.min.js',
    three: '/node_modules/three/build/three.module.js',
    addons: '/node_modules/three/examples/jsm/',
    fonts: false,
  }),
);

// seed data (example house, and the private house data set when present - it is not in git)
fs.writeFileSync(path.join(dist, 'seed.json'), JSON.stringify(createTemplate(), null, 1));
const priv = path.join(root, 'src/house-private.js');
if (fs.existsSync(priv)) {
  const { createHouse } = await import(priv);
  const wil = createHouse();
  fs.writeFileSync(path.join(dist, 'seed-house.json'), JSON.stringify(wil, null, 1));
  // localStorage snapshot for local testing
  const snap = { house: wil.house };
  for (const c of ['floors', 'components', 'projects', 'readings', 'documents', 'underlays']) snap[c] = Object.fromEntries((wil[c] || []).map((d) => [d.id, d]));
  fs.writeFileSync(path.join(dist, 'ls-house.json'), JSON.stringify(snap));
}

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('index.html', kb(Buffer.byteLength(prod)), '| js', kb(Buffer.byteLength(js)), '| css', kb(Buffer.byteLength(css)));
