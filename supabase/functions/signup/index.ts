// Legt ein Konto für eine eingeladene E-Mail-Adresse an. Die Funktion prüft zuerst den Einladungscode
// (der Datenbank-Trigger hausakte_check_invite prüft ihn beim Anlegen noch einmal); ohne gültigen Code
// verrät sie nichts darüber, ob es zu einer Adresse schon ein Konto gibt. Keine Bestätigungs-E-Mail nötig.
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const ORIGINS = [/^https:\/\/hausakte-eight\.vercel\.app$/, /^https:\/\/hausakte(-[a-z0-9-]+)?-jannik7\.vercel\.app$/];
const corsFor = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && ORIGINS.some((r) => r.test(origin)) ? origin : "https://hausakte-eight.vercel.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
});
const MIN_PASSWORD = 10;

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha = async (algo: "SHA-1" | "SHA-256", text: string) => hex(await crypto.subtle.digest(algo, new TextEncoder().encode(text)));
// compares two hex digests without revealing through timing where they differ
const sameDigest = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Is the password in a known data breach? Only the first 5 characters of its SHA-1 leave the server
// (k-anonymity, haveibeenpwned.com). When the service cannot be reached, the check is skipped.
async function pwned(password: string) {
  try {
    const h = (await sha("SHA-1", password)).toUpperCase();
    const res = await fetch(`https://api.pwnedpasswords.com/range/${h.slice(0, 5)}`, {
      headers: { "Add-Padding": "true", "User-Agent": "hausakte-signup" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const rest = h.slice(5);
    return (await res.text()).split("\n").some((line) => {
      const [suffix, count] = line.trim().split(":");
      return suffix === rest && Number(count) > 0;
    });
  } catch {
    return false;
  }
}

// counts an attempt; false once the key is over its limits (if the check itself fails, it lets the attempt through)
async function take(key: string, seconds: number[], max: number[]) {
  const { data, error } = await admin.rpc("hausakte_rate_take", { p_key: key, p_seconds: seconds, p_max: max });
  if (error) {
    console.error(`signup rate check failed: ${error.message}`);
    return true;
  }
  return data !== false;
}

Deno.serve(async (req) => {
  const cors = corsFor(req.headers.get("Origin"));
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ code: "bad_request" }, 405);
  let input: { email?: string; password?: string; invite?: string };
  try {
    input = await req.json();
  } catch {
    return reply({ code: "bad_request" }, 400);
  }
  const email = String(input.email ?? "").trim().toLowerCase();
  const password = String(input.password ?? "");
  const invite = String(input.invite ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

  // at most 10 attempts an hour and 30 a day per network address, 5 an hour per e-mail address
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const okIp = await take("signup-ip:" + (await sha("SHA-256", ip)), [3600, 86400], [10, 30]);
  const okMail = await take("signup-mail:" + (await sha("SHA-256", email)), [3600], [5]);
  if (!okIp || !okMail) return reply({ code: "rate_limited", message: "Too many attempts" }, 429);

  const denied = async () => {
    await pause(400 + Math.random() * 300);
    return reply({ code: "not_allowed" }, 403);
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || invite.length < 8 || invite.length > 64) return denied();

  // the invite must exist for exactly this address, be unexpired and match the code
  const { data: inv } = await admin.from("hausakte_invites").select("code_hash, expires_at").eq("email", email).maybeSingle();
  const valid = !!inv && new Date(inv.expires_at).getTime() > Date.now() && sameDigest(String(inv.code_hash), await sha("SHA-256", invite));
  if (!valid) return denied();

  if (password.length < MIN_PASSWORD || password.length > 200) {
    return reply({ code: "weak_password", message: `Password should be at least ${MIN_PASSWORD} characters` }, 400);
  }
  if (await pwned(password)) return reply({ code: "pwned", message: "Password appears in known data breaches" }, 400);

  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { invite } });
  if (!error) return reply({ ok: true });
  if (/already|exists|registered/i.test(error.message)) return reply({ code: "exists", message: "User already registered" }, 409);
  if (/password/i.test(error.message)) return reply({ code: "weak_password", message: error.message }, 400);
  // the invite trigger rejected the account (it checks the code a second time)
  return denied();
});
