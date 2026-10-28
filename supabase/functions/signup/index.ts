// Legt ein Konto für eine eingeladene E-Mail-Adresse an. Der Datenbank-Trigger hausakte_check_invite
// prüft den Einladungscode; ohne gültigen Code wird kein Konto erstellt. Keine Bestätigungs-E-Mail nötig.
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

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
  if (!/^\S+@\S+\.\S+$/.test(email) || invite.length < 8) return reply({ code: "not_allowed" }, 403);
  if (password.length < 8) return reply({ code: "weak_password", message: "Password should be at least 8 characters" }, 400);

  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { invite } });
  if (!error) return reply({ ok: true });
  if (/already|exists|registered/i.test(error.message)) return reply({ code: "exists", message: "User already registered" }, 409);
  if (/password/i.test(error.message)) return reply({ code: "weak_password", message: error.message }, 400);
  // the invite trigger rejected the account (wrong code, wrong address or expired)
  return reply({ code: "not_allowed" }, 403);
});
