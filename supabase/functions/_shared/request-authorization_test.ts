import {
  authorizeBookingRequest,
  getActiveAdmin,
  normalizeGuestAccessToken,
} from "./request-authorization.ts";

const GUEST_TOKEN = "6f45ed4c-6ec2-4d05-a047-cf3ef68a4533";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function mockDb(options: {
  userId?: string;
  account?: Record<string, unknown> | null;
  bookingToken?: string | null;
} = {}) {
  return {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: options.userId
            ? { user: { id: options.userId } }
            : { user: null },
          error: options.userId ? null : { message: "invalid token" },
        }),
    },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const query = {
        select() {
          return query;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return query;
        },
        maybeSingle() {
          if (table === "accounts") {
            return Promise.resolve({
              data: options.account || null,
              error: null,
            });
          }
          const matches = table === "bookings" &&
            filters.ref === "DF-BOOKING-1" &&
            filters.guest_access_token === options.bookingToken;
          return Promise.resolve({
            data: matches ? { ref: "DF-BOOKING-1" } : null,
            error: null,
          });
        },
      };
      return query;
    },
  };
}

Deno.test("normalizes only valid UUID guest access tokens", () => {
  assert(
    normalizeGuestAccessToken(GUEST_TOKEN.toUpperCase()) === GUEST_TOKEN,
    "valid token should normalize",
  );
  assert(
    normalizeGuestAccessToken("not-a-token") === "",
    "invalid token should be rejected",
  );
});

Deno.test("guest booking access requires a matching private token", async () => {
  const db = mockDb({ bookingToken: GUEST_TOKEN });
  const allowed = await authorizeBookingRequest({
    req: new Request("https://example.test"),
    db,
    bookingRef: "DF-BOOKING-1",
    guestAccessToken: GUEST_TOKEN,
  });
  assert(
    allowed.ok && allowed.kind === "guest",
    "matching guest token should authorize",
  );

  const denied = await authorizeBookingRequest({
    req: new Request("https://example.test"),
    db,
    bookingRef: "DF-BOOKING-1",
    guestAccessToken: "273d4548-ad2f-4c7d-b21a-8f1ad472f013",
  });
  assert(
    !denied.ok && denied.status === 403,
    "wrong guest token should be denied",
  );
});

Deno.test("admin access requires an active privileged account", async () => {
  const activeDb = mockDb({
    userId: "user-1",
    account: { id: "user-1", role: "staff", status: "active" },
  });
  const active = await getActiveAdmin(
    new Request("https://example.test", {
      headers: { Authorization: "Bearer signed-user-jwt" },
    }),
    activeDb,
  );
  assert(active?.userId === "user-1", "active staff account should authorize");

  const suspendedDb = mockDb({
    userId: "user-1",
    account: { id: "user-1", role: "owner", status: "suspended" },
  });
  const suspended = await getActiveAdmin(
    new Request("https://example.test", {
      headers: { Authorization: "Bearer signed-user-jwt" },
    }),
    suspendedDb,
  );
  assert(suspended === null, "suspended account must be denied");
});
