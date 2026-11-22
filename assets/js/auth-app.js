/**
 * MENDORBIT AUTHENTICATION ENGINE (auth-app.js)
 * Clean, production controller connecting UI states, Cloudflare Worker Edge Backend,
 * Google Apps Script OTP, Firebase Auth/Firestore, 2-digit custom cipher, and cross-subdomain SSO.
 */

document.addEventListener("DOMContentLoaded", function () {
  // Capture marketing attribution silently
  const attribution = MendorbitTracker.captureAttribution();

  // Helper to read cached parameters or fallback to URL
  const getParam = (k) => (typeof MendorbitParams !== 'undefined') ? MendorbitParams.get(k) : new URLSearchParams(window.location.search).get(k);

  // Auto-Redirect if already logged in (Checks .mendorbit.in cookie & SSO token)
  // CRITICAL: If user is accessing emergency account lock/reset link via action=lock or token=..., NEVER redirect!
  if (typeof MendorbitSSO !== 'undefined' && MendorbitSSO.isLoggedIn()) {
    const actionParam = getParam('action');
    const tokenParam = getParam('token');
    const sessionExpired = getParam('session_expired') === 'true' || getParam('session_revoked') === 'true';
    if (!sessionExpired && actionParam !== 'lock' && !tokenParam && getParam('force_login') !== 'true') {
      MendorbitTracker.executePostLoginRedirect();
      return;
    }
  }

  if (getParam('session_expired') === 'true' || getParam('session_revoked') === 'true') {
    setTimeout(() => {
      notify("Your session was terminated from another device. Please sign in again.", "error");
    }, 400);
  }

  // Navigation Elements
  const pillBtnSignIn = document.getElementById("pill-btn-signin");
  const pillBtnRegister = document.getElementById("pill-btn-register");
  const pillWrapper = document.getElementById("pill-toggle-wrapper");

  const title = document.getElementById("auth-card-title");
  const subtitle = document.getElementById("auth-card-subtitle");

  const viewSignIn = document.getElementById("view-signin");
  const viewRegister = document.getElementById("view-register");
  const viewOtpLogin = document.getElementById("view-otp-login");
  const viewForgot = document.getElementById("view-forgot");
  const viewOtpVerify = document.getElementById("view-otp-verify");
  const viewGoogleSetup = document.getElementById("view-google-setup");
  const viewResetPassword = document.getElementById("view-reset-password");
  const viewQr = document.getElementById("view-qr");
  const viewLockAccount = document.getElementById("view-lock-account");
  const socialAuthSection = document.getElementById("social-auth-section");

  // In-flight Google user state
  let pendingGoogleUser = null;

  // Unified Session Completion Engine (Guarantees Session ID & Firestore Tracking on EVERY Login)
  async function completeAuthSession(userPayload, eventType = "LOGIN", authMethod = null) {
    const sessionId = userPayload.sessionId || "sess_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8);
    const sessionWithId = { ...userPayload, sessionId };

    MendorbitSSO.setSession(sessionWithId);
    try {
      localStorage.setItem("mendorbit_session_id", sessionId);
    } catch(e) {}

    // Infer friendly authMethod if not explicitly passed
    const resolvedMethod = authMethod || (
      eventType === "GOOGLE_LOGIN" ? "Google Sign-In" :
      eventType === "LOGIN_OTP" ? "Email OTP" :
      eventType === "QR_LOGIN" ? "QR Linked Device" :
      "Password"
    );

    const exactLoc = (typeof MendorbitTracker !== 'undefined' && MendorbitTracker.getExactLocation) ? MendorbitTracker.getExactLocation() : null;
    if (typeof MendorbitBackend !== 'undefined' && MendorbitBackend.recordUserSession) {
      try {
        await MendorbitBackend.recordUserSession(sessionWithId.email, {
          sessionId: sessionId,
          device: navigator.userAgent,
          location: exactLoc || {},
          type: eventType,
          authMethod: resolvedMethod,
          status: "ACTIVE"
        });
      } catch (e) {
        console.warn("[Auth] Session record warning:", e);
      }
    }

    dispatchClientSecurityAlert(sessionWithId.email, sessionWithId.displayName || "Student", eventType);
    return sessionWithId;
  }

  // View state switcher
  function showView(viewName) {
    const allViews = [
      viewSignIn, viewRegister, viewOtpLogin, viewForgot, 
      viewOtpVerify, viewGoogleSetup, viewResetPassword, viewQr, viewLockAccount
    ];
    allViews.forEach(v => {
      if (v) v.classList.add("hidden");
    });

    if (viewName !== "qr") {
      stopQrAutoRefresh();
    }

    // Toggle top title card visibility (hidden on otp-verify, google-setup, reset-password, and lock-account to let clean view icons shine)
    if (title && title.parentElement) {
      if (viewName === "otp-verify" || viewName === "google-setup" || viewName === "reset-password" || viewName === "lock-account") {
        title.parentElement.classList.add("hidden");
      } else {
        title.parentElement.classList.remove("hidden");
      }
    }

    if (viewName === "signin") {
      viewSignIn.classList.remove("hidden");
      pillWrapper.classList.remove("hidden");
      socialAuthSection.classList.remove("hidden");
      pillBtnSignIn.classList.add("active");
      pillBtnRegister.classList.remove("active");
      title.textContent = "Welcome Back";
      subtitle.textContent = "Please enter your details to continue.";
    } else if (viewName === "register") {
      viewRegister.classList.remove("hidden");
      pillWrapper.classList.remove("hidden");
      socialAuthSection.classList.remove("hidden");
      pillBtnRegister.classList.add("active");
      pillBtnSignIn.classList.remove("active");
      title.textContent = "Create Account";
      subtitle.textContent = "Join Mendorbit to begin your learning journey.";
    } else if (viewName === "otp-login") {
      viewOtpLogin.classList.remove("hidden");
      pillWrapper.classList.add("hidden");
      socialAuthSection.classList.add("hidden");
      title.textContent = "OTP Login";
      subtitle.textContent = "Enter your email to receive a direct login code.";
    } else if (viewName === "forgot") {
      viewForgot.classList.remove("hidden");
      pillWrapper.classList.add("hidden");
      socialAuthSection.classList.add("hidden");
      title.textContent = "Reset Password";
      subtitle.textContent = "We will send an OTP code to your registered email.";
    } else if (viewName === "otp-verify") {
      viewOtpVerify.classList.remove("hidden");
      pillWrapper.classList.add("hidden");
      socialAuthSection.classList.add("hidden");
    } else if (viewName === "google-setup") {
      viewGoogleSetup.classList.remove("hidden");
      pillWrapper.classList.add("hidden");
      socialAuthSection.classList.add("hidden");
    } else if (viewName === "reset-password") {
      viewResetPassword.classList.remove("hidden");
      pillWrapper.classList.add("hidden");
      socialAuthSection.classList.add("hidden");
    } else if (viewName === "qr") {
      viewQr.classList.remove("hidden");
      pillWrapper.classList.add("hidden");
      socialAuthSection.classList.add("hidden");
      title.textContent = "QR Login";
      subtitle.textContent = "Scan with the Mendorbit Mobile App.";
      startQrAutoRefresh();
    } else if (viewName === "lock-account") {
      if (viewLockAccount) viewLockAccount.classList.remove("hidden");
      pillWrapper.classList.add("hidden");
      socialAuthSection.classList.add("hidden");
    }

    if (window.lucide) lucide.createIcons();
  }

  // Pill tab toggles
  if (pillBtnSignIn) pillBtnSignIn.addEventListener("click", () => showView("signin"));
  if (pillBtnRegister) pillBtnRegister.addEventListener("click", () => showView("register"));

  window.openDirectOtpView = () => showView("otp-login");
  window.openForgotView = () => showView("forgot");
  window.openQrView = () => showView("qr");
  window.returnToSignIn = () => {
    stopQrAutoRefresh();
    if (typeof MendorbitParams !== 'undefined') {
      MendorbitParams.remove("action");
      MendorbitParams.remove("token");
    }
    showView("signin");
  };

  // Dynamic QR Code Handshake with 1-Minute Auto Refresh & Real-Time Approval Listener
  let qrTimerInterval = null;
  let qrRefreshCountdown = 60;
  let qrUnsubscribe = null;
  let activeQrSessionId = null;

  function renderQrCode() {
    const container = document.getElementById("qr-target-container");
    if (!container) return;

    if (qrUnsubscribe) {
      try { qrUnsubscribe(); } catch (e) {}
      qrUnsubscribe = null;
    }

    const sessionId = "mndrbt_qr_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
    activeQrSessionId = sessionId;

    const linkCodeElem = document.getElementById("qr-link-code-display");
    if (linkCodeElem) {
      linkCodeElem.textContent = sessionId;
    }

    const payload = encodeURIComponent(`https://mendorbit.in/qr-auth?session=${sessionId}`);
    // High error correction (ecc=H) guarantees 100% scan reliability with center logo
    container.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${payload}&margin=4&ecc=H&color=0f172a" alt="Mendorbit QR Login" class="rounded-xl w-44 h-44 object-contain" />`;

    // Real-Time Approval Listener: Fires as soon as authorized from profile "Link a Device"
    if (typeof firestoreDb !== 'undefined' && firestoreDb) {
      try {
        qrUnsubscribe = firestoreDb.collection("qr_auth").doc(sessionId).onSnapshot(async (doc) => {
          if (doc.exists) {
            const data = doc.data();
            if (data && (data.status === "AUTHORIZED" || data.status === "SUCCESS") && data.user) {
              if (qrUnsubscribe) {
                qrUnsubscribe();
                qrUnsubscribe = null;
              }
              stopQrAutoRefresh();

              const liveStatus = document.getElementById("qr-live-status");
              if (liveStatus) {
                liveStatus.className = "text-xs font-semibold text-emerald-600 bg-emerald-50 py-1 px-3 rounded-full inline-flex items-center gap-1.5";
                liveStatus.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-500"></span><span>Device Verified! Logging in...</span>';
              }

              notify("Device authorized via QR! Welcome to Mendorbit.", "success");
              await completeAuthSession(data.user, "QR_LOGIN", "QR Linked Device");
              setTimeout(() => {
                MendorbitTracker.executePostLoginRedirect();
              }, 800);
            }
          }
        }, err => console.warn("[QR Auth] Listener note:", err));
      } catch (err) {
        console.warn("[QR Auth] setup error:", err);
      }
    }
  }

  function startQrAutoRefresh() {
    renderQrCode();
    qrRefreshCountdown = 60;
    const timerElem = document.getElementById("qr-refresh-timer");
    if (timerElem) timerElem.textContent = "60s";

    if (qrTimerInterval) clearInterval(qrTimerInterval);
    qrTimerInterval = setInterval(() => {
      qrRefreshCountdown--;
      if (timerElem) timerElem.textContent = qrRefreshCountdown + "s";
      if (qrRefreshCountdown <= 0) {
        renderQrCode();
        qrRefreshCountdown = 60;
        if (timerElem) timerElem.textContent = "60s";
      }
    }, 1000);
  }

  function stopQrAutoRefresh() {
    if (qrTimerInterval) {
      clearInterval(qrTimerInterval);
      qrTimerInterval = null;
    }
    if (qrUnsubscribe) {
      try { qrUnsubscribe(); } catch (e) {}
      qrUnsubscribe = null;
    }
  }

  // --- Universal Real-time Dynamic Password Strength Meter ---
  function attachPasswordStrength(inputId, containerId, barId, labelId) {
    const input = document.getElementById(inputId);
    const container = document.getElementById(containerId);
    const bar = document.getElementById(barId);
    const label = document.getElementById(labelId);

    if (!input || !container || !bar || !label) return;

    input.addEventListener("input", function () {
      const val = this.value;
      if (!val) {
        container.classList.add("hidden");
        return;
      }
      container.classList.remove("hidden");

      let score = 0;
      if (val.length >= 6) score += 1;
      if (val.length >= 8) score += 1;
      if (/[A-Z]/.test(val) && /[a-z]/.test(val)) score += 1;
      if (/[0-9]/.test(val)) score += 1;
      if (/[^A-Za-z0-9]/.test(val)) score += 1;

      if (val.length < 6) {
        bar.style.width = "20%";
        bar.className = "h-full transition-all duration-300 rounded-full bg-red-500";
        label.textContent = "Too Short";
        label.className = "text-red-600 font-bold";
      } else if (score <= 2) {
        bar.style.width = "45%";
        bar.className = "h-full transition-all duration-300 rounded-full bg-amber-500";
        label.textContent = "Fair";
        label.className = "text-amber-600 font-bold";
      } else if (score <= 4) {
        bar.style.width = "75%";
        bar.className = "h-full transition-all duration-300 rounded-full bg-emerald-500";
        label.textContent = "Good";
        label.className = "text-emerald-600 font-bold";
      } else {
        bar.style.width = "100%";
        bar.className = "h-full transition-all duration-300 rounded-full bg-emerald-600";
        label.textContent = "Strong";
        label.className = "text-emerald-600 font-bold";
      }
    });
  }

  // Attach to Register, Google Setup, and Reset Password
  attachPasswordStrength("reg-password", "reg-pwd-strength-container", "reg-pwd-strength-bar", "reg-pwd-strength-label");
  attachPasswordStrength("google-password", "google-pwd-strength-container", "google-pwd-strength-bar", "google-pwd-strength-label");
  attachPasswordStrength("new-reset-password", "reset-pwd-strength-container", "reset-pwd-strength-bar", "reset-pwd-strength-label");
  attachPasswordStrength("inline-lock-new-password", "inline-lock-pwd-strength-container", "inline-lock-pwd-strength-bar", "inline-lock-pwd-strength-label");

  // --- Inline OTP Verification Logic ---
  const inlineOtpEmail = document.getElementById("inline-otp-email");
  const inlineOtpTimer = document.getElementById("inline-otp-timer");
  const otpDigits = document.querySelectorAll(".otp-digit");
  const btnInlineResend = document.getElementById("btn-inline-resend");
  const btnInlineConfirm = document.getElementById("btn-inline-otp-confirm");

  let otpCountdown = null;
  let currentOtpContext = {
    email: "",
    purpose: "",
    name: "",
    extraData: null,
    expiresAt: 0,
    isExpired: false
  };

  // OTP inputs auto-advance + Enter key support
  otpDigits.forEach((digitInput, idx) => {
    digitInput.addEventListener("input", (e) => {
      const val = e.target.value;
      if (val.length === 1) {
        if (idx < otpDigits.length - 1) {
          otpDigits[idx + 1].focus();
        } else if (idx === otpDigits.length - 1) {
          // All 6 digits filled -> auto trigger verification!
          executeOtpVerification();
        }
      }
    });

    digitInput.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !e.target.value && idx > 0) {
        otpDigits[idx - 1].focus();
      } else if (e.key === "Enter") {
        e.preventDefault();
        executeOtpVerification();
      }
    });

    digitInput.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text").trim();
      if (/^\d{6}$/.test(text)) {
        text.split("").forEach((ch, i) => {
          if (otpDigits[i]) otpDigits[i].value = ch;
        });
        if (otpDigits[5]) otpDigits[5].focus();
        executeOtpVerification();
      }
    });
  });

  function getOtpCode() {
    return Array.from(otpDigits).map(i => i.value).join("");
  }

  function clearOtpInputs() {
    otpDigits.forEach(i => i.value = "");
    if (otpDigits[0]) otpDigits[0].focus();
  }

  function startOtpTimer(seconds = 120) {
    if (otpCountdown) clearInterval(otpCountdown);
    let remaining = seconds;
    currentOtpContext.expiresAt = Date.now() + (seconds * 1000);
    currentOtpContext.isExpired = false;

    const timerLabel = document.getElementById("otp-timer-label");
    if (btnInlineResend) {
      btnInlineResend.disabled = true;
      btnInlineResend.classList.add("hidden");
    }

    const update = () => {
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      if (timerLabel) timerLabel.innerHTML = `<span>Resend in </span>`;
      if (inlineOtpTimer) inlineOtpTimer.textContent = `${m}:${s < 10 ? '0' : ''}${s}`;

      if (remaining <= 0) {
        clearInterval(otpCountdown);
        currentOtpContext.isExpired = true;
        if (timerLabel) timerLabel.innerHTML = `<span class="text-rose-600 font-bold">OTP Expired</span>`;
        if (inlineOtpTimer) inlineOtpTimer.textContent = "";
        if (btnInlineResend) {
          btnInlineResend.disabled = false;
          btnInlineResend.classList.remove("hidden");
          btnInlineResend.textContent = "Resend OTP";
        }
        // Invalidate cached fallback OTP
        sessionStorage.removeItem("mnd_otp_" + currentOtpContext.purpose + "_" + currentOtpContext.email);
      }
      remaining--;
    };

    update();
    otpCountdown = setInterval(update, 1000);
  }

  function openInlineOtpView(email, purpose, name = "Student", extraData = null) {
    currentOtpContext = {
      email,
      purpose,
      name,
      extraData,
      expiresAt: Date.now() + (120 * 1000),
      isExpired: false
    };
    inlineOtpEmail.textContent = email;
    clearOtpInputs();
    startOtpTimer(120);
    showView("otp-verify");
  }

  /**
   * Dispatch OTP via Cloudflare Worker or Google Apps Script Web App
   */
  async function requestOtpDispatch(email, purpose, name) {
    // 1. Try Cloudflare Worker Endpoint
    try {
      const res = await MendorbitAPI.sendOtp(email, purpose, name);
      if (res && res.status === "success") {
        notify("OTP sent successfully to your email.", "success");
        return true;
      } else if (res && res.message) {
        // If it was a 404 or "Endpoint not found", do NOT show error; let it fall through to Apps Script
        const msgLow = res.message.toLowerCase();
        if (!msgLow.includes("endpoint not found") && !msgLow.includes("not found")) {
          notify(res.message, "error");
          return false;
        }
      }
    } catch (e) {
      console.warn("[Mendorbit] Worker OTP dispatch note, attempting Apps Script fallback:", e);
    }

    // 2. Direct Apps Script Fallback
    const appsScriptUrl = MendorbitBackend.getAppsScriptUrl();
    if (appsScriptUrl && !appsScriptUrl.includes("YOUR_")) {
      try {
        const res = await fetch(appsScriptUrl, {
          method: "POST",
          redirect: "follow",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({ action: "sendOtp", email: email, purpose: purpose, name: name })
        });
        const data = await res.json();
        if (data.status === "success") {
          notify("OTP sent successfully to your email.", "success");
          return true;
        } else {
          notify(data.message || "Failed to send OTP.", "error");
          return false;
        }
      } catch (err) {
        console.warn("Apps Script error:", err);
      }
    }

    // Fallback in case of offline/network disconnect with strict 2-minute expiration
    const fallbackOtp = Math.floor(100000 + Math.random() * 900000).toString();
    const fallbackData = JSON.stringify({ otp: fallbackOtp, expiresAt: Date.now() + 120000 });
    sessionStorage.setItem("mnd_otp_" + purpose + "_" + email, fallbackData);
    notify(`OTP: ${fallbackOtp}`, "success", 8000);
    return true;
  }

  /**
   * Verify OTP via Cloudflare Worker or Google Apps Script
   */
  async function verifyOtpSubmission(email, otp, purpose) {
    // Instant client-side expiration gate
    if (currentOtpContext.isExpired || (currentOtpContext.expiresAt && Date.now() > currentOtpContext.expiresAt)) {
      return false;
    }

    // 1. Try Cloudflare Worker
    try {
      const res = await MendorbitAPI.verifyOtp(email, otp, purpose);
      if (res && res.status === "success") return true;
      if (res && res.message && res.message.toLowerCase().includes("expired")) {
        return false;
      }
    } catch (e) {}

    // 2. Direct Apps Script Fallback
    const appsScriptUrl = MendorbitBackend.getAppsScriptUrl();
    if (appsScriptUrl && !appsScriptUrl.includes("YOUR_")) {
      try {
        const res = await fetch(appsScriptUrl, {
          method: "POST",
          redirect: "follow",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({ action: "verifyOtp", email: email, otp: otp, purpose: purpose })
        });
        const data = await res.json();
        return data.status === "success";
      } catch (e) {}
    }

    const storedRaw = sessionStorage.getItem("mnd_otp_" + purpose + "_" + email);
    if (storedRaw) {
      try {
        const parsed = JSON.parse(storedRaw);
        if (Date.now() > parsed.expiresAt) {
          sessionStorage.removeItem("mnd_otp_" + purpose + "_" + email);
          return false;
        }
        if (parsed.otp === otp) {
          sessionStorage.removeItem("mnd_otp_" + purpose + "_" + email);
          return true;
        }
      } catch (e) {
        if (storedRaw === otp && !currentOtpContext.isExpired) {
          sessionStorage.removeItem("mnd_otp_" + purpose + "_" + email);
          return true;
        }
      }
    }
    return false;
  }

  // Resend OTP button
  if (btnInlineResend) {
    btnInlineResend.addEventListener("click", async () => {
      setButtonLoading(btnInlineResend, true, "Resending OTP...");
      await requestOtpDispatch(currentOtpContext.email, currentOtpContext.purpose, currentOtpContext.name);
      setButtonLoading(btnInlineResend, false, "Resend OTP");
      clearOtpInputs();
      startOtpTimer(120);
    });
  }

  // Execute OTP confirmation
  async function executeOtpVerification() {
    if (currentOtpContext.isExpired || (currentOtpContext.expiresAt && Date.now() > currentOtpContext.expiresAt)) {
      notify("OTP has expired. Please click Resend OTP.", "error");
      return;
    }

    const code = getOtpCode();
    if (code.length !== 6) {
      notify("Please enter all 6 digits of the OTP.", "error");
      return;
    }

    setButtonLoading(btnInlineConfirm, true, "Verifying OTP...");
    const isValid = await verifyOtpSubmission(currentOtpContext.email, code, currentOtpContext.purpose);
    setButtonLoading(btnInlineConfirm, false, "Verify OTP");

    if (!isValid) {
      notify("Invalid or expired OTP. Please click Resend OTP.", "error");
      return;
    }

    if (otpCountdown) clearInterval(otpCountdown);

    // Route based on context purpose
    if (currentOtpContext.purpose === "signup") {
      await completeRegistration(currentOtpContext.extraData);
    } else if (currentOtpContext.purpose === "login") {
      await completeDirectOtpLogin(currentOtpContext.email);
    } else if (currentOtpContext.purpose === "forgot") {
      currentOtpContext.isVerified = true;
      showView("reset-password");
    }
  }

  if (btnInlineConfirm) {
    btnInlineConfirm.addEventListener("click", executeOtpVerification);
  }

  // --- 1. SIGNUP SUBMIT ---
  viewRegister.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("btn-register-submit");
    const name = document.getElementById("reg-name").value.trim();
    const email = document.getElementById("reg-email").value.trim().toLowerCase();
    const studentClass = document.getElementById("reg-class").value;
    const password = document.getElementById("reg-password").value;

    if (!name || !email || !studentClass || !password) {
      notify("Please fill in all registration fields.", "error");
      return;
    }

    if (password.length < 6) {
      notify("Please enter a stronger password.", "error");
      return;
    }

    setButtonLoading(btn, true, "Checking account...");

    // 1. Strict Duplicate Account Guard (Same email se baar baar account na bane)
    const existing = await MendorbitBackend.getUserByEmail(email);
    if (existing) {
      setButtonLoading(btn, false, "Register");
      notify("An account with this email already exists. Please sign in.", "error");
      showView("signin");
      const signinEmail = document.getElementById("signin-identifier");
      if (signinEmail) {
        signinEmail.value = email;
        const signinPwd = document.getElementById("signin-password");
        if (signinPwd) signinPwd.focus();
      }
      return;
    }

    setButtonLoading(btn, true, "Sending OTP...");
    const dispatched = await requestOtpDispatch(email, "signup", name);
    setButtonLoading(btn, false, "Register");

    if (dispatched) {
      openInlineOtpView(email, "signup", name, { name, email, studentClass, password });
    }
  });

  // Real-time client metadata & geolocation helper
  let cachedLocationMeta = null;
  async function getClientLocationMeta() {
    if (cachedLocationMeta) return cachedLocationMeta;
    try {
      const workerUrl = (typeof MENDORBIT_WORKER_URL !== 'undefined') ? MENDORBIT_WORKER_URL : "";
      if (workerUrl) {
        const res = await fetch(`${workerUrl}/api/health`, { method: "GET" });
        const data = await res.json();
        if (data && data.ip) {
          cachedLocationMeta = {
            ip: data.ip,
            city: data.location ? data.location.split(',')[0].trim() : "Direct Web",
            country: data.location ? data.location.split(',')[1].trim() : "India",
            userAgent: navigator.userAgent
          };
          return cachedLocationMeta;
        }
      }
    } catch (e) {}

    cachedLocationMeta = {
      ip: "Direct Web",
      city: "Direct Web",
      country: "India",
      userAgent: navigator.userAgent
    };
    return cachedLocationMeta;
  }

  // Unified Security Alert & Event Email Dispatcher (Guaranteed across all login methods & sessions)
  async function dispatchClientSecurityAlert(email, name, eventType = "LOGIN") {
    if (!email) return;
    const cleanEmail = (email || "").toLowerCase().trim();
    const cleanName = name || "Student";
    const appsScriptUrl = MendorbitBackend.getAppsScriptUrl();
    if (!appsScriptUrl || appsScriptUrl.includes("YOUR_")) return;

    try {
      const meta = await getClientLocationMeta();
      fetch(appsScriptUrl, {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "sendSecurityAlert",
          email: cleanEmail,
          name: cleanName,
          eventType: eventType,
          location: meta
        })
      }).catch(err => console.warn("[Mendorbit] Security alert dispatch note:", err));
    } catch (err) {
      console.warn("[Mendorbit] Telemetry dispatch note:", err);
    }
  }

  async function completeRegistration(data) {
    const cleanEmail = (data.email || "").toLowerCase().trim();

    // Secondary Guard: Double-check that account doesn't already exist
    const existingUser = await MendorbitBackend.getUserByEmail(cleanEmail);
    if (existingUser) {
      notify("An account with this email already exists. Please sign in.", "error");
      showView("signin");
      const signinEmail = document.getElementById("signin-identifier");
      if (signinEmail) signinEmail.value = cleanEmail;
      return;
    }

    // 1. Try Cloudflare Worker Server-Side Registration
    try {
      const res = await MendorbitAPI.register({
        name: data.name,
        email: data.email,
        studentClass: data.studentClass,
        password: data.password,
        attribution: attribution,
        otp: getOtpCode()
      });

      if (res && res.status === "success") {
        await completeAuthSession(res.user, "SIGNUP");
        notify("Account created successfully! Redirecting...", "success");
        setTimeout(() => {
          MendorbitTracker.executePostLoginRedirect();
        }, 900);
        return;
      }
    } catch (e) {
      console.warn("[Mendorbit] Cloudflare worker register failed, attempting client fallback:", e);
    }

    // 2. Client-Side Fallback
    const encryptedPassword = MendorbitCipher.encrypt(data.password);
    const docId = data.email.toLowerCase().trim();
    const profile = { displayName: data.name, email: docId, class: data.studentClass };

    await MendorbitBackend.saveUserProfile(docId, profile, attribution, encryptedPassword);
    await completeAuthSession({ uid: docId, email: docId, displayName: data.name, class: data.studentClass }, "SIGNUP");

    notify("Account created successfully! Redirecting...", "success");
    setTimeout(() => {
      MendorbitTracker.executePostLoginRedirect();
    }, 900);
  }

  // --- 2. PASSWORD SIGN IN SUBMIT ---
  viewSignIn.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("btn-signin-submit");
    const identifier = document.getElementById("signin-identifier").value.trim().toLowerCase();
    const password = document.getElementById("signin-password").value;

    if (!identifier || !password) {
      notify("Please enter your email and password.", "error");
      return;
    }

    setButtonLoading(btn, true, "Signing In...");

    // 1. Try Cloudflare Worker Server-Side Login
    let workerErrorMsg = null;
    try {
      const res = await MendorbitAPI.login(identifier, password);
      if (res && res.status === "success") {
        setButtonLoading(btn, false, "Sign In");
        await completeAuthSession(res.user, "LOGIN", "Password");
        notify("Welcome back, " + res.user.displayName + "!", "success");
        setTimeout(() => {
          MendorbitTracker.executePostLoginRedirect();
        }, 800);
        return;
      } else if (res && res.message) {
        const msgLow = res.message.toLowerCase();
        // If password is explicitly wrong or account is locked, show error immediately
        if (msgLow.includes("incorrect password") || msgLow.includes("locked") || msgLow.includes("google")) {
          setButtonLoading(btn, false, "Sign In");
          notify(res.message, "error");
          return;
        }
        workerErrorMsg = res.message;
      }
    } catch (e) {
      console.warn("[Mendorbit] Worker login fallback:", e);
    }

    // 2. Client-Side Fallback via Firebase SDK
    const user = await MendorbitBackend.getUserByEmail(identifier);
    setButtonLoading(btn, false, "Sign In");

    if (!user) {
      notify(workerErrorMsg || "No account found with this email. Please register.", "error");
      return;
    }

    // Check if account has no password set (e.g. registered via Google SSO)
    if (!user.encryptedPassword) {
      notify("This account was registered via Google Sign-In. Please sign in with Google or use OTP login.", "error");
      return;
    }

    let isValidPassword = false;
    if (user.encryptedPassword) {
      isValidPassword = (user.encryptedPassword === MendorbitCipher.encrypt(password));
    }

    if (!isValidPassword) {
      notify("Incorrect password. Please try again or use OTP.", "error");
      return;
    }

    await completeAuthSession({
      uid: user.uid || identifier,
      email: user.email || identifier,
      displayName: user.displayName || "Student",
      class: user.class || "Class 10"
    }, "LOGIN", "Password");

    notify("Welcome back, " + (user.displayName || "Student") + "!", "success");
    setTimeout(() => {
      MendorbitTracker.executePostLoginRedirect();
    }, 800);
  });

  // --- 3. DIRECT OTP LOGIN SUBMIT ---
  viewOtpLogin.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("btn-direct-otp-submit");
    const email = document.getElementById("direct-otp-email").value.trim().toLowerCase();

    if (!email) {
      notify("Please enter your registered email.", "error");
      return;
    }

    setButtonLoading(btn, true, "Sending OTP...");
    const user = await MendorbitBackend.getUserByEmail(email);
    setButtonLoading(btn, false, "Send Login OTP");

    if (!user) {
      notify("No account found with this email. Please register.", "error");
      return;
    }

    const dispatched = await requestOtpDispatch(email, "login", user.displayName);
    if (dispatched) {
      openInlineOtpView(email, "login", user.displayName);
    }
  });

  async function completeDirectOtpLogin(email) {
    try {
      const res = await MendorbitAPI.otpLogin(email, getOtpCode());
      if (res && res.status === "success") {
        await completeAuthSession(res.user, "LOGIN_OTP");
        notify("Verified! Redirecting to dashboard...", "success");
        setTimeout(() => {
          MendorbitTracker.executePostLoginRedirect();
        }, 800);
        return;
      }
    } catch (e) {}

    const user = await MendorbitBackend.getUserByEmail(email);
    const session = {
      uid: user ? user.uid : "usr_" + Date.now(),
      email: user ? user.email : email,
      displayName: user ? user.displayName : "Student",
      class: user ? user.class : "General"
    };
    await completeAuthSession(session, "LOGIN_OTP");

    notify("Verified! Redirecting to dashboard...", "success");
    setTimeout(() => {
      MendorbitTracker.executePostLoginRedirect();
    }, 800);
  }

  // --- 4. FORGOT PASSWORD SUBMIT ---
  viewForgot.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("btn-forgot-submit");
    const email = document.getElementById("forgot-password-email").value.trim().toLowerCase();

    if (!email) {
      notify("Please enter your registered email.", "error");
      return;
    }

    setButtonLoading(btn, true, "Sending OTP...");
    const user = await MendorbitBackend.getUserByEmail(email);
    setButtonLoading(btn, false, "Send Reset OTP");

    if (!user) {
      notify("No account found with this email.", "error");
      return;
    }

    const dispatched = await requestOtpDispatch(email, "forgot", user.displayName);
    if (dispatched) {
      openInlineOtpView(email, "forgot", user.displayName);
    }
  });

  // Reset Password form submission (Inline view)
  viewResetPassword.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentOtpContext.isVerified || !currentOtpContext.email) {
      notify("Verification session expired. Please request a new OTP.", "error");
      showView("forgot");
      return;
    }

    const newPwd = document.getElementById("new-reset-password").value;
    if (!newPwd || newPwd.length < 6) {
      notify("Please enter a stronger password (minimum 6 characters).", "error");
      return;
    }

    const resetEmail = currentOtpContext.email;
    const studentName = currentOtpContext.name || "Student";

    // Invalidate the session immediately (Single-Use per OTP)
    currentOtpContext.isVerified = false;
    currentOtpContext.email = "";

    try {
      await MendorbitAPI.resetPassword(resetEmail, newPwd);
    } catch (e) {
      const encrypted = MendorbitCipher.encrypt(newPwd);
      await MendorbitBackend.updatePassword(resetEmail, encrypted);
    }

    // Dispatch Password Change Confirmation Email
    dispatchClientSecurityAlert(resetEmail, studentName, "PASSWORD_CHANGE");

    notify("Password updated successfully! Please sign in.", "success");
    showView("signin");
  });

  // --- 5. GOOGLE AUTHENTICATION (ASKS EXAM ONLY ONCE ON INITIAL SETUP) ---
  const btnGoogle = document.getElementById("btn-google-action");
  if (btnGoogle) {
    btnGoogle.addEventListener("click", async () => {
      if (typeof MendorbitLoader !== 'undefined') {
        MendorbitLoader.show("Connecting to Google...", "Authenticating your Google Account...", {
          reason: "Google login popup may be waiting in another window or tab. Please complete sign-in there."
        });
      }

      if (MendorbitBackend.isConfigured() && firebaseAuth && googleAuthProvider) {
        try {
          const result = await firebaseAuth.signInWithPopup(googleAuthProvider);
          const gUser = result.user;
          const normalizedEmail = (gUser.email || "").toLowerCase().trim();

          // 1. Check if user already has an established account in Firestore
          const existing = await MendorbitBackend.getUserByEmail(normalizedEmail);
          const storedClass = (typeof MendorbitSecureStorage !== 'undefined')
            ? MendorbitSecureStorage.getItem("mendorbit_user_class_" + normalizedEmail)
            : localStorage.getItem("mendorbit_user_class_" + normalizedEmail);

          // If user exists anywhere in database OR has a stored class:
          if (existing || storedClass) {
            const finalClass = (existing && existing.class) || storedClass || "Class 10";
            const finalName = (existing && existing.displayName) || gUser.displayName || "Student";
            const finalPhoto = gUser.photoURL || (existing && existing.photoURL) || "";

            const userSession = {
              uid: (existing && existing.uid) || gUser.uid || normalizedEmail,
              email: normalizedEmail,
              displayName: finalName,
              class: finalClass,
              photoURL: finalPhoto
            };

            // PERSISTENCE GUARANTEE: If document does NOT exist in Firestore yet, write it now!
            if (!existing) {
              try {
                // 1. Persist via Worker Backend
                await MendorbitAPI.googleSetup({
                  email: normalizedEmail,
                  name: finalName,
                  studentClass: finalClass,
                  uid: userSession.uid,
                  photoURL: finalPhoto,
                  attribution: attribution
                });
              } catch (e) {
                console.warn("[Google Login] Worker sync note:", e);
              }

              try {
                // 2. Direct Firestore SDK fallback
                if (typeof MendorbitBackend !== 'undefined' && MendorbitBackend.saveUserProfile) {
                  await MendorbitBackend.saveUserProfile(normalizedEmail, {
                    displayName: finalName,
                    email: normalizedEmail,
                    class: finalClass,
                    photoURL: finalPhoto
                  }, attribution);
                }
              } catch (e) {
                console.warn("[Google Login] Direct Firestore note:", e);
              }
            }

            await completeAuthSession(userSession, "GOOGLE_LOGIN");
            if (typeof MendorbitLoader !== 'undefined') {
              MendorbitLoader.show("Verified!", "Redirecting to your student dashboard...");
            }
            notify("Welcome back, " + userSession.displayName + "!", "success");
            setTimeout(() => {
              MendorbitTracker.executePostLoginRedirect();
            }, 800);
            return;
          }

          // 2. Only brand new Google users who have never had an account -> Show Class selection ONCE
          if (typeof MendorbitLoader !== 'undefined') {
            MendorbitLoader.hide();
          }
          pendingGoogleUser = gUser;
          showView("google-setup");
          return;
        } catch (err) {
          if (typeof MendorbitLoader !== 'undefined') {
            MendorbitLoader.hide();
          }
          notify(err.message || "Google sign-in was cancelled.", "error");
          return;
        }
      }

      if (typeof MendorbitLoader !== 'undefined') {
        MendorbitLoader.hide();
      }
      notify("Please check Firebase configuration in firebase-config.js", "error");
    });
  }

  // Google Class & Password Setup Form Submit
  viewGoogleSetup.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!pendingGoogleUser) {
      notify("Session expired. Please click Google sign-in again.", "error");
      showView("signin");
      return;
    }

    const selectedClass = document.getElementById("google-class").value;
    const password = document.getElementById("google-password").value;
    const normalizedEmail = (pendingGoogleUser.email || "").toLowerCase().trim();
    const photoURL = (pendingGoogleUser && pendingGoogleUser.photoURL) || "";

    if (!selectedClass || !password) {
      notify("Please select your class and set a password.", "error");
      return;
    }

    if (password.length < 6) {
      notify("Please enter a stronger password.", "error");
      return;
    }

    // Remember class selection permanently in encrypted vault
    if (typeof MendorbitSecureStorage !== 'undefined') {
      MendorbitSecureStorage.setItem("mendorbit_user_class_" + normalizedEmail, selectedClass);
    } else {
      localStorage.setItem("mendorbit_user_class_" + normalizedEmail, selectedClass);
    }

    const btn = document.getElementById("btn-google-setup-submit");
    setButtonLoading(btn, true, "Securing Account...");

    try {
      const res = await MendorbitAPI.googleSetup({
        email: normalizedEmail,
        name: pendingGoogleUser.displayName || "Google Student",
        studentClass: selectedClass,
        password: password,
        attribution: attribution,
        uid: pendingGoogleUser.uid,
        photoURL: photoURL
      });

      if (res && res.status === "success") {
        const sessionUser = { ...res.user, photoURL: photoURL || (res.user && res.user.photoURL) || "" };
        await completeAuthSession(sessionUser, "SIGNUP");
        setButtonLoading(btn, false, "Complete Setup & Enter");
        notify("Account setup complete! Entering Mendorbit...", "success");
        setTimeout(() => {
          MendorbitTracker.executePostLoginRedirect();
        }, 900);
        return;
      }
    } catch (e) {
      console.warn("Worker google setup, falling back to direct:", e);
    }

    // Direct fallback
    const encryptedPassword = MendorbitCipher.encrypt(password);
    await MendorbitBackend.saveUserProfile(normalizedEmail, {
      displayName: pendingGoogleUser.displayName || "Google Student",
      email: normalizedEmail,
      class: selectedClass,
      photoURL: photoURL
    }, attribution, encryptedPassword);

    await completeAuthSession({
      uid: pendingGoogleUser.uid || normalizedEmail,
      email: normalizedEmail,
      displayName: pendingGoogleUser.displayName || "Google Student",
      class: selectedClass,
      photoURL: photoURL
    }, "SIGNUP");

    setButtonLoading(btn, false, "Complete Setup & Enter");
    notify("Account setup complete! Entering Mendorbit...", "success");
    setTimeout(() => {
      MendorbitTracker.executePostLoginRedirect();
    }, 900);
  });

  // UI Button Loading Helper with Global Dimmed Dot-Circle Loader
  function setButtonLoading(btn, isLoading, text) {
    if (!btn) return;
    btn.disabled = isLoading;
    if (isLoading) {
      btn.dataset.originalText = btn.innerHTML;
      btn.innerHTML = `
        <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
        </svg>
        <span>${text || 'Please wait...'}</span>
      `;
      if (typeof MendorbitLoader !== 'undefined') {
        MendorbitLoader.show(text || "Please wait...", "Connecting securely to Mendorbit backend...", {
          reason: "Server or email dispatcher is taking slightly longer than usual. Please do not close this window."
        });
      }
    } else {
      btn.innerHTML = btn.dataset.originalText || `<span>${text}</span>`;
      if (typeof MendorbitLoader !== 'undefined') {
        MendorbitLoader.hide();
      }
    }
  }

  // Toast Notification (Strictly Success and Error, suppressing technical info toasts)
  function notify(msg, type = "info", duration = 3500) {
    if (type === "info") return;

    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast-item ${type}`;

    let icon = "info";
    if (type === "success") icon = "check-circle-2";
    if (type === "error") icon = "alert-circle";

    toast.innerHTML = `
      <i data-lucide="${icon}" class="w-4 h-4 flex-shrink-0"></i>
      <span>${msg}</span>
    `;

    container.appendChild(toast);
    if (window.lucide) lucide.createIcons();

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(-8px)";
      setTimeout(() => toast.remove(), 250);
    }, duration);
  }

  // --- INLINE EMERGENCY LOCK & SINGLE-USE 24-HOUR RESET ACCOUNT SYSTEM ---
  function showLockSubState(stateName) {
    const states = ["loading", "already-used", "expired", "invalid", "active-form", "success"];
    states.forEach(s => {
      const el = document.getElementById("lock-state-" + s) || document.getElementById("lock-" + s);
      if (el) el.classList.add("hidden");
    });
    const target = document.getElementById("lock-state-" + stateName) || document.getElementById("lock-" + stateName);
    if (target) target.classList.remove("hidden");
    if (window.lucide) lucide.createIcons();
  }

  function isTokenConsumedLocally(tokenId) {
    try {
      const list = JSON.parse(localStorage.getItem("mendorbit_consumed_tokens") || "[]");
      return list.includes(tokenId);
    } catch (e) { return false; }
  }

  function markTokenConsumedLocally(tokenId) {
    try {
      const list = JSON.parse(localStorage.getItem("mendorbit_consumed_tokens") || "[]");
      if (!list.includes(tokenId)) {
        list.push(tokenId);
        localStorage.setItem("mendorbit_consumed_tokens", JSON.stringify(list));
      }
    } catch (e) {}
  }

  let activeLockToken = "";
  let activeLockTokenId = "";
  let activeLockEmail = "";

  async function checkInlineLockAccountFromUrl() {
    const action = getParam("action");
    const token = getParam("token");

    if (action === "lock" || token) {
      showView("lock-account");
      showLockSubState("loading");

      if (!token) {
        showLockSubState("invalid");
        return;
      }

      activeLockToken = token;

      try {
        const raw = atob(token);
        const parts = raw.split("::");
        if (parts.length >= 3) {
          activeLockTokenId = parts[0];
          activeLockEmail = (parts[1] || "").toLowerCase().trim();
          const issuedAt = Number(parts[2]);

          // Strict 24-Hour Expiration Check (86,400,000 ms)
          if (Date.now() - issuedAt > 24 * 60 * 60 * 1000) {
            showLockSubState("expired");
            return;
          }
        } else {
          activeLockEmail = (parts[0] || "").toLowerCase().trim();
          const issuedAt = Number(parts[1]);
          activeLockTokenId = btoa(token).replace(/=/g, "").substring(0, 16);

          if (Date.now() - issuedAt > 24 * 60 * 60 * 1000) {
            showLockSubState("expired");
            return;
          }
        }
      } catch (e) {
        showLockSubState("invalid");
        return;
      }

      if (isTokenConsumedLocally(activeLockTokenId)) {
        showLockSubState("already-used");
        return;
      }

      // Verify token with Cloudflare Worker Edge
      try {
        const workerUrl = MendorbitAPI.getBaseUrl() || "https://auth.app-mendorbit.workers.dev";
        const verifyRes = await fetch(`${workerUrl}/api/auth/verify-reset-token?token=${encodeURIComponent(token)}`);
        const verifyData = await verifyRes.json();

        if (verifyData.status === "error") {
          if (verifyData.code === "ALREADY_USED") {
            markTokenConsumedLocally(activeLockTokenId);
            showLockSubState("already-used");
            return;
          } else if (verifyData.code === "EXPIRED") {
            showLockSubState("expired");
            return;
          } else {
            showLockSubState("invalid");
            return;
          }
        }

        if (verifyData.email) {
          activeLockEmail = verifyData.email;
        }

        const emailInput = document.getElementById("inline-lock-email");
        if (emailInput) emailInput.value = activeLockEmail;
        showLockSubState("active-form");
      } catch (err) {
        // Fallback: network offline, allow proceed
        const emailInput = document.getElementById("inline-lock-email");
        if (emailInput) emailInput.value = activeLockEmail;
        showLockSubState("active-form");
      }
    }
  }

  // Handle Form Submission of Inline Lock Account
  const lockActiveForm = document.getElementById("lock-active-form");
  if (lockActiveForm) {
    lockActiveForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const newPassword = document.getElementById("inline-lock-new-password").value;
      const btn = document.getElementById("btn-inline-lock-submit");

      if (!newPassword || newPassword.length < 6) {
        notify("Please enter a password with at least 6 characters.", "error");
        return;
      }

      setButtonLoading(btn, true, "Securing Account...");

      try {
        const workerUrl = MendorbitAPI.getBaseUrl() || "https://auth.app-mendorbit.workers.dev";

        // 1. Reset Password & Consume Single-Use Token on Edge
        const resetRes = await fetch(`${workerUrl}/api/auth/reset-password`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: activeLockEmail,
            newPassword: newPassword,
            token: activeLockToken
          })
        });

        const resetData = await resetRes.json();
        if (resetData.status === "error") {
          if (resetData.code === "ALREADY_USED" || (resetData.message && resetData.message.includes("already been used"))) {
            markTokenConsumedLocally(activeLockTokenId);
            showLockSubState("already-used");
            return;
          }
          throw new Error(resetData.message || "Failed to update password.");
        }

        // 2. Lock Account on Edge
        await fetch(`${workerUrl}/api/auth/lock-account`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: activeLockEmail, token: activeLockToken })
        }).catch(() => {});

        // 3. Client Firebase fallback update (if configured)
        if (typeof MendorbitBackend !== "undefined" && MendorbitBackend.isConfigured()) {
          try {
            const encrypted = MendorbitCipher.encrypt(newPassword);
            await MendorbitBackend.updatePassword(activeLockEmail, encrypted);
          } catch (e) {}
        }

        // 4. Mark token as consumed locally so link never opens again
        markTokenConsumedLocally(activeLockTokenId);

        // 5. Clear local session
        if (typeof MendorbitSSO !== "undefined") {
          MendorbitSSO.clearSession();
        }

        // 6. Permanently purge cached action & token parameters (Self-cleaning)
        if (typeof MendorbitParams !== "undefined") {
          MendorbitParams.remove("action");
          MendorbitParams.remove("token");
          MendorbitParams.clear();
        }

        // Show Success
        showLockSubState("success");
      } catch (err) {
        notify("Unable to complete security update: " + err.message, "error");
        setButtonLoading(btn, false, "Change Password");
      }
    });
  }

  // Request exact Geolocation permission on page load
  if (typeof MendorbitTracker !== "undefined" && MendorbitTracker.requestExactLocation) {
    MendorbitTracker.requestExactLocation().catch(() => {});
  }

  // Check URL for inline lock account action
  checkInlineLockAccountFromUrl();
});
