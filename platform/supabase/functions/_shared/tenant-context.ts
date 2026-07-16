import type { SupabaseClient, User } from "npm:@supabase/supabase-js@2";

export type PlatformRole = "platform_admin" | "owner" | "staff" | "host";

export interface TenantContext {
  id: string;
  slug: string;
  status: string;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function requirePost(request: Request): Response | null {
  if (request.method === "OPTIONS") return jsonResponse({ ok: true });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
  return null;
}

export function tenantSlug(value: unknown): string {
  const slug = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
    throw new Error("A valid tenant slug is required.");
  }
  return slug;
}

export async function authenticatedUser(
  db: SupabaseClient,
  request: Request,
): Promise<User> {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Authentication is required.");
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new Error("Your sign-in session is invalid or expired.");
  return data.user;
}

export async function resolveTenant(
  db: SupabaseClient,
  requestedSlug: unknown,
): Promise<TenantContext> {
  const slug = tenantSlug(requestedSlug);
  const { data, error } = await db
    .from("tenants")
    .select("id,slug,status")
    .eq("slug", slug)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Venue not found.");
  return data as TenantContext;
}

export async function requireTenantRole(
  db: SupabaseClient,
  userId: string,
  tenant: TenantContext,
  allowedRoles: PlatformRole[],
): Promise<PlatformRole> {
  const [{ data: platformAdmin, error: platformError }, { data: membership, error: memberError }] =
    await Promise.all([
      db.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle(),
      db.from("tenant_memberships")
        .select("role,status")
        .eq("tenant_id", tenant.id)
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
  if (platformError) throw platformError;
  if (memberError) throw memberError;

  const role: PlatformRole | null = platformAdmin
    ? "platform_admin"
    : membership?.status === "active"
      ? membership.role as PlatformRole
      : null;
  if (!role || !allowedRoles.includes(role)) {
    throw new Error("You do not have permission for this venue.");
  }
  return role;
}

