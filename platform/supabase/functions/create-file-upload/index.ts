import { createClient } from "npm:@supabase/supabase-js@2";
import { jsonResponse, requirePost, resolveTenant } from "../_shared/tenant-context.ts";

const MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

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

    const body = await request.json();
    const tenant = await resolveTenant(db, body.tenantSlug);
    const bookingReference = String(body.bookingReference || "").trim().toUpperCase();
    const accessToken = String(body.accessToken || "").trim();
    const mimeType = String(body.mimeType || "").trim().toLowerCase();
    const extension = MIME_EXTENSIONS[mimeType];
    if (!/^DF-[0-9A-F]{10}$/.test(bookingReference)) throw new Error("Invalid booking reference.");
    if (!/^[0-9a-f-]{36}$/i.test(accessToken)) throw new Error("Invalid booking access token.");
    if (!extension) throw new Error("Upload a JPG, PNG, WebP, or PDF file.");

    const { data: booking, error: bookingError } = await db
      .from("bookings")
      .select("id,status")
      .eq("tenant_id", tenant.id)
      .eq("booking_reference", bookingReference)
      .eq("guest_access_token", accessToken)
      .in("status", ["pending", "confirmed"])
      .maybeSingle();
    if (bookingError) throw bookingError;
    if (!booking) throw new Error("Booking not found or upload access expired.");

    const path = `${tenant.id}/bookings/${booking.id}/${crypto.randomUUID()}.${extension}`;
    const { data, error } = await db.storage
      .from("tenant-receipts")
      .createSignedUploadUrl(path, { upsert: false });
    if (error) throw error;

    return jsonResponse({
      bucket: "tenant-receipts",
      path,
      signedUrl: data.signedUrl,
      token: data.token,
    }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload request failed.";
    return jsonResponse({ error: message }, 400);
  }
});

