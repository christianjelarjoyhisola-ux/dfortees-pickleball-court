// Shared authorization guards for Edge Functions that use the service role.
//
// A service-role client bypasses RLS, so every caller must be authorized before
// a booking or private receipt is loaded or changed. Public customers prove
// ownership with the booking's unguessable guest access token. Dashboard
// actions require both a valid Supabase user JWT and an active admin account.

export type ActiveAdmin = {
  userId: string;
  role: "owner" | "court_owner" | "staff";
};

export type BookingAuthorization =
  | { ok: true; kind: "admin"; admin: ActiveAdmin }
  | { ok: true; kind: "guest" }
  | { ok: false; status: 401 | 403 | 500; error: string };

const ADMIN_ROLES = new Set(["owner", "court_owner", "staff"]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AuthorizationQuery = {
  select(columns: string): AuthorizationQuery;
  eq(column: string, value: unknown): AuthorizationQuery;
  maybeSingle(): Promise<{
    data: Record<string, unknown> | null;
    error: unknown;
  }>;
};

type AuthorizationDb = {
  auth: {
    getUser(token: string): Promise<{
      data: { user?: { id?: string } | null } | null;
      error: unknown;
    }>;
  };
  from(table: string): AuthorizationQuery;
};

function bearerToken(req: Request): string {
  const value = req.headers.get("Authorization") || "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

export function normalizeGuestAccessToken(value: unknown): string {
  const token = String(value || "").trim();
  return UUID_PATTERN.test(token) ? token.toLowerCase() : "";
}

export async function getActiveAdmin(
  req: Request,
  client: unknown,
): Promise<ActiveAdmin | null> {
  const db = client as AuthorizationDb;
  const token = bearerToken(req);
  if (!token) return null;

  const { data: userData, error: userError } = await db.auth.getUser(token);
  const userId = String(userData?.user?.id || "");
  if (userError || !userId) return null;

  const { data: account, error: accountError } = await db
    .from("accounts")
    .select("id,role,status")
    .eq("id", userId)
    .maybeSingle();

  if (accountError) throw accountError;
  const role = String(account?.role || "");
  if (!account || account.status !== "active" || !ADMIN_ROLES.has(role)) {
    return null;
  }

  return {
    userId,
    role: role as ActiveAdmin["role"],
  };
}

export async function authorizeBookingRequest(input: {
  req: Request;
  db: unknown;
  bookingRef: string;
  guestAccessToken: unknown;
}): Promise<BookingAuthorization> {
  const db = input.db as AuthorizationDb;
  let admin: ActiveAdmin | null;
  try {
    admin = await getActiveAdmin(input.req, input.db);
  } catch (error) {
    console.error("admin authorization lookup failed", error);
    return {
      ok: false,
      status: 500,
      error: "Authorization could not be verified",
    };
  }
  if (admin) return { ok: true, kind: "admin", admin };

  const guestAccessToken = normalizeGuestAccessToken(input.guestAccessToken);
  if (!guestAccessToken) {
    return {
      ok: false,
      status: 401,
      error: "Booking access token required",
    };
  }

  const { data: booking, error } = await db
    .from("bookings")
    .select("ref")
    .eq("ref", input.bookingRef)
    .eq("guest_access_token", guestAccessToken)
    .maybeSingle();

  if (error) {
    console.error("guest booking authorization lookup failed", error);
    return {
      ok: false,
      status: 500,
      error: "Authorization could not be verified",
    };
  }
  if (!booking) {
    return {
      ok: false,
      status: 403,
      error: "Booking access denied",
    };
  }

  return { ok: true, kind: "guest" };
}
