/**
 * MENDORBIT PRODUCTION BACKEND CONFIGURATION
 * Connected to live Firebase project (app-mendorbit) and live Google Apps Script OTP Web App.
 */

// 1. Google Apps Script Deployed Web App URL
const MENDORBIT_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwWiLcXeggeJ34fx-Nc0Ded1MJ-O0a-7_ohHKtTI96BBm2KbZ4G8r3sttpu0qx43Sgwfw/exec";

// 2. Firebase Production Credentials (app-mendorbit)
const MENDORBIT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyD1Bq8tZ_EHHpm2X953lLpd7B8Za7Dg6FY",
  authDomain: "app-mendorbit.firebaseapp.com",
  projectId: "app-mendorbit",
  storageBucket: "app-mendorbit.firebasestorage.app",
  messagingSenderId: "631509609750",
  appId: "1:631509609750:web:6deec2049572550b2ab437",
  measurementId: "G-WH09F8MWSH"
};

// 3. Live Cloudflare Worker Endpoint
const MENDORBIT_WORKER_URL = "https://auth.app-mendorbit.workers.dev";

// Service Initialization
let firebaseAuth = null;
let firestoreDb = null;
let googleAuthProvider = null;
let isFirebaseConfigured = false;

try {
  if (typeof firebase !== 'undefined' && MENDORBIT_FIREBASE_CONFIG.apiKey) {
    if (!firebase.apps.length) {
      firebase.initializeApp(MENDORBIT_FIREBASE_CONFIG);
    }
    firebaseAuth = firebase.auth();
    firestoreDb = firebase.firestore();
    googleAuthProvider = new firebase.auth.GoogleAuthProvider();
    googleAuthProvider.setCustomParameters({ prompt: 'select_account' });
    isFirebaseConfigured = true;
    console.log("[Mendorbit Backend] Connected to live Firebase: app-mendorbit");
  }
} catch (e) {
  console.warn("[Mendorbit Backend] Firebase initialization note:", e.message);
}

/**
 * Backend Data Service
 */
const MendorbitBackend = {
  isConfigured: () => isFirebaseConfigured,
  getAppsScriptUrl: () => MENDORBIT_APPS_SCRIPT_URL,
  getWorkerUrl: () => MENDORBIT_WORKER_URL,

  /**
   * Save student profile to Firebase Firestore & local cache (Keyed by Email)
   */
  async saveUserProfile(uid, profileData, attributionData, encryptedPassword) {
    const docId = profileData.email.toLowerCase().trim();
    const userDoc = {
      uid: docId,
      displayName: profileData.displayName || "Student",
      email: docId,
      class: profileData.class || "Class 10",
      photoURL: profileData.photoURL || "",
      status: "active",
      createdAt: (typeof firebase !== 'undefined' && firebase.firestore && isFirebaseConfigured) ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString(),
      lastLoginAt: (typeof firebase !== 'undefined' && firebase.firestore && isFirebaseConfigured) ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString()
    };

    if (encryptedPassword) {
      userDoc.encryptedPassword = encryptedPassword;
      userDoc.cipherVersion = "MendorbitAlphabetCipher_v2";
    }
    if (attributionData) {
      userDoc.attribution = attributionData;
    }

    if (isFirebaseConfigured && firestoreDb) {
      try {
        await firestoreDb.collection("users").doc(docId).set(userDoc, { merge: true });
        console.log("[Mendorbit Backend] User persisted to Firestore users collection as:", docId);
      } catch (err) {
        console.warn("[Mendorbit Backend] Firestore write note:", err);
      }
    }

    // Helper to read encrypted user db
    const getLocalUsersDb = () => {
      if (typeof MendorbitSecureStorage !== 'undefined') {
        return MendorbitSecureStorage.getItem("mendorbit_users_db") || {};
      }
      try {
        return JSON.parse(localStorage.getItem("mendorbit_users_db") || "{}");
      } catch (e) { return {}; }
    };

    // Helper to save encrypted user db
    const saveLocalUsersDb = (usersObj) => {
      if (typeof MendorbitSecureStorage !== 'undefined') {
        MendorbitSecureStorage.setItem("mendorbit_users_db", usersObj);
      } else {
        try {
          localStorage.setItem("mendorbit_users_db", JSON.stringify(usersObj));
        } catch (e) {}
      }
    };

    // Mirror public profile to local cache (strictly omit passwords from client storage)
    const safeLocalDoc = {
      uid: userDoc.uid,
      displayName: userDoc.displayName,
      email: userDoc.email,
      class: userDoc.class,
      photoURL: userDoc.photoURL,
      status: userDoc.status,
      attribution: userDoc.attribution || {}
    };
    const users = getLocalUsersDb();
    users[docId] = safeLocalDoc;
    saveLocalUsersDb(users);

    return safeLocalDoc;
  },

  /**
   * Fetch user by email (Keyed directly by email with query fallback)
   */
  async getUserByEmail(email) {
    if (!email) return null;
    const normalized = email.toLowerCase().trim();

    // 1. Try Firebase Client SDK (Fast direct live document lookup)
    let firestoreFailed = false;
    if (isFirebaseConfigured && firestoreDb) {
      try {
        const directDoc = await firestoreDb.collection("users").doc(normalized).get();
        if (directDoc.exists) {
          const docData = directDoc.data() || {};
          if (!docData.email) docData.email = normalized;
          if (!docData.uid) docData.uid = normalized;
          try {
            localStorage.setItem("mendorbit_profile_" + normalized, JSON.stringify(docData));
            localStorage.setItem("mendorbit_profile_" + email, JSON.stringify(docData));
          } catch (e) {}
          return docData;
        }

        if (email !== normalized) {
          const rawDoc = await firestoreDb.collection("users").doc(email).get();
          if (rawDoc.exists) {
            const docData = rawDoc.data() || {};
            if (!docData.email) docData.email = normalized;
            if (!docData.uid) docData.uid = normalized;
            try {
              localStorage.setItem("mendorbit_profile_" + normalized, JSON.stringify(docData));
              localStorage.setItem("mendorbit_profile_" + email, JSON.stringify(docData));
            } catch (e) {}
            return docData;
          }
        }

        const snapshot = await firestoreDb.collection("users").where("email", "==", normalized).limit(1).get();
        if (!snapshot.empty) {
          const found = snapshot.docs[0].data() || {};
          if (!found.email) found.email = normalized;
          if (!found.uid) found.uid = normalized;
          try {
            localStorage.setItem("mendorbit_profile_" + normalized, JSON.stringify(found));
            localStorage.setItem("mendorbit_profile_" + email, JSON.stringify(found));
          } catch (e) {}
          return found;
        }

        // IMPORTANT: Firestore SDK is online and healthy, and confirmed user does not exist.
        return null;
      } catch (err) {
        firestoreFailed = true;
        console.warn("[Mendorbit Backend] Firestore lookup note:", err);
      }
    } else {
      firestoreFailed = true;
    }

    // 2. Try Cloudflare Worker Endpoint ONLY IF Firestore Client SDK was unavailable/errored
    if (firestoreFailed) {
      try {
        const workerUrl = (typeof MENDORBIT_WORKER_URL !== 'undefined') ? MENDORBIT_WORKER_URL : "";
        if (workerUrl) {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2500); // Strict 2.5s timeout
          const res = await fetch(`${workerUrl}/api/auth/check-user?email=${encodeURIComponent(normalized)}`, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (res.ok) {
            const data = await res.json();
            if (data && data.status === "success" && data.exists && data.user) {
              return data.user;
            }
          }
        }
      } catch (e) {}
    }

    // 3. Fallback to Local Profile Cache ONLY IF network/Firestore failed
    try {
      const cached = localStorage.getItem("mendorbit_profile_" + normalized) || localStorage.getItem("mendorbit_profile_" + email);
      if (cached) return JSON.parse(cached);
    } catch(e) {}

    const users = (typeof MendorbitSecureStorage !== 'undefined')
      ? (MendorbitSecureStorage.getItem("mendorbit_users_db") || {})
      : JSON.parse(localStorage.getItem("mendorbit_users_db") || "{}");
    return users[normalized] || users[email] || null;
  },

  /**
   * Update password in database
   */
  async updatePassword(email, newEncryptedPassword) {
    const normalized = email.toLowerCase().trim();

    if (isFirebaseConfigured && firestoreDb) {
      try {
        const snapshot = await firestoreDb.collection("users").where("email", "==", normalized).limit(1).get();
        if (!snapshot.empty) {
          await snapshot.docs[0].ref.update({
            encryptedPassword: newEncryptedPassword,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          console.log("[Mendorbit Backend] Password updated in Firestore.");
        }
      } catch (err) {
        console.warn("[Mendorbit Backend] Firestore password update note:", err);
      }
    }

    const users = (typeof MendorbitSecureStorage !== 'undefined')
      ? (MendorbitSecureStorage.getItem("mendorbit_users_db") || {})
      : JSON.parse(localStorage.getItem("mendorbit_users_db") || "{}");
    if (users[normalized]) {
      users[normalized].encryptedPassword = newEncryptedPassword;
      users[normalized].updatedAt = new Date().toISOString();
      if (typeof MendorbitSecureStorage !== 'undefined') {
        MendorbitSecureStorage.setItem("mendorbit_users_db", users);
      } else {
        localStorage.setItem("mendorbit_users_db", JSON.stringify(users));
      }
    }
  },

  /**
   * Helper to determine friendly device and browser string
   */
  getFriendlyDevice(ua) {
    if (!ua) return { friendly: "Windows PC • Chrome", type: "Desktop" };
    let os = "Desktop";
    let type = "Desktop";
    if (/Android/i.test(ua)) { os = "Android"; type = "Mobile"; }
    else if (/iPhone/i.test(ua)) { os = "Apple iPhone"; type = "Mobile"; }
    else if (/iPad/i.test(ua)) { os = "Apple iPad"; type = "Tablet"; }
    else if (/Windows/i.test(ua)) { os = "Windows PC"; type = "Desktop"; }
    else if (/Macintosh|Mac OS/i.test(ua)) { os = "Mac"; type = "Desktop"; }
    else if (/Linux/i.test(ua)) { os = "Linux"; type = "Desktop"; }

    let browser = "Chrome";
    if (/Edg/i.test(ua)) browser = "Edge";
    else if (/Firefox/i.test(ua)) browser = "Firefox";
    else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = "Safari";
    else if (/Chrome/i.test(ua)) browser = "Chrome";

    return { friendly: `${os} • ${browser}`, type };
  },

  /**
   * Record active student login session in Firestore
   */
  async recordUserSession(email, sessionData = {}) {
    if (!email) return null;
    const normalized = email.toLowerCase().trim();
    const sessionId = sessionData.sessionId || "sess_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8);
    const ua = sessionData.device || navigator.userAgent || "Unknown Device";
    const devInfo = this.getFriendlyDevice(ua);

    const record = {
      sessionId: sessionId,
      device: ua,
      friendlyDevice: sessionData.friendlyDevice || devInfo.friendly,
      deviceType: sessionData.deviceType || devInfo.type,
      ip: sessionData.ip || "127.0.0.1",
      location: sessionData.location || { city: "Patna", region: "Bihar", country: "India" },
      loginTime: sessionData.loginTime || new Date().toISOString(),
      loginEpoch: Date.now(),
      lastActive: new Date().toISOString(),
      lastActiveEpoch: Date.now(),
      isOnline: true,
      authMethod: sessionData.authMethod || sessionData.type || "Password",
      status: "ACTIVE"
    };

    try {
      localStorage.setItem("mendorbit_session_id", sessionId);
    } catch(e) {}

    if (isFirebaseConfigured && firestoreDb) {
      try {
        await firestoreDb.collection("users").doc(normalized).collection("sessions").doc(sessionId).set(record);
        
        // Also keep updated in user's root document sessions map
        const updateMap = {};
        updateMap[`sessions.${sessionId}`] = record;
        updateMap["lastLogin"] = record.loginTime;
        await firestoreDb.collection("users").doc(normalized).set(updateMap, { merge: true });
        console.log("[Mendorbit Backend] Session recorded in Firestore for " + normalized + ": " + sessionId);
      } catch (err) {
        console.warn("[Mendorbit Backend] Session record note:", err);
      }
    }

    return sessionId;
  },

  /**
   * Retrieve all login sessions for a user
   */
  async getUserSessions(email) {
    if (!email) return [];
    const normalized = email.toLowerCase().trim();
    const sessionsList = [];

    if (isFirebaseConfigured && firestoreDb) {
      try {
        const snapshot = await firestoreDb.collection("users").doc(normalized).collection("sessions").orderBy("loginEpoch", "desc").get();
        snapshot.forEach(doc => {
          sessionsList.push(doc.data());
        });
        if (sessionsList.length > 0) return sessionsList;
      } catch (err) {
        console.warn("[Mendorbit Backend] Fetch sessions note:", err);
      }

      // Fallback: check root user document map from local cache first
      try {
        const cached = localStorage.getItem("mendorbit_profile_" + normalized) || localStorage.getItem("mendorbit_profile_" + email);
        if (cached) {
          const userDoc = JSON.parse(cached);
          if (userDoc && userDoc.sessions && typeof userDoc.sessions === 'object') {
            return Object.values(userDoc.sessions).sort((a, b) => (b.loginEpoch || 0) - (a.loginEpoch || 0));
          }
        }
      } catch (e) {}
    }

    return sessionsList;
  },

  /**
   * Revoke / Terminate a specific user session (Remote Logout)
   */
  async revokeUserSession(email, sessionId) {
    if (!email || !sessionId) return false;
    const normalized = email.toLowerCase().trim();
    const nowIso = new Date().toISOString();

    if (isFirebaseConfigured && firestoreDb) {
      try {
        await firestoreDb.collection("users").doc(normalized).collection("sessions").doc(sessionId).set({
          status: "LOGGED_OUT",
          isOnline: false,
          loggedOutAt: nowIso,
          lastActive: nowIso,
          lastActiveEpoch: Date.now()
        }, { merge: true });

        const updateMap = {};
        updateMap[`sessions.${sessionId}.status`] = "LOGGED_OUT";
        updateMap[`sessions.${sessionId}.isOnline`] = false;
        updateMap[`sessions.${sessionId}.loggedOutAt`] = nowIso;
        updateMap[`sessions.${sessionId}.lastActive`] = nowIso;
        updateMap[`sessions.${sessionId}.lastActiveEpoch`] = Date.now();
        await firestoreDb.collection("users").doc(normalized).set(updateMap, { merge: true });
        console.log(`[Mendorbit Backend] Session ${sessionId} revoked for ${normalized}`);
        return true;
      } catch (err) {
        console.warn("[Mendorbit Backend] Revoke session error:", err);
      }
    }
    return false;
  },

  /**
   * Revoke all other active sessions except current
   */
  async revokeAllOtherSessions(email, currentSessionId) {
    if (!email) return false;
    const normalized = email.toLowerCase().trim();
    const allSessions = await this.getUserSessions(normalized);
    let count = 0;

    for (const sess of allSessions) {
      if (sess.sessionId !== currentSessionId && sess.status === "ACTIVE") {
        await this.revokeUserSession(normalized, sess.sessionId);
        count++;
      }
    }
    return count;
  },

  /**
   * Permanently delete a terminated/logged-out session from history
   */
  async deleteUserSession(email, sessionId) {
    if (!email || !sessionId) return false;
    const normalized = email.toLowerCase().trim();
    if (isFirebaseConfigured && firestoreDb) {
      try {
        await firestoreDb.collection("users").doc(normalized).collection("sessions").doc(sessionId).delete();
        const updateMap = {};
        updateMap[`sessions.${sessionId}`] = firebase.firestore.FieldValue.delete();
        await firestoreDb.collection("users").doc(normalized).update(updateMap).catch(() => {});
        console.log(`[Mendorbit Backend] Session ${sessionId} deleted from history for ${normalized}`);
        return true;
      } catch (err) {
        console.warn("[Mendorbit Backend] Delete session error:", err);
      }
    }
    return false;
  },

  /**
   * Clear all logged-out sessions from history
   */
  async clearLoggedOutSessions(email) {
    if (!email) return false;
    const normalized = email.toLowerCase().trim();
    if (isFirebaseConfigured && firestoreDb) {
      try {
        const snap = await firestoreDb.collection("users").doc(normalized).collection("sessions").where("status", "==", "LOGGED_OUT").get();
        const batch = firestoreDb.batch();
        const updateMap = {};
        snap.forEach(doc => {
          batch.delete(doc.ref);
          updateMap[`sessions.${doc.id}`] = firebase.firestore.FieldValue.delete();
        });
        await batch.commit();
        if (Object.keys(updateMap).length > 0) {
          await firestoreDb.collection("users").doc(normalized).update(updateMap).catch(() => {});
        }
        return true;
      } catch (err) {
        console.warn("[Mendorbit Backend] Clear history error:", err);
      }
    }
    return false;
  },

  /**
   * Migrate User Email (Transfers 100% Student Profile, Sessions, & Locks Old Account)
   */
  async migrateUserEmail(oldEmail, newEmail, clientFullPayload = null) {
    if (!oldEmail || !newEmail) return false;
    const oldNorm = oldEmail.toLowerCase().trim();
    const newNorm = newEmail.toLowerCase().trim();

    if (isFirebaseConfigured && firestoreDb) {
      try {
        const oldDocRef = firestoreDb.collection("users").doc(oldNorm);
        const oldDocSnap = await oldDocRef.get();
        let oldData = {};
        if (oldDocSnap.exists) {
          oldData = oldDocSnap.data() || {};
        }

        // Comprehensive merge: Prioritize rich client payload over partial old doc
        const clientData = (clientFullPayload && typeof clientFullPayload === 'object') ? clientFullPayload : {};
        const fullMigratedData = Object.assign({}, oldData, clientData);

        fullMigratedData.email = newNorm;
        fullMigratedData.uid = newNorm;
        fullMigratedData.updatedAt = new Date().toISOString();
        fullMigratedData.previousEmail = oldNorm;

        if (!Array.isArray(fullMigratedData.emailHistory)) {
          fullMigratedData.emailHistory = [];
        }
        if (!fullMigratedData.emailHistory.includes(oldNorm)) {
          fullMigratedData.emailHistory.push(oldNorm);
        }

        // If previously verified or completed kyc, ensure status is preserved 100%
        if (oldData.isVerified || clientData.isVerified || oldData.kycCompleted || clientData.kycCompleted) {
          fullMigratedData.isVerified = true;
          fullMigratedData.kycCompleted = true;
          fullMigratedData.kycStatus = "VERIFIED";
          fullMigratedData.kycPercentage = 100;
        }

        // 1. Create / Overwrite 100% full user document in Firestore under new email key
        await firestoreDb.collection("users").doc(newNorm).set(fullMigratedData);

        // 2. Transfer active sessions subcollection to new email doc
        try {
          const sessionsSnap = await oldDocRef.collection("sessions").get();
          if (!sessionsSnap.empty) {
            const batch = firestoreDb.batch();
            sessionsSnap.forEach(sDoc => {
              const newSessionRef = firestoreDb.collection("users").doc(newNorm).collection("sessions").doc(sDoc.id);
              batch.set(newSessionRef, sDoc.data());
              batch.delete(sDoc.ref); // Clean up from old account
            });
            await batch.commit();
          }
        } catch (sessErr) {
          console.warn("[Mendorbit Backend] Session migration note:", sessErr);
        }

        // 3. Permanently lock & neutralize old account in Firestore (Blocks any login attempt)
        await oldDocRef.set({
          email: oldNorm,
          accountLocked: true,
          isMigrated: true,
          migratedTo: newNorm,
          migratedAt: new Date().toISOString(),
          encryptedPassword: "",
          passwordHash: "",
          status: "migrated",
          updatedAt: new Date().toISOString()
        }, false);

        // 4. Clean local storage and secure vault cache
        try {
          localStorage.removeItem("mendorbit_profile_" + oldNorm);
          localStorage.removeItem("mendorbit_profile_" + oldEmail);
          localStorage.setItem("mendorbit_profile_" + newNorm, JSON.stringify(fullMigratedData));

          if (typeof MendorbitSecureStorage !== 'undefined') {
            const users = MendorbitSecureStorage.getItem("mendorbit_users_db") || {};
            delete users[oldNorm];
            delete users[oldEmail];
            users[newNorm] = fullMigratedData;
            MendorbitSecureStorage.setItem("mendorbit_users_db", users);
          }
          const rawUsers = JSON.parse(localStorage.getItem("mendorbit_users_db") || "{}");
          delete rawUsers[oldNorm];
          delete rawUsers[oldEmail];
          rawUsers[newNorm] = fullMigratedData;
          localStorage.setItem("mendorbit_users_db", JSON.stringify(rawUsers));
        } catch (cacheErr) {
          console.warn("[Mendorbit Backend] Local cache migration note:", cacheErr);
        }

        console.log(`[Mendorbit Backend] User account 100% migrated from ${oldNorm} to ${newNorm}`);
        return true;
      } catch (err) {
        console.error("[Mendorbit Backend] Email migration error:", err);
        throw err;
      }
    }
    return false;
  },

  /**
   * Retrieve all users (for admin.html inspection)
   */
  async getAllUsers() {
    if (isFirebaseConfigured && firestoreDb) {
      try {
        const snapshot = await firestoreDb.collection("users").orderBy("createdAt", "desc").get();
        const list = [];
        snapshot.forEach(doc => list.push(doc.data()));
        if (list.length > 0) return list;
      } catch (e) {
        console.warn("[Mendorbit Backend] Admin fetch from Firestore note:", e);
      }
    }

    const users = (typeof MendorbitSecureStorage !== 'undefined')
      ? (MendorbitSecureStorage.getItem("mendorbit_users_db") || {})
      : JSON.parse(localStorage.getItem("mendorbit_users_db") || "{}");
    return Object.values(users);
  }
};
