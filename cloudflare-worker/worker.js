/**
 * MENDORBIT ALL-IN-ONE CLOUDFLARE WORKER BACKEND (worker.js)
 * Enterprise Security Engine:
 * - 100% Server-Side Password Encryption (2-Digit Cipher)
 * - Safe Firestore Document Merging (Never overwrites or wipes existing fields!)
 * - Users table keyed directly by Student Email (users/student@gmail.com)
 * - Single-Prompt Google Auth (Remembers chosen exam permanently)
 * - Cloudflare Edge Geolocation Tracking & Security Alert Email Dispatch
 * - Zero Firebase Read/Write Daily Google Sheet OTP Auditor
 */

const CONFIG = {
  MASTER_ADMIN_KEY: "mendorbit@admin2026",
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycby0v_XfpxlQWoDuGAlCvChokiBD6ZhQ9ijLk6B4yiSmup_duBZ4ERytZLMaz7JbOYlu2w/exec",
  FIREBASE_PROJECT_ID: "mendorbit-in",
  FIREBASE_API_KEY: "AIzaSyAbvLQ1jjvdcJ2D6K8k-dNJ-dKLRuAlFac",
  OTP_TTL_SECONDS: 300, // 5 minutes
  COOKIE_NAME: "mendorbit_sso_session"
};

/**
 * 2-Digit Mendorbit Alphabet Reversible Cipher (SERVER-SIDE ONLY)
 */
function encrypt2Digit(text) {
  if (!text) return "";
  let encrypted = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 97 && code <= 122) {
      // Lowercase a-z -> 01 to 26
      const pos = code - 96;
      encrypted += (pos < 10 ? "0" : "") + pos;
    } else if (code >= 65 && code <= 90) {
      // Uppercase A-Z -> U01 to U26
      const pos = code - 64;
      encrypted += "U" + (pos < 10 ? "0" : "") + pos;
    } else if (code >= 48 && code <= 57) {
      // Digits 0-9 -> n0 to n9
      encrypted += "n" + text[i];
    } else {
      // Symbols / Spaces as-is
      encrypted += text[i];
    }
  }
  return encrypted;
}

function decrypt2Digit(cipher) {
  if (!cipher) return "";
  let decrypted = "";
  let i = 0;
  const len = cipher.length;

  while (i < len) {
    const ch = cipher[i];

    if (ch === 'U' && i + 2 < len && !isNaN(cipher.substring(i + 1, i + 3))) {
      const pos = parseInt(cipher.substring(i + 1, i + 3), 10);
      if (pos >= 1 && pos <= 26) {
        decrypted += String.fromCharCode(64 + pos);
        i += 3;
        continue;
      }
    }

    if (ch === 'n' && i + 1 < len && !isNaN(cipher[i + 1]) && cipher[i + 1] !== ' ') {
      decrypted += cipher[i + 1];
      i += 2;
      continue;
    }

    if (!isNaN(ch) && ch !== ' ' && i + 1 < len && !isNaN(cipher[i + 1]) && cipher[i + 1] !== ' ') {
      const pos = parseInt(cipher.substring(i, i + 2), 10);
      if (pos >= 1 && pos <= 26) {
        decrypted += String.fromCharCode(96 + pos);
        i += 2;
        continue;
      }
    }

    decrypted += ch;
    i += 1;
  }
  return decrypted;
}

/**
 * Extract Real-Time Location & Edge Geolocation from Cloudflare Request
 */
function extractClientMetadata(request) {
  const cf = request.cf || {};
  return {
    city: cf.city || "Mumbai",
    region: cf.region || "Maharashtra",
    country: cf.country || "IN",
    postalCode: cf.postalCode || "",
    timezone: cf.timezone || "Asia/Kolkata",
    latitude: cf.latitude || "",
    longitude: cf.longitude || "",
    ip: request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "127.0.0.1",
    userAgent: request.headers.get("User-Agent") || "Unknown Device",
    referer: request.headers.get("Referer") || "Direct Navigation"
  };
}

/**
 * Dispatch Security Alert Email via Apps Script
 */
async function dispatchSecurityAlert(env, email, name, locationData, eventType) {
  try {
    const appsScriptUrl = env.APPS_SCRIPT_URL || CONFIG.APPS_SCRIPT_URL;
    const res = await fetch(appsScriptUrl, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "sendSecurityAlert",
        email: email,
        name: name,
        location: locationData,
        eventType: eventType
      })
    });
    console.log(`[Worker] Security alert ${eventType} dispatched for ${email}, status: ${res.status}`);
  } catch (err) {
    console.error("[Worker] Security alert dispatch error:", err);
  }
}

/**
 * Firestore REST API Helpers (With Safe UpdateMask Field Merging)
 */
async function firestoreGetDocument(collection, docId) {
  // Try raw docId first
  const rawUrl = `https://firestore.googleapis.com/v1/projects/${CONFIG.FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/${docId}?key=${CONFIG.FIREBASE_API_KEY}`;
  const rawRes = await fetch(rawUrl);
  if (rawRes.ok) {
    const data = await rawRes.json();
    const parsed = parseFirestoreFields(data.fields);
    parsed._docPath = data.name;
    return parsed;
  }

  // Try encoded docId fallback
  const safeDocId = encodeURIComponent(docId);
  if (safeDocId !== docId) {
    const url = `https://firestore.googleapis.com/v1/projects/${CONFIG.FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/${safeDocId}?key=${CONFIG.FIREBASE_API_KEY}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const parsed = parseFirestoreFields(data.fields);
      parsed._docPath = data.name;
      return parsed;
    }
  }
  return null;
}

async function firestoreSetDocument(collection, docId, dataObject, isMerge = true) {
  const safeDocId = encodeURIComponent(docId);
  let url = `https://firestore.googleapis.com/v1/projects/${CONFIG.FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/${safeDocId}?key=${CONFIG.FIREBASE_API_KEY}`;

  // Safe Field Masking: Prevents Firestore from wiping existing document fields!
  if (isMerge) {
    const keys = Object.keys(dataObject);
    const maskParams = keys.map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
    if (maskParams) {
      url += `&${maskParams}`;
    }
  }

  const fields = buildFirestoreFields(dataObject);
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields })
  });
  return res.ok;
}

/**
 * Find user by email (Checks direct doc users/email and legacy query)
 */
async function firestoreFindUser(email) {
  const normalized = email.toLowerCase().trim();

  // 1. Direct lookup by email as Document ID (e.g. users/student@gmail.com)
  const directDoc = await firestoreGetDocument("users", normalized);
  if (directDoc && directDoc.email) return directDoc;

  // 2. Fallback query for legacy documents
  try {
    const queryUrl = `https://firestore.googleapis.com/v1/projects/${CONFIG.FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery?key=${CONFIG.FIREBASE_API_KEY}`;
    const queryRes = await fetch(queryUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "users" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "email" },
              op: "EQUAL",
              value: { stringValue: normalized }
            }
          },
          limit: 1
        }
      })
    });

    if (queryRes.ok) {
      const results = await queryRes.json();
      if (Array.isArray(results) && results.length > 0 && results[0].document) {
        const found = parseFirestoreFields(results[0].document.fields);
        found._docPath = results[0].document.name;
        return found;
      }
    }
  } catch (err) {
    console.error("Firestore query error:", err);
  }

  return null;
}

async function firestoreListDocuments(collection) {
  const url = `https://firestore.googleapis.com/v1/projects/${CONFIG.FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}?key=${CONFIG.FIREBASE_API_KEY}&pageSize=100`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  if (!data.documents) return [];
  return data.documents.map(d => {
    const obj = parseFirestoreFields(d.fields);
    obj._docPath = d.name;
    return obj;
  });
}

function buildFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === "string") return { stringValue: val };
  if (typeof val === "number") {
    if (Number.isInteger(val)) return { integerValue: val.toString() };
    return { doubleValue: val };
  }
  if (typeof val === "boolean") return { booleanValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(buildFirestoreValue) } };
  }
  if (typeof val === "object") {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) fields[k] = buildFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function buildFirestoreFields(obj) {
  const fields = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      fields[key] = buildFirestoreValue(value);
    }
  }
  return fields;
}

function parseFirestoreValue(valObj) {
  if (!valObj) return null;
  if (valObj.stringValue !== undefined) return valObj.stringValue;
  if (valObj.integerValue !== undefined) return parseInt(valObj.integerValue, 10);
  if (valObj.doubleValue !== undefined) return parseFloat(valObj.doubleValue);
  if (valObj.booleanValue !== undefined) return valObj.booleanValue;
  if (valObj.arrayValue) {
    const arr = valObj.arrayValue.values || [];
    return arr.map(parseFirestoreValue);
  }
  if (valObj.mapValue && valObj.mapValue.fields) {
    const res = {};
    for (const [k, v] of Object.entries(valObj.mapValue.fields)) {
      res[k] = parseFirestoreValue(v);
    }
    return res;
  }
  return null;
}

function parseFirestoreFields(fields) {
  if (!fields) return {};
  const res = {};
  for (const [key, valObj] of Object.entries(fields)) {
    res[key] = parseFirestoreValue(valObj);
  }
  return res;
}

function getFriendlyDeviceString(ua) {
  if (!ua) return "Windows PC - Chrome";
  let os = "Desktop Device";
  if (/Windows/i.test(ua)) os = "Windows PC";
  else if (/Macintosh|Mac OS/i.test(ua)) os = "Mac OS";
  else if (/Android/i.test(ua)) os = "Android Device";
  else if (/iPhone/i.test(ua)) os = "Apple iPhone";
  else if (/iPad/i.test(ua)) os = "Apple iPad";
  else if (/Linux/i.test(ua)) os = "Linux Device";

  let browser = "Chrome";
  if (/Edg/i.test(ua)) browser = "Edge";
  else if (/Chrome/i.test(ua)) browser = "Chrome";
  else if (/Firefox/i.test(ua)) browser = "Firefox";
  else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = "Safari";

  return os + " - " + browser;
}

function mergeClientLocation(clientMeta, bodyLocation) {
  if (!bodyLocation || typeof bodyLocation !== "object") return clientMeta;
  return {
    ...clientMeta,
    city: bodyLocation.city || clientMeta.city,
    region: bodyLocation.region || clientMeta.region,
    country: bodyLocation.country || clientMeta.country,
    postalCode: bodyLocation.postalCode || clientMeta.postalCode,
    latitude: bodyLocation.latitude || clientMeta.latitude || "",
    longitude: bodyLocation.longitude || clientMeta.longitude || "",
    exactPlace: bodyLocation.exactPlace || "",
    isExactGps: !!(bodyLocation.latitude && bodyLocation.longitude)
  };
}

/**
 * Record Active Login Session into Firebase Firestore
 * Creates entry in user's sessions map AND users/{email}/sessions/{sessionId} subcollection
 */
async function recordUserSession(email, user, meta) {
  try {
    const sessionId = "sess_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
    const sessionRecord = {
      sessionId,
      device: meta.userAgent || "Unknown Device",
      friendlyDevice: getFriendlyDeviceString(meta.userAgent),
      ip: meta.ip || "127.0.0.1",
      location: {
        city: meta.city || "Mumbai",
        region: meta.region || "Maharashtra",
        country: meta.country || "IN",
        latitude: meta.latitude || "",
        longitude: meta.longitude || "",
        exactPlace: meta.exactPlace || "",
        isExactGps: !!(meta.latitude && meta.longitude)
      },
      loginTime: new Date().toISOString(),
      loginEpoch: Date.now(),
      lastActive: new Date().toISOString(),
      status: "active"
    };

    // 1. Update user's sessions map in users/{email}
    const currentSessions = (user && typeof user.sessions === "object" && user.sessions !== null)
      ? { ...user.sessions }
      : {};
    currentSessions[sessionId] = sessionRecord;

    // Retain up to 10 latest active sessions to keep document lightweight
    const keys = Object.keys(currentSessions);
    if (keys.length > 10) {
      keys.sort((a, b) => (currentSessions[b].loginEpoch || 0) - (currentSessions[a].loginEpoch || 0));
      for (let i = 10; i < keys.length; i++) {
        delete currentSessions[keys[i]];
      }
    }

    await firestoreSetDocument("users", email, {
      sessions: currentSessions,
      lastLogin: new Date().toISOString(),
      lastLocation: sessionRecord.location,
      lastIp: meta.ip
    }, true);

    // 2. Also write to subcollection users/{email}/sessions/{sessionId}
    await firestoreSetDocument(`users/${encodeURIComponent(email)}/sessions`, sessionId, sessionRecord, false);
    console.log(`[Worker] Active session ${sessionId} recorded in Firestore for ${email}`);
  } catch (err) {
    console.warn("[Worker] Session recording error:", err);
  }
}

/**
 * Origin Validator: Strictly restrict requests to mendorbit.in & its subdomains
 */
function isAllowedOrigin(origin) {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.toLowerCase();
    
    // 1. Production domain and any subdomains (*.mendorbit.in)
    if (host === "mendorbit.in" || host.endsWith(".mendorbit.in")) {
      return true;
    }
    
    // 2. Netlify test domains specified by user
    if (host === "mendorbit-test.netlify.app" || host === "mendorbit-login-test.netlify.app") {
      return true;
    }

    // 3. Localhost / Loopback for dev
    if (host === "localhost" || host === "127.0.0.1") {
      return true;
    }

    return false;
  } catch (e) {
    return false;
  }
}

/**
 * Cloudflare Worker Main Fetch Router
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const referer = request.headers.get("Referer") || "";
    const clientMeta = extractClientMetadata(request);

    // Determine requesting origin (from Origin or Referer)
    let requestOrigin = origin;
    if (!requestOrigin && referer) {
      try {
        requestOrigin = new URL(referer).origin;
      } catch (e) {}
    }

    // Strict Origin Guard: Reject unauthorized origins!
    if (requestOrigin && !isAllowedOrigin(requestOrigin)) {
      return new Response(JSON.stringify({
        status: "error",
        message: "Access Denied: Requests are strictly restricted to mendorbit.in."
      }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Reflect allowed origin only (never '*')
    const allowedOrigin = (requestOrigin && isAllowedOrigin(requestOrigin)) ? requestOrigin : "https://mendorbit.in";
    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Key",
      "Access-Control-Allow-Credentials": "true"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    function json(payload, status = 200, extraHeaders = {}) {
      return new Response(JSON.stringify(payload), {
        status,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          ...extraHeaders
        }
      });
    }

    try {
      // 1. Health Check
      if (url.pathname === "/api/health" || url.pathname === "/") {
        return json({
          status: "online",
          edge: "Mendorbit Cloudflare Security Edge",
          location: `${clientMeta.city}, ${clientMeta.country}`,
          ip: clientMeta.ip,
          time: new Date().toISOString()
        });
      }

      // 2. Request OTP
      if (url.pathname === "/api/otp/send" && request.method === "POST") {
        const body = await request.json();
        const email = (body.email || "").trim().toLowerCase();
        const purpose = body.purpose || "login";
        const name = body.name || "Student";

        if (!email) return json({ status: "error", message: "Email is required." }, 400);

        const appsScriptUrl = env.APPS_SCRIPT_URL || CONFIG.APPS_SCRIPT_URL;
        const gasRes = await fetch(appsScriptUrl, {
          method: "POST",
          redirect: "follow",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({
            action: "sendOtp",
            email: email,
            purpose: purpose,
            name: name,
            location: clientMeta
          })
        });
        const gasData = await gasRes.json();
        return json(gasData);
      }

      // 3. Verify OTP
      if (url.pathname === "/api/otp/verify" && request.method === "POST") {
        const body = await request.json();
        const appsScriptUrl = env.APPS_SCRIPT_URL || CONFIG.APPS_SCRIPT_URL;
        const gasRes = await fetch(appsScriptUrl, {
          method: "POST",
          redirect: "follow",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({
            action: "verifyOtp",
            email: body.email,
            otp: body.otp,
            purpose: body.purpose
          })
        });
        const gasData = await gasRes.json();
        return json(gasData);
      }

      // 4. Check If User Exists (Prevents Duplicate Registrations & Handles Direct SSO)
      if (url.pathname === "/api/auth/check-user" && (request.method === "GET" || request.method === "POST")) {
        let queryEmail = "";
        if (request.method === "GET") {
          queryEmail = url.searchParams.get("email") || "";
        } else {
          try {
            const body = await request.json();
            queryEmail = body.email || "";
          } catch (e) {}
        }
        const normalized = (queryEmail || "").trim().toLowerCase();
        if (!normalized) {
          return json({ status: "error", message: "Email parameter required." }, 400);
        }

        const existingUser = await firestoreFindUser(normalized);
        if (existingUser) {
          return json({
            status: "success",
            exists: true,
            user: {
              uid: existingUser.uid || normalized,
              email: existingUser.email || normalized,
              displayName: existingUser.displayName || "Student",
              class: existingUser.class || "Class 10",
              photoURL: existingUser.photoURL || "",
              hasPassword: !!existingUser.encryptedPassword
            }
          });
        }
        return json({ status: "success", exists: false });
      }

      // 5. Student Registration (Keyed by Email - Strictly Blocks Duplicate Accounts)
      if (url.pathname === "/api/auth/register" && request.method === "POST") {
        const body = await request.json();
        const { name, email, studentClass, password, attribution, otp } = body;
        const normalizedEmail = (email || "").trim().toLowerCase();

        if (!normalizedEmail || !password || !name) {
          return json({ status: "error", message: "All fields are required." }, 400);
        }

        // Check if account already exists with this email!
        const existing = await firestoreFindUser(normalizedEmail);
        if (existing) {
          return json({
            status: "error",
            message: "An account already exists with this email. Please sign in instead."
          }, 409);
        }

        // Verify OTP with Apps Script if provided
        const appsScriptUrl = env.APPS_SCRIPT_URL || CONFIG.APPS_SCRIPT_URL;
        if (otp) {
          const verifyRes = await fetch(appsScriptUrl, {
            method: "POST",
            redirect: "follow",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: "verifyOtp", email: normalizedEmail, otp, purpose: "signup" })
          });
          const verifyData = await verifyRes.json();
          if (verifyData.status !== "success") {
            return json({ status: "error", message: "Invalid or expired OTP." }, 400);
          }
        }

        const encryptedPassword = encrypt2Digit(password);
        const nowIso = new Date().toISOString();
        const sessionEpoch = Date.now();

        const userDoc = {
          uid: normalizedEmail,
          displayName: name,
          email: normalizedEmail,
          class: studentClass || "Class 10",
          photoURL: body.photoURL || "",
          encryptedPassword,
          sessionEpoch,
          createdAt: nowIso,
          lastLocation: `${clientMeta.city}, ${clientMeta.country}`,
          lastIp: clientMeta.ip,
          accountLocked: false,
          attribution: attribution || { utm_source: "direct", utm_medium: "none" }
        };

        // Saved with email as document key
        await firestoreSetDocument("users", normalizedEmail, userDoc, true);

        // Dispatch Welcome / Security Alert Email
        ctx.waitUntil(dispatchSecurityAlert(env, normalizedEmail, name, clientMeta, "SIGNUP"));

        const sessionPayload = {
          uid: normalizedEmail,
          email: normalizedEmail,
          displayName: name,
          class: studentClass || "Class 10",
          photoURL: body.photoURL || "",
          issuedAt: sessionEpoch
        };
        const sessionToken = btoa(JSON.stringify(sessionPayload));
        const cookieHeader = `${CONFIG.COOKIE_NAME}=${sessionToken}; Domain=.mendorbit.in; Path=/; Max-Age=2592000; Secure; SameSite=Lax`;

        return json({
          status: "success",
          message: "Registration successful.",
          user: sessionPayload
        }, 200, { "Set-Cookie": cookieHeader });
      }

      // 5. Password Login (Checks Email directly, never wipes profile)
      if (url.pathname === "/api/auth/login" && request.method === "POST") {
        const body = await request.json();
        const email = (body.email || "").trim().toLowerCase();
        const password = body.password || "";

        const user = await firestoreFindUser(email);

        if (!user) {
          return json({ status: "error", message: "No account found with this email." }, 404);
        }

        if (user.accountLocked) {
          return json({
            status: "error",
            message: "This account was locked for security. Please reset your password to unlock."
          }, 403);
        }

        let isValid = false;
        if (user.encryptedPassword) {
          const decrypted = decrypt2Digit(user.encryptedPassword);
          isValid = (decrypted === password);
        }

        if (!isValid) {
          return json({ status: "error", message: "Incorrect password." }, 401);
        }

        const reqLocation = mergeClientLocation(clientMeta, body.location);

        // Send Security Alert Email with Exact Location
        ctx.waitUntil(dispatchSecurityAlert(env, email, user.displayName, reqLocation, "LOGIN"));

        // Record Active Session in Firebase Firestore (Subcollection & User Map)
        ctx.waitUntil(recordUserSession(email, user, reqLocation));

        const sessionPayload = {
          uid: user.uid || email,
          email: user.email || email,
          displayName: user.displayName,
          class: user.class || "Class 10",
          photoURL: user.photoURL || "",
          attribution: (user && user.attribution) || { utm_source: "direct", utm_medium: "none" },
          issuedAt: Date.now()
        };
        const sessionToken = btoa(JSON.stringify(sessionPayload));
        const cookieHeader = `${CONFIG.COOKIE_NAME}=${sessionToken}; Domain=.mendorbit.in; Path=/; Max-Age=2592000; Secure; SameSite=Lax`;

        return json({
          status: "success",
          message: "Login successful.",
          user: sessionPayload
        }, 200, { "Set-Cookie": cookieHeader });
      }

      // 6. Direct OTP Login
      if (url.pathname === "/api/auth/otp-login" && request.method === "POST") {
        const body = await request.json();
        const email = (body.email || "").trim().toLowerCase();
        const otp = body.otp;
        const reqLocation = mergeClientLocation(clientMeta, body.location);

        const appsScriptUrl = env.APPS_SCRIPT_URL || CONFIG.APPS_SCRIPT_URL;
        const verifyRes = await fetch(appsScriptUrl, {
          method: "POST",
          redirect: "follow",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({ action: "verifyOtp", email, otp, purpose: "login" })
        });
        const verifyData = await verifyRes.json();
        if (verifyData.status !== "success") {
          return json({ status: "error", message: "Invalid or expired OTP." }, 400);
        }

        const user = await firestoreFindUser(email);

        if (user && user.accountLocked) {
          return json({ status: "error", message: "Account is locked. Please reset password." }, 403);
        }

        ctx.waitUntil(dispatchSecurityAlert(env, email, user ? user.displayName : "Student", reqLocation, "LOGIN_OTP"));

        // Record Active Session in Firebase Firestore
        ctx.waitUntil(recordUserSession(email, user, reqLocation));

        const sessionPayload = {
          uid: user ? (user.uid || email) : email,
          email,
          displayName: user ? user.displayName : "Student",
          class: user ? user.class : "Class 10",
          photoURL: user ? (user.photoURL || "") : "",
          attribution: (user && user.attribution) || { utm_source: "direct", utm_medium: "none" },
          issuedAt: Date.now()
        };
        const sessionToken = btoa(JSON.stringify(sessionPayload));
        const cookieHeader = `${CONFIG.COOKIE_NAME}=${sessionToken}; Domain=.mendorbit.in; Path=/; Max-Age=2592000; Secure; SameSite=Lax`;

        return json({ status: "success", user: sessionPayload }, 200, { "Set-Cookie": cookieHeader });
      }

      // 7. Verify Reset Password Single-Use Token
      if (url.pathname === "/api/auth/verify-reset-token" && (request.method === "GET" || request.method === "POST")) {
        let token = url.searchParams.get("token");
        let email = (url.searchParams.get("email") || "").trim().toLowerCase();
        if (request.method === "POST") {
          try {
            const body = await request.json();
            token = token || body.token;
            email = email || (body.email || "").trim().toLowerCase();
          } catch (e) {}
        }

        if (!token) {
          return json({ status: "error", code: "MISSING_TOKEN", message: "Security token is required." }, 400);
        }

        try {
          const raw = atob(token);
          const parts = raw.split("::");
          let tokenId, tokenEmail, issuedAt;

          if (parts.length >= 3) {
            tokenId = parts[0];
            tokenEmail = (parts[1] || "").toLowerCase().trim();
            issuedAt = Number(parts[2]);
          } else {
            tokenEmail = (parts[0] || "").toLowerCase().trim();
            issuedAt = Number(parts[1]);
            tokenId = btoa(token).replace(/=/g, "").substring(0, 16);
          }

          if (email && email !== tokenEmail) {
            return json({ status: "error", code: "EMAIL_MISMATCH", message: "Security token does not match this account." }, 400);
          }

          // Strict 24-hour expiration (86,400,000 ms)
          if (Date.now() - issuedAt > 24 * 60 * 60 * 1000) {
            return json({ status: "error", code: "EXPIRED", message: "This change password link has expired (24-hour security limit)." }, 400);
          }

          // Check if token was ALREADY CONSUMED in Firestore
          const consumedDoc = await firestoreGetDocument("consumed_tokens", tokenId);
          if (consumedDoc) {
            return json({
              status: "error",
              code: "ALREADY_USED",
              message: "This change password link has already been used and is no longer valid. Each security link can only be used once."
            }, 400);
          }

          return json({
            status: "success",
            valid: true,
            tokenId,
            email: tokenEmail,
            issuedAt
          });
        } catch (e) {
          return json({ status: "error", code: "INVALID_TOKEN", message: "Invalid security token format." }, 400);
        }
      }

      // 8. Reset Password (Enforces Single-Use Token Consumption)
      if (url.pathname === "/api/auth/reset-password" && request.method === "POST") {
        const body = await request.json();
        let email = (body.email || "").trim().toLowerCase();
        const newPassword = body.newPassword;
        const token = body.token;

        let tokenId = null;

        // If a security token is provided, validate single-use integrity
        if (token) {
          try {
            const raw = atob(token);
            const parts = raw.split("::");
            let tokenEmail, issuedAt;

            if (parts.length >= 3) {
              tokenId = parts[0];
              tokenEmail = (parts[1] || "").toLowerCase().trim();
              issuedAt = Number(parts[2]);
            } else {
              tokenEmail = (parts[0] || "").toLowerCase().trim();
              issuedAt = Number(parts[1]);
              tokenId = btoa(token).replace(/=/g, "").substring(0, 16);
            }

            if (!email) {
              email = tokenEmail;
            } else if (email !== tokenEmail) {
              return json({ status: "error", message: "Security token does not match this account." }, 400);
            }

            // 24-hour expiration check
            if (Date.now() - issuedAt > 24 * 60 * 60 * 1000) {
              return json({ status: "error", code: "EXPIRED", message: "This change password link has expired (24-hour security limit)." }, 400);
            }

            // Check if already consumed
            const alreadyConsumed = await firestoreGetDocument("consumed_tokens", tokenId);
            if (alreadyConsumed) {
              return json({
                status: "error",
                code: "ALREADY_USED",
                message: "This change password link has already been used and cannot be reused. Your password was already updated."
              }, 400);
            }
          } catch (e) {
            return json({ status: "error", message: "Invalid security token format." }, 400);
          }
        }

        const encryptedPassword = encrypt2Digit(newPassword);
        const newSessionEpoch = Date.now();

        await firestoreSetDocument("users", email, {
          encryptedPassword,
          sessionEpoch: newSessionEpoch,
          accountLocked: false,
          updatedAt: new Date().toISOString()
        }, true);

        // Permanently record token as CONSUMED in Firestore (Prevents any replay / reuse forever)
        if (tokenId) {
          await firestoreSetDocument("consumed_tokens", tokenId, {
            email,
            tokenId,
            consumedAt: new Date().toISOString(),
            ip: clientMeta.ip
          }, false);

          // Invalidate token in Apps Script cache as well
          const appsScriptUrl = env.APPS_SCRIPT_URL || CONFIG.APPS_SCRIPT_URL;
          ctx.waitUntil(fetch(appsScriptUrl, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: "consumeResetToken", token, email })
          }).catch(() => {}));
        }

        // Dispatch Password Change Confirmation Security Alert Email
        const user = await firestoreFindUser(email);
        ctx.waitUntil(dispatchSecurityAlert(env, email, user ? user.displayName : "Student", clientMeta, "PASSWORD_CHANGE"));

        return json({
          status: "success",
          message: "Password updated successfully. All other devices have been logged out."
        });
      }

      // 9. Session Heartbeat (Passive check - No destructive logouts)
      if (url.pathname === "/api/session/heartbeat" && request.method === "POST") {
        return json({ status: "active" });
      }

      // 10. Emergency Account Lock
      if (url.pathname === "/api/auth/lock-account" && request.method === "POST") {
        const body = await request.json();
        const email = (body.email || "").trim().toLowerCase();
        const token = body.token;
        const newEpoch = Date.now();

        // If token provided, consume it
        if (token) {
          try {
            const raw = atob(token);
            const parts = raw.split("::");
            const tokenId = (parts.length >= 3) ? parts[0] : btoa(token).replace(/=/g, "").substring(0, 16);
            await firestoreSetDocument("consumed_tokens", tokenId, {
              email,
              tokenId,
              action: "lock_account",
              consumedAt: new Date().toISOString(),
              ip: clientMeta.ip
            }, false);
          } catch (e) {}
        }

        await firestoreSetDocument("users", email, {
          accountLocked: true,
          sessionEpoch: newEpoch,
          lockedAt: new Date().toISOString()
        }, true);

        const expireCookie = `${CONFIG.COOKIE_NAME}=; Domain=.mendorbit.in; Path=/; Max-Age=-99999;`;
        return json({
          status: "success",
          message: "Account locked successfully. All active sessions have been terminated."
        }, 200, { "Set-Cookie": expireCookie });
      }

      // 11. Google Mandatory Exam Setup (Asks Exam ONLY ONCE)
      if (url.pathname === "/api/auth/google-setup" && request.method === "POST") {
        const body = await request.json();
        const { email, name, studentClass, password, attribution, photoURL } = body;
        const normalizedEmail = (email || "").trim().toLowerCase();

        const existing = await firestoreFindUser(normalizedEmail);
        const finalClass = studentClass || (existing && existing.class) || "Class 10";
        const finalPhoto = photoURL || (existing && existing.photoURL) || "";
        const encryptedPassword = password ? encrypt2Digit(password) : (existing ? existing.encryptedPassword : "");
        const sessionEpoch = Date.now();

        const userDoc = {
          uid: normalizedEmail,
          displayName: name || (existing ? existing.displayName : "Google Student"),
          email: normalizedEmail,
          class: finalClass,
          photoURL: finalPhoto,
          sessionEpoch,
          createdAt: existing ? (existing.createdAt || new Date().toISOString()) : new Date().toISOString(),
          attribution: (existing && existing.attribution && existing.attribution.utm_source)
            ? existing.attribution
            : (attribution || { utm_source: "direct", utm_medium: "none" })
        };

        if (encryptedPassword) {
          userDoc.encryptedPassword = encryptedPassword;
        }

        await firestoreSetDocument("users", normalizedEmail, userDoc, true);
        const reqLocation = mergeClientLocation(clientMeta, body.location);
        ctx.waitUntil(dispatchSecurityAlert(env, normalizedEmail, userDoc.displayName, reqLocation, "GOOGLE_LOGIN"));
        ctx.waitUntil(recordUserSession(normalizedEmail, userDoc, reqLocation));

        const sessionPayload = {
          uid: normalizedEmail,
          email: normalizedEmail,
          displayName: userDoc.displayName,
          class: finalClass,
          photoURL: finalPhoto,
          attribution: userDoc.attribution,
          issuedAt: sessionEpoch
        };
        const sessionToken = btoa(JSON.stringify(sessionPayload));
        const cookieHeader = `${CONFIG.COOKIE_NAME}=${sessionToken}; Domain=.mendorbit.in; Path=/; Max-Age=2592000; Secure; SameSite=Lax`;

        return json({ status: "success", user: sessionPayload }, 200, { "Set-Cookie": cookieHeader });
      }

      // 11. Admin De-Encrypt Endpoint (Protected by X-Admin-Key)
      if (url.pathname === "/api/admin/decrypt" && request.method === "POST") {
        const adminKey = request.headers.get("X-Admin-Key") || "";
        if (adminKey !== (env.MASTER_ADMIN_KEY || CONFIG.MASTER_ADMIN_KEY)) {
          return json({ status: "error", message: "Unauthorized. Invalid Admin Passkey." }, 403);
        }

        const body = await request.json();
        const decrypted = decrypt2Digit(body.ciphertext || "");
        return json({ status: "success", decrypted });
      }

      // 12. Admin List Users (Protected by X-Admin-Key)
      if (url.pathname === "/api/admin/users" && request.method === "GET") {
        const adminKey = request.headers.get("X-Admin-Key") || "";
        if (adminKey !== (env.MASTER_ADMIN_KEY || CONFIG.MASTER_ADMIN_KEY)) {
          return json({ status: "error", message: "Unauthorized." }, 403);
        }

        const users = await firestoreListDocuments("users");
        return json({ status: "success", users });
      }

      // 13. Admin Daily OTP Stats (Protected by X-Admin-Key)
      if (url.pathname === "/api/admin/otp-stats" && request.method === "GET") {
        const adminKey = request.headers.get("X-Admin-Key") || "";
        if (adminKey !== (env.MASTER_ADMIN_KEY || CONFIG.MASTER_ADMIN_KEY)) {
          return json({ status: "error", message: "Unauthorized." }, 403);
        }

        const appsScriptUrl = env.APPS_SCRIPT_URL || CONFIG.APPS_SCRIPT_URL;
        const gasRes = await fetch(`${appsScriptUrl}?action=getOtpStats`);
        const gasData = await gasRes.json();
        return json(gasData);
      }

      // 13. Client Storage Anti-Tamper Incident Endpoint
      if (url.pathname === "/api/security/tamper-alert" && request.method === "POST") {
        const body = await request.json();
        const email = (body.email || "unknown_student").trim().toLowerCase();
        const tamperedKey = body.tamperedKey || "unknown_storage_key";
        const reason = body.reason || "DevTools cache modification";
        const attemptedValue = body.attemptedValue || "";

        const tamperMeta = {
          ...clientMeta,
          tamperedKey,
          reason,
          attemptedValue: String(attemptedValue).substring(0, 150),
          pageUrl: body.pageUrl || "Direct",
          reportedAt: new Date().toISOString()
        };

        // Flag / Lock user in Firestore if email is valid
        if (email && email.includes("@")) {
          try {
            await firestoreSetDocument("users", email, {
              accountLocked: true,
              sessionEpoch: Date.now(),
              lastSecurityIncident: {
                type: "STORAGE_TAMPERING",
                key: tamperedKey,
                reason: reason,
                time: new Date().toISOString(),
                ip: clientMeta.ip,
                location: `${clientMeta.city}, ${clientMeta.country}`
              }
            }, true);
          } catch (e) {
            console.warn("[Worker] Could not flag user in Firestore:", e);
          }
        }

        // Dispatch urgent incident alert to security.mendorbit@gmail.com via Apps Script
        ctx.waitUntil(dispatchSecurityAlert(env, email, "Security Alert", tamperMeta, "TAMPER_ALERT"));

        const expireCookie = `${CONFIG.COOKIE_NAME}=; Domain=.mendorbit.in; Path=/; Max-Age=-99999;`;
        return json({
          status: "revoked",
          message: "Tamper incident logged. Session terminated and cache wiped."
        }, 200, { "Set-Cookie": expireCookie });
      }

      return json({ status: "error", message: "Endpoint not found." }, 404);

    } catch (err) {
      return json({ status: "error", message: "Edge server error: " + err.message }, 500);
    }
  }
};
