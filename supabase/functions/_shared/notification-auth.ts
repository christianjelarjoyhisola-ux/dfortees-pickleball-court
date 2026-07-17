import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getActiveAdmin, normalizeGuestAccessToken } from "./request-authorization.ts";

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export type BookingRow = {
  ref: string;
  booking_group_ref: string | null;
  guest_access_token: string;
  full_name: string;
  contact_number: string;
  email: string;
  court_name: string;
  date: string;
  start_time: string;
  end_time: string;
  duration: number;
  total: number;
  downpayment: number;
  payment_method: string;
  payment_status: string;
  status: string;
  gcash_ref: string | null;
  host_booking: boolean;
  balance_due_at: string | null;
  confirmation_email_sent_at: string | null;
};

export type BookingAccess = {
  db: any;
  rows: BookingRow[];
  requestedRow: BookingRow;
  isAdmin: boolean;
  actorId: string | null;
};

const BOOKING_SELECT = [
  "ref", "booking_group_ref", "guest_access_token", "full_name", "contact_number", "email",
  "court_name", "date", "start_time", "end_time", "duration", "total", "downpayment",
  "payment_method", "payment_status", "status", "gcash_ref", "host_booking", "balance_due_at",
  "confirmation_email_sent_at",
].join(",");

function serviceEnvironment() {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
  if (!url || !serviceKey) throw new HttpError(503, "Notification service is not configured");
  return { url, serviceKey };
}

export function createServiceClient() {
  const { url, serviceKey } = serviceEnvironment();
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

function bearerToken(req: Request): string {
  return (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

function isBookingReference(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{4,63}$/.test(value);
}

function safeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}

async function activeAdmin(db: any, req: Request) {
  try {
    return await getActiveAdmin(req, db);
  } catch (error) {
    console.error("Unable to verify dashboard access", error);
    throw new HttpError(500, "Unable to verify dashboard access");
  }
}

export async function requireActiveAdmin(req: Request, db = createServiceClient()) {
  const admin = await activeAdmin(db, req);
  if (!admin) throw new HttpError(403, "Active dashboard administrator access is required");
  return { db, ...admin };
}

export async function resolveBookingAccess(
  req: Request,
  body: Record<string, unknown>,
  options: { adminOnly?: boolean } = {},
): Promise<BookingAccess> {
  const bookingRef = String(body.bookingRef || "").trim();
  if (!isBookingReference(bookingRef)) throw new HttpError(400, "A valid booking reference is required");

  const db = createServiceClient();
  const admin = await activeAdmin(db, req);

  const exactResult = await db
    .from("bookings")
    .select(BOOKING_SELECT)
    .eq("ref", bookingRef)
    .maybeSingle();
  let requestedRow = exactResult.data as unknown as BookingRow | null;
  let bookingError = exactResult.error;

  if (!requestedRow && !bookingError && admin) {
    const groupResult = await db
      .from("bookings")
      .select(BOOKING_SELECT)
      .eq("booking_group_ref", bookingRef)
      .order("ref", { ascending: true })
      .limit(1)
      .maybeSingle();
    requestedRow = groupResult.data as unknown as BookingRow | null;
    bookingError = groupResult.error;
  }

  if (bookingError) throw new HttpError(500, "Unable to load booking");
  if (!requestedRow) throw new HttpError(404, "Booking not found");

  if (options.adminOnly && !admin) {
    throw new HttpError(403, "Active dashboard administrator access is required");
  }

  if (!admin) {
    const guestToken = normalizeGuestAccessToken(body.guestAccessToken);
    if (!guestToken || !safeEqual(guestToken, String(requestedRow.guest_access_token || "").toLowerCase())) {
      throw new HttpError(403, "Booking access token is invalid");
    }
  }

  let rows = [requestedRow];
  if (requestedRow.booking_group_ref) {
    const groupResult = await db
      .from("bookings")
      .select(BOOKING_SELECT)
      .eq("booking_group_ref", requestedRow.booking_group_ref)
      .order("date", { ascending: true })
      .order("start_time", { ascending: true });
    if (groupResult.error) throw new HttpError(500, "Unable to load grouped booking");
    rows = (groupResult.data || []) as unknown as BookingRow[];
  }

  return {
    db,
    rows,
    requestedRow,
    isAdmin: !!admin,
    actorId: admin?.userId || null,
  };
}

export async function authorizeScheduledRequest(req: Request, db = createServiceClient()) {
  const { serviceKey } = serviceEnvironment();
  const suppliedBearer = bearerToken(req);
  if (suppliedBearer && safeEqual(suppliedBearer, serviceKey)) return { db, method: "service_role" as const };

  const configuredSecret = Deno.env.get("HOST_BALANCE_CRON_SECRET") || "";
  const suppliedSecret = req.headers.get("x-cron-secret") || "";
  if (configuredSecret && suppliedSecret && safeEqual(suppliedSecret, configuredSecret)) {
    return { db, method: "cron_secret" as const };
  }

  throw new HttpError(401, "Scheduled processor authorization is required");
}

export function jsonError(error: unknown, corsHeaders: Record<string, string>) {
  const status = error instanceof HttpError ? error.status : 500;
  const message = error instanceof HttpError ? error.message : "Internal server error";
  if (!(error instanceof HttpError)) console.error(error);
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
