import { HttpError, jsonError, requireActiveAdmin, resolveBookingAccess } from "../_shared/notification-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type BookingPayload = {
  type?: "booking" | "booking_update";
  bookingRef: string;
  fullName: string;
  contactNumber: string;
  courtName: string;
  date: string;
  startTime: string;
  endTime: string;
  duration: number;
  total: number;
  downpayment: number;
  paymentMethod: string;
  paymentStatus?: string;
  bookingStatus?: string;
  event?: string;
  note?: string;
  gcashRef?: string | null;
  guestAccessToken?: string;
};

type BookingUpdatePayload = BookingPayload & {
  type: "booking_update";
  event: string;
};

type OpenPlayPayload = {
  type: "open_play";
  registrationId?: number;
  fullName: string;
  courtName: string;
  date: string;
  timeLabel: string;
  paymentType: string;
  amount: number;
};

type Payload = BookingPayload | BookingUpdatePayload | OpenPlayPayload;

const BOOKING_EVENTS = new Set([
  "new_booking", "booking_confirmed", "booking_rescheduled", "booking_cancelled",
  "payment_verified", "payment_rejected", "payment_review_needed", "admin_booking_created",
]);

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmtDate(d: string): string {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-PH", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function fmtPHP(n: number): string {
  return "PHP " + Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 });
}

function adminUrl(): string {
  return Deno.env.get("APP_ADMIN_URL") || "https://dfortees-court.example.invalid/admin.html";
}

function paymentMethodLabel(method?: string): string {
  const labels: Record<string, string> = {
    gcash: "GCash",
    bdopay: "BDO Pay",
    maya: "Maya",
    gotyme: "GoTyme",
    pnb: "PNB",
    cash: "Cash",
  };
  return labels[String(method || "cash").toLowerCase()] || String(method || "Cash");
}

function eventLabel(event?: string): string {
  const labels: Record<string, string> = {
    new_booking: "New booking",
    booking_confirmed: "Booking confirmed",
    booking_rescheduled: "Booking rescheduled",
    booking_cancelled: "Booking cancelled",
    payment_verified: "Payment verified",
    payment_rejected: "Payment rejected",
    payment_review_needed: "Payment needs review",
    admin_booking_created: "Admin booking created",
  };
  return labels[String(event || "").toLowerCase()] || String(event || "Booking update");
}

function buildBookingMessage(p: BookingPayload): string {
  const method = paymentMethodLabel(p.paymentMethod);
  const paymentRef = p.gcashRef ? `\nPayment ref: <code>${esc(p.gcashRef)}</code>` : "";
  const paidLine = p.downpayment >= p.total
    ? `Full payment: <b>${fmtPHP(p.downpayment)}</b>`
    : `Downpayment: <b>${fmtPHP(p.downpayment)}</b>`;

  return (
    `<b>NEW BOOKING</b>\n` +
    `------------------\n` +
    `<b>${esc(p.fullName)}</b>\n` +
    `${esc(p.contactNumber)}\n\n` +
    `<b>${esc(p.courtName)}</b>\n` +
    `${fmtDate(p.date)}\n` +
    `${esc(p.startTime)} - ${esc(p.endTime)} (${p.duration} hr${p.duration !== 1 ? "s" : ""})\n\n` +
    `Payment: <b>${esc(method)}</b>${paymentRef}\n` +
    `Total: ${fmtPHP(p.total)}\n` +
    `${paidLine}\n\n` +
    `Booking ref: <code>${esc(p.bookingRef)}</code>\n` +
    `------------------\n` +
    `<a href="${adminUrl()}">Open admin panel to verify and confirm.</a>`
  );
}

function buildBookingUpdateMessage(p: BookingUpdatePayload): string {
  const method = paymentMethodLabel(p.paymentMethod);
  const paymentRef = p.gcashRef ? `\nPayment ref: <code>${esc(p.gcashRef)}</code>` : "";
  const paymentState = p.paymentStatus ? `\nPayment status: <b>${esc(p.paymentStatus)}</b>` : "";
  const bookingState = p.bookingStatus ? `\nBooking status: <b>${esc(p.bookingStatus)}</b>` : "";
  const noteLine = p.note ? `\nNote: ${esc(p.note)}\n` : "\n";

  return (
    `<b>${esc(eventLabel(p.event).toUpperCase())}</b>\n` +
    `------------------\n` +
    `Booking ref: <code>${esc(p.bookingRef)}</code>\n` +
    `<b>${esc(p.fullName)}</b>\n` +
    `${esc(p.contactNumber)}\n\n` +
    `<b>${esc(p.courtName)}</b>\n` +
    `${fmtDate(p.date)}\n` +
    `${esc(p.startTime)} - ${esc(p.endTime)} (${p.duration} hr${p.duration !== 1 ? "s" : ""})\n\n` +
    `Payment: <b>${esc(method)}</b>${paymentRef}\n` +
    `Total: ${fmtPHP(p.total)}\n` +
    `Paid / DP: <b>${fmtPHP(p.downpayment)}</b>` +
    paymentState +
    bookingState +
    noteLine +
    `------------------\n` +
    `<a href="${adminUrl()}">Open admin panel.</a>`
  );
}

function buildOpenPlayMessage(p: OpenPlayPayload): string {
  return (
    `<b>OPEN PLAY SIGN-UP</b>\n` +
    `------------------\n` +
    `<b>${esc(p.fullName)}</b>\n\n` +
    `<b>${esc(p.courtName)}</b>\n` +
    `${fmtDate(p.date)}\n` +
    `${esc(p.timeLabel)}\n\n` +
    `Payment: <b>${esc(p.paymentType)}</b> - ${fmtPHP(p.amount)}\n` +
    `------------------\n` +
    `<a href="${adminUrl()}">View Open Play registrations.</a>`
  );
}

function serverBookingPayload(row: Record<string, unknown>, request: BookingPayload, isAdmin: boolean): BookingPayload {
  const status = String(row.status || "pending");
  const requestedEvent = String(request.event || "").toLowerCase();
  const event = isAdmin && BOOKING_EVENTS.has(requestedEvent)
    ? requestedEvent
    : status === "confirmed"
      ? "booking_confirmed"
      : status === "cancelled" || status === "forfeited"
        ? "booking_cancelled"
        : "new_booking";

  return {
    type: request.type === "booking_update" || event !== "new_booking" ? "booking_update" : "booking",
    bookingRef: String(row.booking_group_ref || row.ref || ""),
    fullName: String(row.full_name || ""),
    contactNumber: String(row.contact_number || ""),
    courtName: String(row.court_name || ""),
    date: String(row.date || ""),
    startTime: String(row.start_time || ""),
    endTime: String(row.end_time || ""),
    duration: Number(row.duration || 0),
    total: Number(row.total || 0),
    downpayment: Number(row.downpayment || 0),
    paymentMethod: String(row.payment_method || "cash"),
    paymentStatus: String(row.payment_status || "unpaid"),
    bookingStatus: status,
    gcashRef: row.gcash_ref ? String(row.gcash_ref) : null,
    event,
    note: isAdmin ? String(request.note || "").trim().slice(0, 300) : "",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Payload;
    let message: string;

    if (body.type === "open_play") {
      const { db } = await requireActiveAdmin(req);
      const registrationId = Number(body.registrationId || 0);
      if (!Number.isSafeInteger(registrationId) || registrationId <= 0) {
        throw new HttpError(400, "A valid Open Play registration ID is required");
      }
      const { data: registration, error } = await db.from("open_play_registrations")
        .select("id,full_name,court_name,date,time_label,payment_type,amount")
        .eq("id", registrationId)
        .maybeSingle();
      if (error) throw new HttpError(500, "Unable to load Open Play registration");
      if (!registration) throw new HttpError(404, "Open Play registration not found");
      message = buildOpenPlayMessage({
        type: "open_play",
        registrationId,
        fullName: registration.full_name,
        courtName: registration.court_name,
        date: registration.date,
        timeLabel: registration.time_label,
        paymentType: registration.payment_type,
        amount: Number(registration.amount || 0),
      });
    } else {
      const request = body as BookingPayload;
      const access = await resolveBookingAccess(req, request as unknown as Record<string, unknown>);
      const trusted = serverBookingPayload(access.requestedRow as unknown as Record<string, unknown>, request, access.isAdmin);
      message = trusted.type === "booking_update"
        ? buildBookingUpdateMessage(trusted as BookingUpdatePayload)
        : buildBookingMessage(trusted);
    }

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
    const chatIdRaw = Deno.env.get("TELEGRAM_CHAT_ID") || "";

    if (!botToken || !chatIdRaw) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "Telegram not configured" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const chatIds = chatIdRaw.split(",").map((id) => id.trim()).filter(Boolean);

    const results = await Promise.allSettled(
      chatIds.map(async (chatId) => {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: "HTML",
            disable_web_page_preview: true,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`Chat ${chatId}: ${res.status} ${JSON.stringify(json)}`);
        return { chatId, ok: true };
      }),
    );

    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length > 0) {
      console.error("Some Telegram sends failed:", failed.map((r) => (r as PromiseRejectedResult).reason));
    }

    return new Response(JSON.stringify({ ok: true, sent: chatIds.length, failed: failed.length }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return jsonError(err, corsHeaders);
  }
});
