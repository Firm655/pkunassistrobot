// register-caregiver: a new caregiver creates their own account with a team code from an administrator.
//
// POST { "full_name": "...", "email": "...", "password": "...", "team_code": "K7QM-4TZP" }
//   200 { "ok": true }                       -> the dashboard then signs in with the same email and password
//   400 { "error" }  bad input / wrong or expired team code      409 { "error" }  email already registered
//   429 { "error" }  too many wrong codes
//
// Public sign-ups stay OFF: an account is created only after the team code is checked, server side, with the
// service role. The account is created already confirmed (no confirmation email) and only ever gets the
// 'caretaker' role in the code's organization. If anything fails after creation, the account is deleted.
//
// Deploy:  supabase functions deploy register-caregiver --no-verify-jwt
// (--no-verify-jwt because the person has no session yet; the team code is the credential.)
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  const fullName = String(body.full_name ?? "").trim().slice(0, 120);
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const teamCode = String(body.team_code ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

  if (!fullName) return json({ error: "Enter your full name." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json({ error: "Enter a valid email address." }, 400);
  if (password.length < 8 || password.length > 72) return json({ error: "Password must be 8–72 characters." }, 400);
  if (teamCode.length !== 8) return json({ error: "The team code has 8 characters, e.g. K7QM-4TZP." }, 400);

  const clientKey = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Check the team code (wrong codes are counted and rate limited in the database).
  const { data: valid, error: checkError } = await admin.rpc("check_team_code", { team_code: teamCode, client_key: clientKey });
  if (checkError) {
    const limited = checkError.code === "42501";
    if (!limited) console.error("check_team_code failed", checkError);
    return json({ error: limited ? checkError.message : "Registration is unavailable. Try again." }, limited ? 429 : 500);
  }
  if (!valid) return json({ error: "Wrong or expired team code. Ask your administrator for the current code." }, 400);

  // 2. Create the account, already confirmed.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (createError || !created?.user) {
    const exists = /already|registered|exists/i.test(createError?.message ?? "");
    if (!exists) console.error("createUser failed", createError);
    return exists
      ? json({ error: "This email is already registered. Sign in instead." }, 409)
      : json({ error: createError?.message ?? "Could not create the account. Try again." }, 400);
  }

  // 3. Join the team (atomic in the database). Never leave an account without a profile behind.
  const { data: orgId, error: redeemError } = await admin.rpc("redeem_team_code", {
    team_code: teamCode,
    new_user_id: created.user.id,
    full_name: fullName,
  });
  if (redeemError || !orgId) {
    await admin.auth.admin.deleteUser(created.user.id);
    if (redeemError) console.error("redeem_team_code failed", redeemError);
    return redeemError
      ? json({ error: "Registration failed. Try again." }, 500)
      : json({ error: "That team code has just expired or been replaced. Ask for the current code." }, 400);
  }
  return json({ ok: true });
});
