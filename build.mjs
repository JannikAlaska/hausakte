// Bundles src/ into one HTML page for the artifact (dist/index.html), a local test page (dist/test.html)
// and the self-hosted site for Vercel (web/index.html, talks to Supabase).
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
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
const ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%23c2410c'/%3E%3Cpath d='M16 31 32 18l16 13v15a2 2 0 0 1-2 2H38V37H26v11h-8a2 2 0 0 1-2-2z' fill='none' stroke='%23fff' stroke-width='4' stroke-linejoin='round'/%3E%3C/svg%3E";
function webDoc({ supabase, ...libs }) {
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
<meta name="theme-color" content="#f4efe8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#16130f" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="robots" content="noindex">
<link rel="icon" href="${ICON}">
${html.slice(0, at)}</head>
<body>
${html.slice(at)}</body>
</html>
`;
}
const web = path.join(root, 'web');
fs.mkdirSync(web, { recursive: true });
fs.writeFileSync(
  path.join(web, 'index.html'),
  webDoc({
    supabase: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js',
    react: 'https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js',
    reactDom: 'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js',
    three: 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
    addons: 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/',
  }),
);
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
