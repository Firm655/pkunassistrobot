// claim-device: pair a new P-kun with only a 6-digit code (no email account per robot).
//
// POST { "pairing_code": "482913", "device_name": "P-kun" }
//   200 { "device_id", "email", "password" }   -> the Pi stores these and signs in normally
//   400 { "error" }  wrong/expired code or bad input      429 { "error" }  too many wrong codes
//
// Only a valid, unused code (created by an administrator on the dashboard) leads to an account being created.
// The account gets an internal address on a reserved domain that can never receive mail, is created already
// confirmed, and has a long random password known only to that Pi. Public sign-ups and anonymous sign-ins stay
// off. The service-role key is used only here, on the server; it never reaches the Pi.
//
// Deploy:  supabase functions deploy claim-device --no-verify-jwt
// (--no-verify-jwt because an unpaired Pi has no user session yet; the pairing code is the credential.)
import { createClient } from "npm:@supabase/supabase-js@2";

const DEVICE_EMAIL_DOMAIN = "devices.pkun.invalid"; // ".invalid" is reserved: mail can never be delivered

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function randomPassword(bytes = 36): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  let body: { pairing_code?: unknown; device_name?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  const code = String(body.pairing_code ?? "").replace(/\D/g, "");
  const deviceName = String(body.device_name ?? "P-kun").trim().slice(0, 100) || "P-kun";
  if (code.length !== 6) return json({ error: "The code has 6 digits." }, 400);

  // Per-client rate limiting key (first address in x-forwarded-for, set by Supabase's gateway).
  const clientKey = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Is the code valid? (Wrong codes are counted and rate limited in the database.)
  const { data: valid, error: checkError } = await admin.rpc("check_pairing_code", {
    pairing_code: code,
    client_key: clientKey,
  });
  if (checkError) {
    const limited = checkError.code === "42501";
    if (!limited) console.error("check_pairing_code failed", checkError);
    return json({ error: limited ? checkError.message : "Pairing is unavailable. Try again." }, limited ? 429 : 500);
  }
  if (!valid) return json({ error: "Wrong or expired code. Ask for a new code and try again." }, 400);

  // 2. Create the device's own account (confirmed, internal address, random password).
  const email = `device-${crypto.randomUUID()}@${DEVICE_EMAIL_DOMAIN}`;
  const password = randomPassword();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { pkun_device: true },
    user_metadata: { device_name: deviceName },
  });
  if (createError || !created?.user) {
    console.error("createUser failed", createError);
    return json({ error: "Could not create the device account. Try again." }, 500);
  }

  // 3. Consume the code and register the device in one transaction.
  const { data: deviceId, error: redeemError } = await admin.rpc("redeem_pairing_code", {
    pairing_code: code,
    device_user_id: created.user.id,
    device_name: deviceName,
  });
  if (redeemError || !deviceId) {
    await admin.auth.admin.deleteUser(created.user.id); // never leave an unused account behind
    if (redeemError) console.error("redeem_pairing_code failed", redeemError);
    return redeemError
      ? json({ error: "Pairing failed. Try again." }, 500)
      : json({ error: "That code was just used or has expired. Ask for a new code." }, 400);
  }

  return json({ device_id: deviceId, email, password });
});
