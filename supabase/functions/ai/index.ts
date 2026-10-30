// KI-Proxy der Hausakte: prüft die Anmeldung und Mitgliedschaft und leitet die Anfrage an Claude weiter.
// Die Werkzeugschleife läuft im Browser; diese Funktion bearbeitet genau einen Modellaufruf.
// Benötigt das Secret ANTHROPIC_API_KEY (Supabase → Edge Functions → Secrets).
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const MODEL = "claude-opus-5-5";
const EFFORT: Record<string, "low" | "medium" | "high"> = { quick: "low", default: "medium", complex: "high" };
const SYSTEM =
  "Du bist der KI-Assistent der Web-App „Hausakte“, mit der eine Eigentümerin oder ein Eigentümer die Renovierung und Modernisierung eines Wohnhauses in Deutschland plant. Antworte auf Deutsch, sachlich und konkret.";
const JSON_SYSTEM = " Antworte ausschließlich mit einem gültigen JSON-Wert ohne Markdown-Codeblock und ohne Text davor oder danach.";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ code: "bad_request", message: "POST only" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth?.user) return reply({ code: "session_expired", message: "not signed in" }, 401);
  const { data: member } = await admin.from("hausakte_members").select("user_id").eq("user_id", auth.user.id).maybeSingle();
  if (!member) return reply({ code: "not_member", message: "no access to this Hausakte" }, 403);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return reply({ code: "not_configured", message: "ANTHROPIC_API_KEY is not set" }, 503);

  const raw = await req.text();
  if (raw.length > 12_000_000) return reply({ code: "prompt_too_large", message: "request too large" }, 413);
  let body: { messages?: Anthropic.Beta.BetaMessageParam[]; tools?: Anthropic.Beta.BetaTool[]; tier?: string; json?: boolean };
  try {
    body = JSON.parse(raw);
  } catch {
    return reply({ code: "bad_request", message: "invalid JSON" }, 400);
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length || messages.length > 60 || messages[0].role !== "user") {
    return reply({ code: "bad_request", message: "messages must start with a user turn" }, 400);
  }
  const tools = (Array.isArray(body.tools) ? body.tools : [])
    .slice(0, 16)
    .filter((t) => /^[a-zA-Z0-9_-]{1,64}$/.test(t?.name ?? "") && t.input_schema?.type === "object")
    .map((t) => ({ name: t.name, description: String(t.description ?? "").slice(0, 2000), input_schema: t.input_schema }));

  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 120_000 });
  try {
    const msg = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      cache_control: { type: "ephemeral" },
      output_config: { effort: EFFORT[body.tier ?? "default"] ?? "medium" },
      system: SYSTEM + (body.json ? JSON_SYSTEM : ""),
      messages,
      ...(tools.length ? { tools } : {}),
    });
    // The whole content goes back (thinking blocks included) so the browser can replay it unchanged in the tool loop.
    return reply({ content: msg.content, stop_reason: msg.stop_reason, model: msg.model });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return reply({ code: "rate_limited", message: e.message }, 429);
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      return reply({ code: "not_configured", message: "the Anthropic API key was rejected" }, 503);
    }
    if (e instanceof Anthropic.BadRequestError) {
      const tooLarge = /too long|too large|exceeds/i.test(e.message);
      return reply({ code: tooLarge ? "prompt_too_large" : "bad_request", message: e.message }, tooLarge ? 413 : 400);
    }
    if (e instanceof Anthropic.InternalServerError) return reply({ code: "overloaded", message: e.message }, 503);
    if (e instanceof Anthropic.APIConnectionError) return reply({ code: "upstream_error", message: "Claude is not reachable" }, 502);
    if (e instanceof Anthropic.APIError) return reply({ code: "upstream_error", message: e.message }, 502);
    return reply({ code: "upstream_error", message: String((e as Error)?.message ?? e) }, 500);
  }
});
