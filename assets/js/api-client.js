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

  // Point to your deployed Cloudflare Worker URL (or keep relative if hosted on same domain)
  // Example: "https://auth-api.mendorbit.in"
  let workerBaseUrl = (typeof MENDORBIT_WORKER_URL !== 'undefined') ? MENDORBIT_WORKER_URL : "";

  function setBaseUrl(url) {
    workerBaseUrl = (url || "").replace(/\/$/, "");
  }

  function getBaseUrl() {
    return workerBaseUrl;
  }

  async function post(endpoint, payload, headers = {}) {
    const url = `${workerBaseUrl}${endpoint}`;
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
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

    // Admin
    adminDecrypt: async (ciphertext, adminKey) => post("/api/admin/decrypt", { ciphertext }, { "X-Admin-Key": adminKey }),
    adminGetUsers: async (adminKey) => get("/api/admin/users", { "X-Admin-Key": adminKey }),
    adminGetOtpStats: async (adminKey) => {
      try {
        const res = await get("/api/admin/otp-stats", { "X-Admin-Key": adminKey });
        if (res && res.status === "success") return res;
      } catch (e) {}

      const gasUrl = (typeof MendorbitBackend !== 'undefined' && MendorbitBackend.getAppsScriptUrl)
        ? MendorbitBackend.getAppsScriptUrl()
        : "https://script.google.com/macros/s/AKfycby0v_XfpxlQWoDuGAlCvChokiBD6ZhQ9ijLk6B4yiSmup_duBZ4ERytZLMaz7JbOYlu2w/exec";
      const res = await fetch(`${gasUrl}?action=getOtpStats`);
      return await res.json();
    }
  };
});
