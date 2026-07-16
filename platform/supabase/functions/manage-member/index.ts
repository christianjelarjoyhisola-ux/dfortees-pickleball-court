import { createClient } from "npm:@supabase/supabase-js@2";
import {
  authenticatedUser,
  jsonResponse,
  requirePost,
  requireTenantRole,
  resolveTenant,
} from "../_shared/tenant-context.ts";

type MemberRole = "owner" | "staff" | "host";
type MemberStatus = "invited" | "active" | "disabled";

Deno.serve(async (request) => {
  const early = requirePost(request);
  if (early) return early;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Function environment is incomplete.");

    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const caller = await authenticatedUser(db, request);
    const body = await request.json();
    const tenant = await resolveTenant(db, body.tenantSlug);
    await requireTenantRole(db, caller.id, tenant, ["platform_admin", "owner"]);

    const action = String(body.action || "").trim().toLowerCase();
    if (action === "invite") {
      const email = String(body.email || "").trim().toLowerCase();
      const displayName = String(body.displayName || "").trim();
      const role = String(body.role || "staff") as MemberRole;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("A valid email is required.");
      if (!(["owner", "staff", "host"] as string[]).includes(role)) throw new Error("Invalid member role.");

      const { data: invitation, error: inviteError } = await db.auth.admin.inviteUserByEmail(email, {
        data: { display_name: displayName || email.split("@")[0] },
      });
      if (inviteError) throw inviteError;
      const userId = invitation.user?.id;
      if (!userId) throw new Error("The invitation did not create a user.");

      const { error: profileError } = await db.from("profiles").upsert({
        user_id: userId,
        email,
        display_name: displayName || email.split("@")[0],
      });
      if (profileError) throw profileError;
      const { error: membershipError } = await db.from("tenant_memberships").upsert({
        tenant_id: tenant.id,
        user_id: userId,
        role,
        // Authentication still requires the emailed invitation link, so the
        // membership can be active without granting access before acceptance.
        status: "active",
      });
      if (membershipError) throw membershipError;
      return jsonResponse({ ok: true, userId, tenantSlug: tenant.slug, status: "active" }, 201);
    }

    const userId = String(body.userId || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("A valid member is required.");

    if (action === "update") {
      const role = String(body.role || "staff") as MemberRole;
      const status = String(body.status || "active") as MemberStatus;
      if (!(["owner", "staff", "host"] as string[]).includes(role)) throw new Error("Invalid member role.");
      if (!(["invited", "active", "disabled"] as string[]).includes(status)) throw new Error("Invalid member status.");
      const { error } = await db.from("tenant_memberships")
        .update({ role, status })
        .eq("tenant_id", tenant.id)
        .eq("user_id", userId);
      if (error) throw error;
      return jsonResponse({ ok: true, userId, tenantSlug: tenant.slug, role, status });
    }

    if (action === "remove") {
      if (userId === caller.id) throw new Error("You cannot remove your own active membership.");
      const { error } = await db.from("tenant_memberships")
        .delete()
        .eq("tenant_id", tenant.id)
        .eq("user_id", userId);
      if (error) throw error;
      return jsonResponse({ ok: true, userId, tenantSlug: tenant.slug, removed: true });
    }

    throw new Error("Unsupported member action.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Member request failed.";
    const status = /Authentication|session/i.test(message) ? 401
      : /permission/i.test(message) ? 403
      : 400;
    return jsonResponse({ error: message }, status);
  }
});
