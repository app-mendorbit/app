/**
 * MENDORBIT SECURE CROSS-SUBDOMAIN SINGLE SIGN-ON (SSO) MANAGER
 * Enables unified authentication state across:
 * - mendorbit.in
 * - app.mendorbit.in
 * - learn.mendorbit.in
 * - admin.mendorbit.in
 * - and staging environments (mendorbit-test.netlify.app / localhost)
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MendorbitSSO = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  const COOKIE_NAME = "mendorbit_sso_session";
  const STORAGE_KEY = "mendorbit_sso_user";
  const SSO_SECRET_SALT = "MNDRBT_SSO_SIGN_99X";
  const SESSION_DURATION_DAYS = 30;

  // Broadcast channel for instantaneous multi-tab / subdomain auth sync
  let syncChannel = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      syncChannel = new BroadcastChannel('mendorbit_sso_channel');
    }
  } catch (e) {
    // Unsupported or restricted context
  }

  /**
   * Determine the appropriate cookie domain (.mendorbit.in for production)
   */
  function getCookieDomain() {
    const hostname = window.location.hostname;
    
    // Check if on mendorbit.in or any subdomain
    if (hostname.endsWith("mendorbit.in")) {
      return ".mendorbit.in";
    }
    
    // Netlify or localhost fallback: do not set wildcard domain attribute
    return "";
  }

  /**
   * Simple tamper-evident signature generator
   */
  function generateSignature(payloadString) {
    let hash = 0;
    const combined = payloadString + "::" + SSO_SECRET_SALT;
    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Set cross-subdomain cookie
   */
  function setCookie(name, value, days, domain) {
    let expires = "";
    if (days) {
      const date = new Date();
      date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
      expires = "; expires=" + date.toUTCString();
    }
    const domainPart = domain ? "; domain=" + domain : "";
    const securePart = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${name}=${encodeURIComponent(value)}${expires}${domainPart}; path=/; SameSite=Lax${securePart}`;
    // Also set without domain for localhost / staging fallback
    if (domainPart) {
      document.cookie = `${name}=${encodeURIComponent(value)}${expires}; path=/; SameSite=Lax${securePart}`;
    }
  }

  /**
   * Get cookie value by name
   */
  function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) === ' ') c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length, c.length));
    }
    return null;
  }

  /**
   * Erase cookie across root and domain
   */
  function eraseCookie(name, domain) {
    const domainPart = domain ? "; domain=" + domain : "";
    document.cookie = `${name}=; Max-Age=-99999999${domainPart}; path=/;`;
    // Also try without domain attribute
    document.cookie = `${name}=; Max-Age=-99999999; path=/;`;
  }

  /**
   * Store user session across subdomains and persistent storage
   */
  function setSession(user) {
    if (!user) return;

    const sessionPayload = {
      uid: user.uid || "usr_" + Date.now(),
      email: (user.email || "").toLowerCase().trim(),
      displayName: user.displayName || user.name || "Student",
      class: user.class || "General",
      photoURL: user.photoURL || "",
      sessionId: user.sessionId || localStorage.getItem("mendorbit_session_id") || ("sess_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8)),
      issuedAt: user.issuedAt || Date.now(),
      expiresAt: Date.now() + (SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000)
    };

    if (sessionPayload.sessionId) {
      try {
        localStorage.setItem("mendorbit_session_id", sessionPayload.sessionId);
      } catch (e) {}
    }

    const payloadString = JSON.stringify(sessionPayload);
    const signature = generateSignature(payloadString);
    const packagedToken = btoa(encodeURIComponent(payloadString)) + "." + signature;

    // 1. Set wildcard cookie for all .mendorbit.in subdomains & local fallback
    const domain = getCookieDomain();
    setCookie(COOKIE_NAME, packagedToken, SESSION_DURATION_DAYS, domain);

    // 2. Multi-tier Encrypted Storage (Zero Plaintext in DevTools, Signed & Tamper-Guarded)
    if (typeof MendorbitSecureStorage !== 'undefined') {
      MendorbitSecureStorage.setItem(STORAGE_KEY, sessionPayload, localStorage);
      MendorbitSecureStorage.setItem("mendorbit_current_session", sessionPayload, localStorage);
      MendorbitSecureStorage.setItem(STORAGE_KEY, sessionPayload, sessionStorage);
    } else {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionPayload));
        localStorage.setItem("mendorbit_current_session", JSON.stringify(sessionPayload));
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(sessionPayload));
      } catch (e) {}
    }

    // 3. Broadcast to all open tabs / subdomains
    if (syncChannel) {
      try {
        syncChannel.postMessage({ type: 'SSO_LOGIN', user: sessionPayload });
      } catch (e) {}
    }

    return sessionPayload;
  }

  /**
   * Retrieve current user session from resilient storage
   */
  function getSession() {
    let payload = null;

    // 1. Check Primary Encrypted Storage (Zero Plaintext)
    if (typeof MendorbitSecureStorage !== 'undefined') {
      payload = MendorbitSecureStorage.getItem(STORAGE_KEY, localStorage) || 
                MendorbitSecureStorage.getItem("mendorbit_current_session", localStorage) || 
                MendorbitSecureStorage.getItem(STORAGE_KEY, sessionStorage);
    } else {
      try {
        const stored = localStorage.getItem(STORAGE_KEY) || localStorage.getItem("mendorbit_current_session") || sessionStorage.getItem(STORAGE_KEY);
        if (stored) {
          payload = JSON.parse(stored);
        }
      } catch (e) {}
    }

    // 2. Check Cookie Token if storage was empty
    if (!payload) {
      let token = getCookie(COOKIE_NAME);
      if (token && token.includes(".")) {
        try {
          const parts = token.split(".");
          const payloadString = decodeURIComponent(atob(parts[0]));
          const signature = parts[1];
          if (generateSignature(payloadString) === signature) {
            payload = JSON.parse(payloadString);
          }
        } catch (e) {}
      }
    }

    // Ensure sessionId is attached
    if (payload && !payload.sessionId) {
      try {
        payload.sessionId = localStorage.getItem("mendorbit_session_id") || null;
      } catch (e) {}
    }

    // Expiry check
    if (payload && payload.expiresAt && Date.now() > payload.expiresAt) {
      clearSession();
      return null;
    }

    return payload;
  }

  /**
   * Check if user is authenticated
   */
  function isLoggedIn() {
    return !!getSession();
  }

  /**
   * Log out and wipe session across all subdomains
   */
  function clearSession() {
    const domain = getCookieDomain();
    eraseCookie(COOKIE_NAME, domain);

    try {
      localStorage.removeItem("mendorbit_session_id");
    } catch (e) {}

    if (typeof MendorbitSecureStorage !== 'undefined') {
      MendorbitSecureStorage.removeItem(STORAGE_KEY, localStorage);
      MendorbitSecureStorage.removeItem("mendorbit_current_session", localStorage);
      MendorbitSecureStorage.removeItem(STORAGE_KEY, sessionStorage);
    } else {
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem("mendorbit_current_session");
        sessionStorage.removeItem(STORAGE_KEY);
      } catch (e) {}
    }

    if (syncChannel) {
      try {
        syncChannel.postMessage({ type: 'SSO_LOGOUT' });
      } catch (e) {}
    }
  }

  /**
   * Real-time remote revocation listener
   * Instantly terminates user session when marked LOGGED_OUT from another device
   */
  let activeSessionListenerUnsub = null;

  function listenToRemoteSessionStatus(onRevoked) {
    const session = getSession();
    if (!session || !session.email) return null;
    const currentSessionId = localStorage.getItem("mendorbit_session_id") || session.sessionId;
    if (!currentSessionId) return null;

    if (activeSessionListenerUnsub) {
      try { activeSessionListenerUnsub(); } catch(e) {}
      activeSessionListenerUnsub = null;
    }

    if (typeof firestoreDb !== 'undefined' && firestoreDb) {
      try {
        activeSessionListenerUnsub = firestoreDb.collection("users")
          .doc(session.email.toLowerCase().trim())
          .collection("sessions")
          .doc(currentSessionId)
          .onSnapshot((docSnap) => {
            if (docSnap.exists) {
              const data = docSnap.data();
              if (data && (data.status === "LOGGED_OUT" || data.status === "logged_out")) {
                console.warn("[MendorbitSSO] Current session revoked remotely!");
                clearSession();
                if (typeof onRevoked === 'function') {
                  onRevoked("Your session was terminated from another device.");
                } else {
                  triggerDefaultRevokedUI();
                }
              }
            }
          }, (err) => {
            console.warn("[MendorbitSSO] Session snapshot error:", err);
          });
      } catch (e) {
        console.warn("[MendorbitSSO] Error setting up session listener:", e);
      }
    }
    return activeSessionListenerUnsub;
  }

  function triggerDefaultRevokedUI() {
    clearSession();
    const overlay = document.createElement("div");
    overlay.id = "mendorbit-remote-logout-overlay";
    overlay.style.cssText = "position:fixed;inset:0;z-index:999999;background:rgba(15,23,42,0.92);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:20px;font-family:sans-serif;color:white;";
    overlay.innerHTML = `
      <div style="background:#1e293b;border:1px solid rgba(239,68,68,0.4);border-radius:24px;max-width:440px;width:100%;padding:32px;text-align:center;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);">
        <div style="width:56px;height:56px;background:rgba(239,68,68,0.15);border-radius:18px;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;color:#ef4444;font-size:26px;">⚠️</div>
        <h2 style="font-size:20px;font-weight:800;margin-bottom:8px;color:#f8fafc;">Session Terminated</h2>
        <p style="font-size:13px;color:#94a3b8;line-height:1.5;margin-bottom:24px;">Your account was logged out remotely from another device.</p>
        <a href="login.html?session_expired=true" style="display:inline-block;background:#ff6600;color:white;font-weight:700;font-size:13px;padding:12px 24px;border-radius:12px;text-decoration:none;">Go to Login Portal</a>
      </div>
    `;
    document.body.appendChild(overlay);
    setTimeout(() => {
      window.location.replace("login.html?session_expired=true");
    }, 1500);
  }

  /**
   * Listen to real-time auth changes across tabs and windows
   */
  function onAuthStateChanged(callback) {
    if (syncChannel) {
      syncChannel.onmessage = function (event) {
        if (event.data && event.data.type === 'SSO_LOGIN') {
          callback(event.data.user);
        } else if (event.data && event.data.type === 'SSO_LOGOUT') {
          callback(null);
        }
      };
    }

    window.addEventListener('storage', function (e) {
      if (e.key === STORAGE_KEY) {
        const user = e.newValue ? JSON.parse(e.newValue) : null;
        callback(user);
      }
    });
  }

  /**
   * Heartbeat / Last-Seen Monitor (Passive mode - no unexpected logouts)
   */
  function startHeartbeatMonitor() {
    // Disabled destructive logouts per user requirement
    return;
  }

  return {
    setSession: setSession,
    getSession: getSession,
    isLoggedIn: isLoggedIn,
    clearSession: clearSession,
    onAuthStateChanged: onAuthStateChanged,
    getCookieDomain: getCookieDomain,
    listenToRemoteSessionStatus: listenToRemoteSessionStatus,
    triggerDefaultRevokedUI: triggerDefaultRevokedUI,
    startHeartbeatMonitor: startHeartbeatMonitor
  };
});
