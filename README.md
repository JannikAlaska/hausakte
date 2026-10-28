# Hausakte

Web-App zur Renovierung und Modernisierung eines Hauses: 3D-Modell (Three.js) mit Etagen und editierbaren
Grundrissen, Bauteile aller Gewerke, Verbräuche, Modernisierungsprojekte mit Zeitplan, Abhängigkeiten,
Kosten, Förderung und Dokumenten – mit KI-Hinweisen (Claude).

## Aufbau

- `src/` – App (React 18 + Three.js, ohne Framework), gebaut mit esbuild in `build.mjs`
- `web/index.html` – Build für das eigene Hosting (Vercel), spricht mit Supabase
- `dist/index.html` – Build als claude.ai-Artifact
- `supabase/migrations/` – Tabellen, Zugriffsregeln (RLS), Datei-Bucket, Einladungs-Trigger
- `supabase/functions/ai` – KI-Proxy (Claude), braucht das Secret `ANTHROPIC_API_KEY`
- `supabase/functions/signup` – Konto anlegen mit Einladungscode

## Betrieb

- **Vercel:** Projekt mit diesem Repository verbinden; `vercel.json` setzt Build (`npm run build`) und
  Ausgabeordner (`web`). Supabase-URL und Publishable Key stehen in `build.mjs` (oder per
  `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` als Umgebungsvariablen).
- **Supabase:** Migration einspielen, beide Functions mit `verify_jwt = false` deployen (sie prüfen selbst),
  unter *Edge Functions → Secrets* `ANTHROPIC_API_KEY` setzen, unter *Authentication → URL Configuration*
  die Vercel-Adresse als Site URL eintragen (für „Passwort vergessen“).
- **Zugang:** Nur eingeladene E-Mail-Adressen können ein Konto anlegen. Einladungen erstellt man in der
  App unter *Dokumente → Konto & Zugriff*.

```bash
npm ci
npm run build
```
