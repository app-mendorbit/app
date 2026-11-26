/**
 * MENDORBIT UNIFIED API CLIENT (api-client.js)
 * Clean bridge between HTML interface and the Cloudflare Worker Edge Backend.
 * 
 * If a Cloudflare Worker URL is active, all encryption, database writes,
 * and OTP operations are processed 100% on the server side.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MendorbitAPI = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  // Point to deployed Cloudflare Worker URL
  let workerBaseUrl = (typeof MENDORBIT_WORKER_URL !== 'undefined' && MENDORBIT_WORKER_URL)
    ? MENDORBIT_WORKER_URL
    : "https://auth.app-mendorbit.workers.dev";

  function setBaseUrl(url) {
    workerBaseUrl = (url || "").replace(/\/$/, "");
  }

  function getBaseUrl() {
    return workerBaseUrl;
  }

  function getAuthHeaders() {
    try {
      if (typeof MendorbitSSO !== 'undefined' && MendorbitSSO.getSession) {
        const sess = MendorbitSSO.getSession();
        if (sess && sess.email) {
          const token = btoa(unescape(encodeURIComponent(JSON.stringify({
            email: sess.email,
            uid: sess.uid || sess.email,
            sessionId: sess.sessionId || ""
          }))));
          return { "Authorization": `Bearer ${token}` };
        }
      }
    } catch (e) {}
    return {};
  }

  async function post(endpoint, payload, headers = {}) {
    const url = `${workerBaseUrl}${endpoint}`;
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
        ...headers
      },
      body: JSON.stringify(payload)
    });
    return await res.json();
  }

  async function get(endpoint, headers = {}) {
    const url = `${workerBaseUrl}${endpoint}`;
    const res = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: {
        ...getAuthHeaders(),
        ...headers
      }
    });
    return await res.json();
  }

  const getClientLocation = () => (typeof MendorbitTracker !== 'undefined' && MendorbitTracker.getExactLocation) ? MendorbitTracker.getExactLocation() : null;

  return {
    setBaseUrl: setBaseUrl,
    getBaseUrl: getBaseUrl,

    // OTP
    sendOtp: async (email, purpose, name) => post("/api/otp/send", { email, purpose, name, location: getClientLocation() }),
    verifyOtp: async (email, otp, purpose) => post("/api/otp/verify", { email, otp, purpose }),

    // Authentication
    checkUser: async (email) => get("/api/auth/check-user?email=" + encodeURIComponent(email)),
    register: async (data) => post("/api/auth/register", { ...data, location: getClientLocation() }),
    login: async (email, password) => post("/api/auth/login", { email, password, location: getClientLocation() }),
    otpLogin: async (email, otp) => post("/api/auth/otp-login", { email, otp, location: getClientLocation() }),
    verifyResetToken: async (token, email) => get("/api/auth/verify-reset-token?token=" + encodeURIComponent(token) + (email ? ("&email=" + encodeURIComponent(email)) : "")),
    resetPassword: async (email, newPassword, token) => post("/api/auth/reset-password", { email, newPassword, token }),
    lockAccount: async (email, token) => post("/api/auth/lock-account", { email, token }),
    googleSetup: async (data) => post("/api/auth/google-setup", { ...data, location: getClientLocation() }),
    updateProfile: async (email, profileData) => post("/api/auth/update-profile", { email, profileData }),
    changeEmail: async (oldEmail, newEmail, oldOtp, newOtp, fullProfile, migrationMeta) => post("/api/auth/change-email", { oldEmail, newEmail, oldOtp, newOtp, fullProfile, migrationMeta, location: getClientLocation() }),
    getSessions: async (email) => get("/api/auth/sessions?email=" + encodeURIComponent(email)),
    revokeSession: async (email, sessionId) => post("/api/auth/revoke-session", { email, sessionId }),
    revokeAllOtherSessions: async (email, currentSessionId) => post("/api/auth/revoke-all-others", { email, currentSessionId }),
    deleteSession: async (email, sessionId) => post("/api/auth/delete-session", { email, sessionId }),
    clearSessionHistory: async (email) => post("/api/auth/clear-session-history", { email }),

    // QR Handshake
    authorizeQrSession: async (sessionId, user, authorizedBy) => post("/api/qr/authorize", { sessionId, user, authorizedBy }),
    pollQrSession: async (sessionId) => get("/api/qr/poll?session=" + encodeURIComponent(sessionId)),

    // EdTech Batches & Checkout
    getBatches: async (targetClass, email) => {
      let q = [];
      if (targetClass && targetClass !== "all") q.push("class=" + encodeURIComponent(targetClass));
      if (email) q.push("email=" + encodeURIComponent(email));
      return get("/api/batches/list" + (q.length ? ("?" + q.join("&")) : ""));
    },
    getBatchDetail: async (batchId, email) => get("/api/batches/detail?id=" + encodeURIComponent(batchId) + (email ? ("&email=" + encodeURIComponent(email)) : "")),
    initCheckout: async (batchId, email) => post("/api/batches/checkout-init", { batchId, email }),
    getCheckoutInfo: async (infoToken, email) => get("/api/batches/checkout-info?info=" + encodeURIComponent(infoToken) + (email ? ("&email=" + encodeURIComponent(email)) : "")),
    validateCoupon: async (code, batchId) => post("/api/coupons/validate", { code, batchId }),
    enrollBatch: async (batchId, email, couponCode = "", infoToken = "") => post("/api/batches/enroll", { batchId, email, couponCode, infoToken }),
    getBatchContent: async (batchId, email) => get("/api/batches/content?id=" + encodeURIComponent(batchId) + (email ? ("&email=" + encodeURIComponent(email)) : "")),
    getBatchDpp: async (batchId, sheetTab, dppId, email) => get("/api/batches/dpp?batchId=" + encodeURIComponent(batchId) + (sheetTab ? ("&sheetTab=" + encodeURIComponent(sheetTab)) : "") + (dppId ? ("&dppId=" + encodeURIComponent(dppId)) : "") + (email ? ("&email=" + encodeURIComponent(email)) : "")),
    saveLectureProgress: async (batchId, lectureId, email) => post("/api/batches/progress", { batchId, lectureId, email }),

    // Admin Batch, Coupon & Curriculum Studio
    adminGetBatches: async (adminKey) => get("/api/admin/batches/all", { "X-Admin-Key": adminKey }),
    adminCreateBatch: async (batchData, adminKey) => post("/api/admin/batches/create", batchData, { "X-Admin-Key": adminKey }),
    adminUpdateBatch: async (batchData, adminKey) => post("/api/admin/batches/update", batchData, { "X-Admin-Key": adminKey }),
    adminDeleteBatch: async (batchId, adminKey) => post("/api/admin/batches/delete", { id: batchId }, { "X-Admin-Key": adminKey }),
    adminGetCoupons: async (adminKey) => get("/api/admin/coupons/all", { "X-Admin-Key": adminKey }),
    adminCreateCoupon: async (couponData, adminKey) => post("/api/admin/coupons/create", couponData, { "X-Admin-Key": adminKey }),
    adminDeleteCoupon: async (code, adminKey) => post("/api/admin/coupons/delete", { code }, { "X-Admin-Key": adminKey }),
    adminGetBatchContent: async (batchId, adminKey) => get("/api/batches/content?id=" + encodeURIComponent(batchId), { "X-Admin-Key": adminKey }),
    adminUpdateCurriculum: async (batchId, subjects, adminKey, dppScriptUrl) => post("/api/admin/batches/content/update", { batchId, subjects, dppScriptUrl: dppScriptUrl || "" }, { "X-Admin-Key": adminKey }),
    adminGetEnrollments: async (batchId, adminKey) => get("/api/admin/batches/enrollments" + (batchId ? ("?batchId=" + encodeURIComponent(batchId)) : ""), { "X-Admin-Key": adminKey }),
    getBatchAnnouncements: async (batchId) => get("/api/batches/announcements" + (batchId ? ("?batchId=" + encodeURIComponent(batchId)) : "")),
    adminGetAnnouncements: async (adminKey) => get("/api/admin/announcements/all", { "X-Admin-Key": adminKey }),
    adminCreateAnnouncement: async (data, adminKey) => post("/api/admin/announcements/create", data, { "X-Admin-Key": adminKey }),
    adminDeleteAnnouncement: async (id, adminKey) => post("/api/admin/announcements/delete", { id }, { "X-Admin-Key": adminKey }),

    // Admin Security & Cipher
    adminDecrypt: async (ciphertext, adminKey) => post("/api/admin/decrypt", { ciphertext }, { "X-Admin-Key": adminKey }),
    adminGetUsers: async (adminKey) => get("/api/admin/users", { "X-Admin-Key": adminKey }),
    adminGetOtpStats: async (adminKey) => {
      try {
        const res = await get("/api/admin/otp-stats", { "X-Admin-Key": adminKey });
        if (res && res.status === "success") return res;
      } catch (e) {}

      const gasUrl = (typeof MendorbitBackend !== 'undefined' && MendorbitBackend.getAppsScriptUrl)
        ? MendorbitBackend.getAppsScriptUrl()
        : "https://script.google.com/macros/s/AKfycbwWiLcXeggeJ34fx-Nc0Ded1MJ-O0a-7_ohHKtTI96BBm2KbZ4G8r3sttpu0qx43Sgwfw/exec";
      const res = await fetch(`${gasUrl}?action=getOtpStats`);
      return await res.json();
    }
  };
});
