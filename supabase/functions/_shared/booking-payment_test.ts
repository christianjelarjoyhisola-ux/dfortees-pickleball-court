import {
  calculateCourtPayment,
  classifyStoredSessionPayment,
} from "./booking-payment.ts";

function assertEquals(
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertThrows(fn: () => unknown, message: string): void {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(message);
}

const base = {
  slots: [17, 18],
  courtRate: 400,
  feeRate: 20,
  feeType: "per_hour",
  paymentAcceptanceMode: "both",
};

Deno.test("regular downpayment is 50% of court charges plus the full service fee", () => {
  const amounts = calculateCourtPayment({ ...base, storedDownpayment: 440 });
  assertEquals(amounts.courtTotal, 800, "court total");
  assertEquals(amounts.serviceFee, 40, "service fee");
  assertEquals(amounts.total, 840, "booking total");
  assertEquals(amounts.due, 440, "regular downpayment");
});

Deno.test("D'fortees regular downpayment collects the full booking fee", () => {
  const amounts = calculateCourtPayment({
    slots: [17],
    courtRate: 60,
    feeRate: 5,
    feeType: "per_hour",
    paymentAcceptanceMode: "both",
    storedDownpayment: 35,
  });
  assertEquals(amounts.courtTotal, 60, "D'fortees court total");
  assertEquals(amounts.serviceFee, 5, "D'fortees booking fee");
  assertEquals(amounts.total, 65, "D'fortees booking total");
  assertEquals(amounts.due, 35, "D'fortees regular downpayment");
});

Deno.test("regular booking still permits full payment", () => {
  const amounts = calculateCourtPayment({ ...base, storedDownpayment: 840 });
  assertEquals(amounts.due, 840, "full payment");
});

Deno.test("legacy half-total regular deposits remain verifiable", () => {
  const amounts = calculateCourtPayment({ ...base, storedDownpayment: 420 });
  assertEquals(amounts.due, 420, "grandfathered regular downpayment");
});

Deno.test("downpayment-only mode requires a valid partial amount", () => {
  const amounts = calculateCourtPayment({
    ...base,
    paymentAcceptanceMode: "downpayment_only",
    storedDownpayment: 440,
  });
  assertEquals(amounts.due, 440, "forced downpayment");
  assertThrows(
    () =>
      calculateCourtPayment({
        ...base,
        paymentAcceptanceMode: "downpayment_only",
        storedDownpayment: 840,
      }),
    "downpayment-only mode must reject an inconsistent stored amount",
  );
});

Deno.test("full-payment-only mode requires the stored total", () => {
  const amounts = calculateCourtPayment({
    ...base,
    paymentAcceptanceMode: "full_payment_only",
    storedDownpayment: 840,
  });
  assertEquals(amounts.due, 840, "forced full payment");
  assertThrows(
    () =>
      calculateCourtPayment({
        ...base,
        paymentAcceptanceMode: "full_payment_only",
        storedDownpayment: 440,
      }),
    "full-payment-only mode must reject an inconsistent stored amount",
  );
});

Deno.test("host due is 25% of court charges plus the full service fee", () => {
  const amounts = calculateCourtPayment({
    ...base,
    storedDownpayment: 240,
    hostBooking: true,
  });
  assertEquals(amounts.due, 240, "host downpayment");
});

Deno.test("host booking still permits full payment when stored that way", () => {
  const amounts = calculateCourtPayment({
    ...base,
    storedDownpayment: 840,
    hostBooking: true,
  });
  assertEquals(amounts.due, 840, "host full payment");
});

Deno.test("booking fee aliases are treated as one flat fee", () => {
  const amounts = calculateCourtPayment({
    ...base,
    feeType: "per_booking",
    storedDownpayment: 220,
    hostBooking: true,
  });
  assertEquals(amounts.serviceFee, 20, "flat booking fee");
  assertEquals(amounts.due, 220, "host due with flat booking fee");
});

Deno.test("host stored downpayment must match the recomputed host due", () => {
  assertThrows(
    () =>
      calculateCourtPayment({
        ...base,
        // This is 25% of the grand total, not the valid host formula.
        storedDownpayment: 210,
        hostBooking: true,
      }),
    "invalid host downpayment should be rejected",
  );
});

Deno.test("grouped host dues add the full fee for every booking row", () => {
  const first = calculateCourtPayment({
    ...base,
    slots: [17, 18],
    storedDownpayment: 240,
    hostBooking: true,
  });
  const second = calculateCourtPayment({
    ...base,
    slots: [19],
    storedDownpayment: 120,
    hostBooking: true,
  });
  assertEquals(first.due + second.due, 360, "group host due");
  assertEquals(first.total + second.total, 1260, "group total");
});

Deno.test("stored partial checkout becomes downpayment paid", () => {
  const status = classifyStoredSessionPayment(240, [{
    total: 840,
    downpayment: 240,
  }]);
  assertEquals(status, "downpayment_paid", "partial checkout status");
});

Deno.test("stored full checkout becomes fully paid", () => {
  const status = classifyStoredSessionPayment(840, [{
    total: 840,
    downpayment: 840,
  }]);
  assertEquals(status, "paid", "full checkout status");
});

Deno.test("stored grouped checkout sums every active booking row", () => {
  const status = classifyStoredSessionPayment(360, [
    { total: 840, downpayment: 240 },
    { total: 420, downpayment: 120 },
  ]);
  assertEquals(status, "downpayment_paid", "group checkout status");
});

Deno.test("webhook payment cannot override the stored session amount", () => {
  assertThrows(
    () =>
      classifyStoredSessionPayment(210, [{
        total: 840,
        downpayment: 240,
      }]),
    "mismatched session amount should be rejected",
  );
});
