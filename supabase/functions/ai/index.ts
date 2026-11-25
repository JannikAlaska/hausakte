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

// Browsers may call this only from the Hausakte site (production, its aliases and preview builds).
const ORIGINS = [/^https:\/\/hausakte-eight\.vercel\.app$/, /^https:\/\/hausakte(-[a-z0-9-]+)?-jannik7\.vercel\.app$/];
const corsFor = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && ORIGINS.some((r) => r.test(origin)) ? origin : "https://hausakte-eight.vercel.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
});
// per member: at most 150 model calls an hour and 800 a day (a tool loop counts every round)
const LIMIT_SECONDS = [3600, 86400];
const LIMIT_MAX = [150, 800];

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  const cors = corsFor(req.headers.get("Origin"));
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ code: "bad_request", message: "POST only" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth?.user) return reply({ code: "session_expired", message: "not signed in" }, 401);
  const { data: member } = await admin.from("hausakte_members").select("user_id").eq("user_id", auth.user.id).maybeSingle();
  if (!member) return reply({ code: "not_member", message: "no access to this Hausakte" }, 403);

  // limit per member, so a stolen login cannot run up the bill; if the check itself fails, the call goes ahead
  const { data: allowed, error: limitError } = await admin.rpc("hausakte_rate_take", { p_key: "ai:" + auth.user.id, p_seconds: LIMIT_SECONDS, p_max: LIMIT_MAX });
  if (limitError) console.error(`ai rate check failed: ${limitError.message}`);
  else if (allowed === false) return reply({ code: "quota", message: "AI request limit reached" }, 429);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return reply({ code: "not_configured", message: "ANTHROPIC_API_KEY is not set" }, 503);

  const raw = await req.text();
  if (raw.length > 12_000_000) return reply({ code: "prompt_too_large", message: "request too large" }, 413);
  let body: { messages?: Anthropic.Beta.BetaMessageParam[]; tools?: Anthropic.Beta.BetaTool[]; tier?: string; json?: boolean; web?: boolean };
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

  // Web search and fetch run on Anthropic's side (contact enrichment); the browser only sees the final answer.
  const webTools = body.web
    ? [
        { type: "web_search_20260209", name: "web_search", max_uses: 6, user_location: { type: "approximate", country: "DE" } },
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: 4 },
      ]
    : [];
  const allTools = [...tools, ...webTools] as Anthropic.Beta.BetaToolUnion[];

  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 140_000 });
  // "plain" leaves out the optional extras (server-side fallback, automatic caching); used once when the full
  // request is rejected as invalid, so a change on the API side does not take the whole assistant down
  const create = (turn: Anthropic.Beta.BetaMessageParam[], plain: boolean) =>
    client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      ...(plain ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", cache_control: { type: "ephemeral" } }),
      output_config: { effort: EFFORT[body.tier ?? "default"] ?? "medium" },
      system: SYSTEM + (body.json ? JSON_SYSTEM : ""),
      messages: turn,
      ...(allTools.length ? { tools: allTools } : {}),
    } as Parameters<typeof client.beta.messages.create>[0]) as Promise<Anthropic.Beta.BetaMessage>;
  const run = async (plain: boolean) => {
    let turn = messages;
    const content: Anthropic.Beta.BetaContentBlock[] = [];
    let msg: Anthropic.Beta.BetaMessage | null = null;
    // a long server-side search loop pauses; resending the turn lets it continue where it stopped
    for (let i = 0; i < 4; i++) {
      msg = await create(turn, plain);
      content.push(...msg.content);
      if (msg.stop_reason !== "pause_turn") break;
      turn = [...turn, { role: "assistant", content: msg.content }];
    }
    // The whole content goes back (thinking blocks included) so the browser can replay it unchanged in the tool loop.
    return reply({ content, stop_reason: msg!.stop_reason, model: msg!.model, ...(plain ? { plain: true } : {}) });
  };
  // only the API's own error text and request id are logged, never the prompt
  const log = (where: string, e: unknown) => {
    const err = e as { status?: number; message?: string; requestID?: string };
    console.error(`ai ${where}: status=${err?.status ?? "-"} request=${err?.requestID ?? "-"} ${String(err?.message ?? e).slice(0, 600)}`);
  };
  const tooLargeMsg = (m: string) => /too long|too large|exceeds/i.test(m);
  // the API reports an empty prepaid balance as an invalid request; there is no error class for it
  const noCreditMsg = (m: string) => /credit balance/i.test(m);
  try {
    try {
      return await run(false);
    } catch (e) {
      if (!(e instanceof Anthropic.BadRequestError) || tooLargeMsg(e.message) || noCreditMsg(e.message)) throw e;
      log("rejected, retrying without extras", e);
      return await run(true);
    }
  } catch (e) {
    log("failed", e);
    if (e instanceof Anthropic.RateLimitError) return reply({ code: "rate_limited", message: e.message }, 429);
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      return reply({ code: "not_configured", message: "the Anthropic API key was rejected" }, 503);
    }
    if (e instanceof Anthropic.BadRequestError && noCreditMsg(e.message)) return reply({ code: "no_credit", message: e.message }, 402);
    if (e instanceof Anthropic.BadRequestError) {
      const tooLarge = tooLargeMsg(e.message);
      return reply({ code: tooLarge ? "prompt_too_large" : "bad_request", message: e.message }, tooLarge ? 413 : 400);
    }
    if (e instanceof Anthropic.InternalServerError) return reply({ code: "overloaded", message: e.message }, 503);
    if (e instanceof Anthropic.APIConnectionError) return reply({ code: "upstream_error", message: "Claude is not reachable" }, 502);
    if (e instanceof Anthropic.APIError) return reply({ code: "upstream_error", message: e.message }, 502);
    return reply({ code: "upstream_error", message: String((e as Error)?.message ?? e) }, 500);
  }
});
