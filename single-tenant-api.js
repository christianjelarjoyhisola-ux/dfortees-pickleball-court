// Secure single-tenant bridge for the dedicated D'fortees Supabase project.
// The historical data layer still powers authenticated dashboard features;
// anonymous booking and Open Play operations are routed through reviewed RPCs.
(function installSingleTenantApi() {
  'use strict';

  if (!window.PB_BACKEND_CONFIGURED || window.PB_USE_LOCAL_DATA || !window._supabase || !window.DB) return;

  const sb = window._supabase;
  const accessStorageKey = 'df_guest_booking_access_v2';
  const idempotencyStorageKey = 'df_guest_idempotency_v1';
  const original = {
    getSettings: window.DB.getSettings.bind(window.DB),
    seedDefaultData: window.DB.seedDefaultData.bind(window.DB),
    getBookings: window.DB.getBookings.bind(window.DB),
    addBooking: window.DB.addBooking.bind(window.DB),
    getBookingByRef: window.DB.getBookingByRef.bind(window.DB),
    updateBooking: window.DB.updateBooking.bind(window.DB),
    deleteBooking: window.DB.deleteBooking.bind(window.DB),
    getOpenPlayRegistrations: window.DB.getOpenPlayRegistrations.bind(window.DB),
    addOpenPlayRegistration: window.DB.addOpenPlayRegistration.bind(window.DB),
    getOpenPlayCountForDate: window.DB.getOpenPlayCountForDate.bind(window.DB),
    getOpenPlayCountsForDate: window.DB.getOpenPlayCountsForDate.bind(window.DB),
    getOpenPlayHostSessionRegistrations: window.DB.getOpenPlayHostSessionRegistrations.bind(window.DB),
    addOpenPlayHostSessionRegistration: window.DB.addOpenPlayHostSessionRegistration.bind(window.DB),
    getOpenPlayHostSessions: window.DB.getOpenPlayHostSessions.bind(window.DB),
    addOpenPlayHostApplication: window.DB.addOpenPlayHostApplication.bind(window.DB),
    createPaymentSession: window.DB.createPaymentSession.bind(window.DB),
    verifyGcashReceipt: window.DB.verifyGcashReceipt.bind(window.DB),
    sendConfirmationEmail: window.DB.sendConfirmationEmail.bind(window.DB),
    sendTelegramNotification: window.DB.sendTelegramNotification.bind(window.DB),
  };

  function readSessionJson(key) {
    try { return JSON.parse(sessionStorage.getItem(key) || '{}') || {}; }
    catch (_) { return {}; }
  }

  function writeSessionJson(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify(value)); }
    catch (_) {}
  }

  function rememberAccess(reference, accessToken) {
    if (!reference || !accessToken) return;
    const values = readSessionJson(accessStorageKey);
    values[reference] = String(accessToken);
    writeSessionJson(accessStorageKey, values);
  }

  function forgetAccess(reference) {
    const values = readSessionJson(accessStorageKey);
    delete values[reference];
    writeSessionJson(accessStorageKey, values);
  }

  function accessFor(reference) {
    return readSessionJson(accessStorageKey)[reference] || null;
  }

  function idempotencyFor(reference) {
    const key = String(reference || crypto.randomUUID());
    const values = readSessionJson(idempotencyStorageKey);
    if (!values[key]) values[key] = crypto.randomUUID();
    writeSessionJson(idempotencyStorageKey, values);
    return values[key];
  }

  async function isAuthenticated() {
    const session = window.Auth?.getSession?.();
    return !!session
      && session.status === 'active'
      && ['owner', 'court_owner', 'staff', 'host'].includes(session.role);
  }

  async function rpc(name, parameters) {
    const { data, error } = await sb.rpc(name, parameters);
    if (error) throw error;
    return data;
  }

  function publicStatusToBooking(status) {
    if (!status) return null;
    const slots = (status.slots || []).map(Number);
    return {
      ref: status.bookingReference,
      fullName: '',
      contactNumber: '',
      email: '',
      courtId: status.courtId,
      courtName: status.courtName,
      date: status.date,
      slots,
      startTime: slots.length ? _fmtBookingHour(Math.min(...slots)) : '',
      endTime: slots.length ? _fmtBookingHour(Math.max(...slots) + 1) : '',
      timeLabel: _bookingSlotsTimeLabel(slots),
      duration: slots.length,
      rate: slots.length ? Number(status.totalAmount || 0) / slots.length : 0,
      total: Number(status.totalAmount || 0),
      paymentMethod: status.paymentMethod || 'cash',
      paymentStatus: status.paymentStatus || 'unpaid',
      status: status.status || 'pending',
      createdAt: status.createdAt || null,
      holdExpiresAt: status.holdExpiresAt || null,
    };
  }

  window.DB.seedDefaultData = async function singleTenantSeedIsServerManaged() {
    // Production seed data is migration-controlled. Never recreate legacy
    // Court Alpha/Beta records from a public browser.
  };

  window.DB.getSettings = async function getSingleTenantSettings() {
    if (await isAuthenticated()) return original.getSettings();
    return (await rpc('get_public_settings', {})) || {};
  };

  window.DB.getBookings = async function getSingleTenantBookings(filters = {}) {
    const opts = filters || {};
    if (await isAuthenticated()) return original.getBookings(opts);
    if (!opts.date) return [];

    const availability = await rpc('get_public_availability', { p_booking_date: opts.date });
    const rows = [];
    for (const court of availability?.courts || []) {
      if (opts.courtId && String(opts.courtId) !== String(court.id)) continue;
      for (const slot of court.slots || []) {
        if (slot.available) continue;
        rows.push({
          ref: `UNAVAILABLE-${court.id}-${opts.date}-${slot.startHour}`,
          fullName: '',
          contactNumber: '',
          email: '',
          courtId: court.id,
          courtName: court.name,
          date: opts.date,
          slots: [Number(slot.startHour)],
          startTime: _fmtBookingHour(slot.startHour),
          endTime: _fmtBookingHour(Number(slot.startHour) + 1),
          timeLabel: _bookingSlotsTimeLabel([slot.startHour]),
          duration: 1,
          rate: Number(slot.price || 0),
          total: Number(slot.price || 0),
          paymentMethod: 'cash',
          paymentStatus: 'unpaid',
          status: ['processing', 'verifying'].includes(slot.state) ? 'verifying' : slot.state === 'done' ? 'completed' : 'confirmed',
          createdAt: null,
        });
      }
    }
    return rows;
  };

  window.DB.addBooking = async function addSingleTenantBooking(booking) {
    if (await isAuthenticated()) return original.addBooking(booking);
    const reference = String(booking?.ref || '').trim();
    const isHold = /^Reserving/i.test(String(booking?.fullName || ''))
      || String(booking?.email || '').endsWith('@hold.internal');
    const result = await rpc('create_guest_booking', {
      p_booking: booking || {},
      p_idempotency_key: idempotencyFor(reference),
      p_mode: isHold ? 'hold' : 'booking',
    });
    rememberAccess(result.bookingReference, result.accessToken);
    if (reference && reference !== result.bookingReference) rememberAccess(reference, result.accessToken);
    window.DB.clearCache?.(['bookings']);
    return result;
  };

  window.DB.getBookingByRef = async function getSingleTenantBookingByRef(reference) {
    if (await isAuthenticated()) return original.getBookingByRef(reference);
    const accessToken = accessFor(reference);
    if (!accessToken) return null;
    const status = await rpc('get_guest_booking_status', {
      p_booking_ref: reference,
      p_access_token: accessToken,
    });
    return publicStatusToBooking(status);
  };

  window.DB.updateBooking = async function updateSingleTenantBooking(reference, updates = {}) {
    if (await isAuthenticated()) return original.updateBooking(reference, updates);
    const accessToken = accessFor(reference);
    if (!accessToken) throw new Error('This booking can only be changed from the browser that created it.');

    if (['cancelled', 'expired', 'rejected'].includes(String(updates.status || '').toLowerCase())
        && !updates.fullName) {
      const cancelled = await rpc('cancel_guest_booking', {
        p_booking_ref: reference,
        p_access_token: accessToken,
        p_reason: updates.cancellationReason || 'Cancelled by guest',
      });
      forgetAccess(reference);
      window.DB.clearCache?.(['bookings']);
      return cancelled;
    }

    const result = await rpc('update_guest_booking', {
      p_booking_ref: reference,
      p_access_token: accessToken,
      p_updates: updates || {},
    });
    if (result?.expired) {
      forgetAccess(reference);
      throw new Error('This temporary reservation expired. Please select the time again.');
    }
    window.DB.clearCache?.(['bookings']);
    return result;
  };

  window.DB.deleteBooking = async function deleteSingleTenantBooking(reference) {
    if (await isAuthenticated()) return original.deleteBooking(reference);
    const accessToken = accessFor(reference);
    if (!accessToken) return null;
    const result = await rpc('cancel_guest_booking', {
      p_booking_ref: reference,
      p_access_token: accessToken,
      p_reason: 'Cancelled by guest',
    });
    forgetAccess(reference);
    window.DB.clearCache?.(['bookings']);
    return result;
  };

  window.DB.getOpenPlayRegistrations = async function getSingleTenantOpenPlayRegistrations() {
    return await isAuthenticated() ? original.getOpenPlayRegistrations() : [];
  };

  window.DB.addOpenPlayRegistration = async function addSingleTenantOpenPlayRegistration(registration) {
    if (await isAuthenticated()) return original.addOpenPlayRegistration(registration);
    const requestKey = [
      'open-play',
      registration?.courtId,
      registration?.date,
      registration?.hour,
      String(registration?.fullName || '').trim().toLowerCase(),
    ].join(':');
    return rpc('create_public_open_play_registration', {
      p_registration: registration || {},
      p_idempotency_key: idempotencyFor(requestKey),
    });
  };

  window.DB.getOpenPlayCountForDate = async function getSingleTenantOpenPlayCount(date, courtId = null) {
    if (await isAuthenticated()) return original.getOpenPlayCountForDate(date, courtId);
    const result = await rpc('get_public_open_play_counts', { p_date: date });
    return Number((result || {})[String(courtId || '')] || (courtId ? 0 : result?.total || 0));
  };

  window.DB.getOpenPlayCountsForDate = async function getSingleTenantOpenPlayCounts(date) {
    if (await isAuthenticated()) return original.getOpenPlayCountsForDate(date);
    const result = await rpc('get_public_open_play_counts', { p_date: date });
    const counts = { ...(result || {}) };
    delete counts.total;
    return counts;
  };

  window.DB.getOpenPlayHostSessionRegistrations = async function getSingleTenantHostRegistrations(sessionId = null) {
    return await isAuthenticated() ? original.getOpenPlayHostSessionRegistrations(sessionId) : [];
  };

  window.DB.addOpenPlayHostSessionRegistration = async function addSingleTenantHostRegistration(registration) {
    if (await isAuthenticated()) return original.addOpenPlayHostSessionRegistration(registration);
    const requestKey = [
      'host-session',
      registration?.sessionId,
      String(registration?.fullName || '').trim().toLowerCase(),
      String(registration?.contactNumber || '').replace(/\D/g, ''),
    ].join(':');
    return rpc('create_public_host_session_registration', {
      p_registration: registration || {},
      p_idempotency_key: idempotencyFor(requestKey),
    });
  };

  window.DB.getOpenPlayHostSessions = async function getSingleTenantPublicHostSessions() {
    if (await isAuthenticated()) return original.getOpenPlayHostSessions();
    return (await rpc('get_public_open_play_host_sessions', {})) || [];
  };

  window.DB.addOpenPlayHostApplication = async function addSingleTenantHostApplication(application) {
    if (await isAuthenticated() || application?.password || application?.validIdBase64) {
      return original.addOpenPlayHostApplication(application);
    }
    return rpc('create_public_host_application', { p_application: application || {} });
  };

  window.DB.createPaymentSession = async function createAuthorizedPaymentSession(payload = {}) {
    if (await isAuthenticated()) return original.createPaymentSession(payload);
    const bookingRef = payload.bookingRef || payload.ref;
    const guestAccessToken = accessFor(bookingRef);
    if (!guestAccessToken) {
      throw new Error('This payment session can only be created from the browser that made the booking.');
    }
    return original.createPaymentSession({ ...payload, bookingRef, guestAccessToken });
  };

  window.DB.verifyGcashReceipt = async function verifyAuthorizedReceipt(payload = {}) {
    if (await isAuthenticated()) return original.verifyGcashReceipt(payload);
    const bookingRef = payload.bookingRef || payload.ref;
    const guestAccessToken = accessFor(bookingRef);
    if (!guestAccessToken) {
      throw new Error('This receipt can only be verified from the browser that made the booking.');
    }
    return original.verifyGcashReceipt({ ...payload, bookingRef, guestAccessToken });
  };

  window.DB.sendConfirmationEmail = async function sendSingleTenantConfirmation(booking, options = {}) {
    if (await isAuthenticated()) return original.sendConfirmationEmail(booking, options);
    const reference = String(booking?.displayRef || booking?.ref || '').trim();
    const guestAccessToken = accessFor(reference) || accessFor(String(booking?.ref || '').trim());
    if (!guestAccessToken) {
      return { ok: false, skipped: true, reason: 'Booking access token is not available in this browser.' };
    }
    return original.sendConfirmationEmail({ ...booking, guestAccessToken }, options);
  };

  window.DB.sendTelegramNotification = async function sendSingleTenantTelegram(payload, options = {}) {
    if (await isAuthenticated()) return original.sendTelegramNotification(payload, options);
    if (payload?.type === 'open_play') {
      return { ok: true, skipped: true, reason: 'Open Play notification is server-managed.' };
    }
    const reference = String(payload?.bookingRef || '').trim();
    const guestAccessToken = accessFor(reference);
    if (!reference || !guestAccessToken) {
      return { ok: false, skipped: true, reason: 'Booking access token is not available in this browser.' };
    }
    return original.sendTelegramNotification({ ...payload, guestAccessToken }, options);
  };
})();
