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

    // 1. Try Firebase Client SDK
    if (isFirebaseConfigured && firestoreDb) {
      try {
        const directDoc = await firestoreDb.collection("users").doc(normalized).get();
        if (directDoc.exists) {
          return directDoc.data();
        }

        const snapshot = await firestoreDb.collection("users").where("email", "==", normalized).limit(1).get();
        if (!snapshot.empty) {
          return snapshot.docs[0].data();
        }
      } catch (err) {
        console.warn("[Mendorbit Backend] Firestore lookup note:", err);
      }
    }

    // 2. Try Cloudflare Worker Endpoint (Direct server-side lookup via Firestore REST API)
    try {
      const workerUrl = (typeof MENDORBIT_WORKER_URL !== 'undefined') ? MENDORBIT_WORKER_URL : "";
      if (workerUrl) {
        const res = await fetch(`${workerUrl}/api/auth/check-user?email=${encodeURIComponent(normalized)}`);
        const data = await res.json();
        if (data && data.status === "success" && data.exists && data.user) {
          return data.user;
        }
      }
    } catch (e) {}

    // 3. Try Local Encrypted Browser Vault
    const users = (typeof MendorbitSecureStorage !== 'undefined')
      ? (MendorbitSecureStorage.getItem("mendorbit_users_db") || {})
      : JSON.parse(localStorage.getItem("mendorbit_users_db") || "{}");
    return users[normalized] || null;
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
   * Record active student login session in Firestore
   */
  async recordUserSession(email, sessionData) {
    if (!email) return;
    const normalized = email.toLowerCase().trim();
    if (isFirebaseConfigured && firestoreDb) {
      try {
        const sessionId = "sess_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
        const record = {
          ...sessionData,
          sessionId,
          loginTime: new Date().toISOString()
        };
        await firestoreDb.collection("users").doc(normalized).collection("sessions").doc(sessionId).set(record);
        console.log("[Mendorbit Backend] Session recorded in Firestore subcollection for " + normalized);
      } catch (err) {
        console.warn("[Mendorbit Backend] Session record note:", err);
      }
    }
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
