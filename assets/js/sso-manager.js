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
      hasCustomAvatar: !!user.hasCustomAvatar || !!user.photoURL,
      isVerified: !!user.isVerified || !!user.kycCompleted,
      kycCompleted: !!user.kycCompleted || !!user.isVerified,
      phone: user.phone || "",
      sessionId: user.sessionId || localStorage.getItem("mendorbit_session_id") || ("sess_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8)),
      issuedAt: user.issuedAt || Date.now(),
      expiresAt: Date.now() + (SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000)
    };

    if (sessionPayload.sessionId) {
      try {
        localStorage.setItem("mendorbit_session_id", sessionPayload.sessionId);
      } catch (e) {}
    }

    // Strip oversized photoURL from cookie payload so cookie stays < 2KB (safe from browser 4096-byte limit)
    const cookiePayload = {
      ...sessionPayload,
      photoURL: (sessionPayload.photoURL && sessionPayload.photoURL.length > 500) ? "" : (sessionPayload.photoURL || "")
    };
    const payloadString = JSON.stringify(cookiePayload);
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

    // Hydrate cached custom avatar and verified status if omitted from lightweight cookie
    if (payload && payload.email) {
      const norm = payload.email.toLowerCase().trim();
      try {
        const cached = JSON.parse(localStorage.getItem("mendorbit_profile_" + norm) || "{}");
        if (cached) {
          if (cached.photoURL && !payload.photoURL) {
            payload.photoURL = cached.photoURL;
            payload.hasCustomAvatar = true;
          }
          if (cached.hasCustomAvatar) {
            payload.hasCustomAvatar = true;
          }
          if (cached.isVerified || cached.kycCompleted) {
            payload.isVerified = true;
            payload.kycCompleted = true;
          }
          if (cached.phone && !payload.phone) {
            payload.phone = cached.phone;
          }
        }
      } catch (e) {}
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
    // If a session exists and has not yet been revoked, emit background beacon as fallback
    try {
      const sess = getSession();
      const sId = localStorage.getItem("mendorbit_session_id") || (sess ? sess.sessionId : null);
      if (sess && sess.email && sId && navigator.sendBeacon) {
        const payload = JSON.stringify({ email: sess.email.toLowerCase().trim(), sessionId: sId });
        navigator.sendBeacon("/api/auth/revoke-session", new Blob([payload], { type: "application/json" }));
      }
    } catch(e) {}

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

  let isManualLoggingOut = false;

  /**
   * Complete Logout Flow:
   * 1. Marks current session as LOGGED_OUT and isOnline: false in Firestore
   * 2. Calls backend Worker API via keepalive beacon so revocation is guaranteed
   * 3. Wipes cookies and local storage (clearSession)
   * 4. Redirects to login page
   */
  async function logout(redirectUrl = "login.html?logged_out=true") {
    isManualLoggingOut = true;
    try {
      sessionStorage.setItem("mendorbit_manual_logout", "true");
    } catch (e) {}

    if (activeSessionListenerUnsub) {
      try { activeSessionListenerUnsub(); } catch (e) {}
      activeSessionListenerUnsub = null;
    }

    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }

    const session = getSession();
    const email = session ? session.email : null;
    const sessionId = localStorage.getItem("mendorbit_session_id") || (session ? session.sessionId : null);

    if (email && sessionId) {
      const emailNorm = email.toLowerCase().trim();
      const nowIso = new Date().toISOString();
      const nowEpoch = Date.now();

      // 1. Direct Firestore write
      if (typeof firestoreDb !== 'undefined' && firestoreDb) {
        try {
          const sessRef = firestoreDb.collection("users").doc(emailNorm).collection("sessions").doc(sessionId);
          await sessRef.set({
            status: "LOGGED_OUT",
            isOnline: false,
            loggedOutAt: nowIso,
            lastActive: nowIso,
            lastActiveEpoch: nowEpoch
          }, { merge: true });

          const rootMap = {};
          rootMap[`sessions.${sessionId}.status`] = "LOGGED_OUT";
          rootMap[`sessions.${sessionId}.isOnline`] = false;
          rootMap[`sessions.${sessionId}.loggedOutAt`] = nowIso;
          rootMap[`sessions.${sessionId}.lastActive`] = nowIso;
          rootMap[`sessions.${sessionId}.lastActiveEpoch`] = nowEpoch;
          await firestoreDb.collection("users").doc(emailNorm).set(rootMap, { merge: true });
        } catch (e) {
          console.warn("[MendorbitSSO] Direct Firestore revoke note:", e);
        }
      }

      // 2. MendorbitBackend helper if available
      if (typeof MendorbitBackend !== 'undefined' && MendorbitBackend.revokeUserSession) {
        try {
          await MendorbitBackend.revokeUserSession(emailNorm, sessionId);
        } catch (e) {}
      }

      // 3. Worker API keepalive beacon (guaranteed delivery)
      const payload = JSON.stringify({ email: emailNorm, sessionId: sessionId });
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon("/api/auth/revoke-session", new Blob([payload], { type: "application/json" }));
        } else {
          fetch("/api/auth/revoke-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            keepalive: true
          }).catch(() => {});
        }
      } catch (e) {}
    }

    // 4. Wipe local session
    clearSession();

    // 5. Navigate
    if (redirectUrl) {
      window.location.href = redirectUrl;
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
            if (isManualLoggingOut || sessionStorage.getItem("mendorbit_manual_logout") === "true") {
              return;
            }
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
    if (isManualLoggingOut || sessionStorage.getItem("mendorbit_manual_logout") === "true") {
      return;
    }
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
   * Real-Time Heartbeat & Last-Seen Engine
   * Optimized for minimal Firebase write limits: 60s interval with smart throttling
   */
  let heartbeatInterval = null;
  let lastHeartbeatSentEpoch = 0;

  function updateHeartbeatState(isOnline = true, force = false) {
    const session = getSession();
    const sessionId = (session && session.sessionId) || localStorage.getItem("mendorbit_session_id");
    if (!session || !session.email || !sessionId) return;

    const nowEpoch = Date.now();
    // Throttle positive pings to at most once every 45 seconds to conserve Firebase writes
    if (!force && isOnline && (nowEpoch - lastHeartbeatSentEpoch < 45000)) {
      return;
    }
    lastHeartbeatSentEpoch = nowEpoch;

    const emailNorm = session.email.toLowerCase().trim();
    const nowIso = new Date().toISOString();

    if (typeof firestoreDb !== 'undefined' && firestoreDb) {
      const updateData = {
        lastActive: nowIso,
        lastActiveEpoch: nowEpoch,
        isOnline: isOnline
      };
      // Write to session doc in subcollection (Clean & quota-friendly)
      firestoreDb.collection("users").doc(emailNorm).collection("sessions").doc(sessionId).set(updateData, { merge: true }).catch(() => {});
    }
  }

  function sendOfflineSignal() {
    const session = getSession();
    const sessionId = (session && session.sessionId) || localStorage.getItem("mendorbit_session_id");
    if (!session || !session.email || !sessionId) return;
    const emailNorm = session.email.toLowerCase().trim();

    // 1. Direct Firestore write (forced immediately)
    updateHeartbeatState(false, true);

    // 2. Guaranteed background beacon (delivered even after browser window destroys)
    const payload = JSON.stringify({ email: emailNorm, sessionId: sessionId });
    const offlineUrl = "/api/auth/session-offline";
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(offlineUrl, new Blob([payload], { type: "application/json" }));
      } else {
        fetch(offlineUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
      }
    } catch(e) {}
  }

  function startHeartbeatMonitor() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);

    // Initial online ping
    updateHeartbeatState(true, true);

    // Periodic ping every 60 seconds (Quota-friendly & battery-efficient)
    heartbeatInterval = setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        updateHeartbeatState(true);
      }
    }, 60000);

    // Visibility change triggers (immediate online / offline state)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        sendOfflineSignal();
      } else if (navigator.onLine) {
        updateHeartbeatState(true);
      }
    });

    window.addEventListener('beforeunload', () => {
      sendOfflineSignal();
    });

    window.addEventListener('pagehide', () => {
      sendOfflineSignal();
    });

    window.addEventListener('offline', () => {
      sendOfflineSignal();
    });

    window.addEventListener('online', () => {
      updateHeartbeatState(true);
    });
  }

  // Auto-start heartbeat if user is logged in
  if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
      if (isLoggedIn()) {
        startHeartbeatMonitor();
      }
    });
  }

  /**
   * Enforce mandatory authentication with preserved redirect path and UTM params
   */
  function requireAuthWithRedirect(loginPath) {
    const sess = getSession();
    if (sess && sess.email) return sess;

    const currentTarget = (window.location.pathname || "/index.html") + (window.location.search || "") + (window.location.hash || "");
    const targetParams = new URLSearchParams();
    targetParams.set("redirect", currentTarget);

    // Forward any active UTM / attribution params onto the login URL
    try {
      const curQs = new URLSearchParams(window.location.search || "");
      const utmKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "referral", "gclid", "fbclid"];
      utmKeys.forEach(k => {
        const v = curQs.get(k);
        if (v) targetParams.set(k, v);
      });
    } catch (e) {}

    const base = loginPath || "/login.html";
    window.location.replace(base + "?" + targetParams.toString());
    return null;
  }

  return {
    setSession: setSession,
    getSession: getSession,
    isLoggedIn: isLoggedIn,
    clearSession: clearSession,
    logout: logout,
    requireAuthWithRedirect: requireAuthWithRedirect,
    onAuthStateChanged: onAuthStateChanged,
    getCookieDomain: getCookieDomain,
    listenToRemoteSessionStatus: listenToRemoteSessionStatus,
    triggerDefaultRevokedUI: triggerDefaultRevokedUI,
    startHeartbeatMonitor: startHeartbeatMonitor
  };
});
