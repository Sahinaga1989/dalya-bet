// Supabase Edge Function: dalya-invite-member
// Deploy with JWT verification enabled. Never expose SUPABASE_SERVICE_ROLE_KEY in a web page.
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const headers = {
    "Access-Control-Allow-Origin": "https://sahinaga1989.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
  const reply = (status: number, message: string) =>
    new Response(JSON.stringify({ message }), { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply(405, "Yalnızca POST kabul edilir.");
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anon || !service) return reply(503, "Sunucu yapılandırması eksik.");
    const authorization = req.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) return reply(401, "Oturum gerekli.");
    const caller = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: userError } = await caller.auth.getUser();
    if (userError || !user) return reply(401, "Geçersiz oturum.");
    const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: role, error: roleError } = await admin.from("dalya_admins")
      .select("user_id").eq("user_id", user.id).maybeSingle();
    if (roleError || !role) return reply(403, "Yönetici yetkisi gerekli.");
    const body = await req.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return reply(400, "Geçerli e-posta adresi girin.");
    const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: "https://sahinaga1989.github.io/dalya-bet/uye-sifre-belirle.html",
    });
    if (inviteError) return reply(400, "Davet gönderilemedi. Adres veya davet ayarlarını kontrol edin.");
    return reply(200, "Üyelik daveti gönderildi. Puan yüklemesi ayrı yapılmalıdır.");
  } catch {
    return reply(500, "Davet işlemi tamamlanamadı.");
  }
});
