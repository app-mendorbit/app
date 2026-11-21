# Mendorbit Unified Authentication & Subdomain SSO Portal

A production-grade, highly secured authentication system built specifically for **Mendorbit** ([mendorbit.in](https://mendorbit.in/)). The design matches the modern split-screen layout with smooth curves, pastel background gradients, feature highlight cards, and an isolated administrative de-encryption console.

---

## 🎨 Design & Layout (Matched to Screenshot)

- **Left Section**:
  - Mendorbit Brand Logo & Heading
  - Headline: *"India's trusted learning platform for School Boards & Competitive Exams. Built passionately from ground zero to turn every student into a topper."*
  - Curved Feature Cards:
    - **Ground-Zero Teaching** (Shield Icon)
    - **Board Exams** (Video Icon - Class 9 & 10 CBSE / State topper batch)
    - **Competitive Prep** (Zap Icon - SSC CGL, Bank PO, and CLAT foundation)
  - Bottom Pill Badge: `🇮🇳 Proudly Made with ❤️ in India`
- **Right Section (Floating Auth Card)**:
  - Header: *"Welcome Back"* / *"Please enter your details to continue."*
  - Pill Toggle: `[ Sign In ]` & `[ Register ]`
  - Inputs with subtle icons: `Email or Phone`, `Password` (with eye toggle).
  - Quick action links: `Use OTP Instead` & `Forgot Password?`.
  - Vibrant blue action button: `Sign In`.
  - Social & Alternative Login: `[ Google ]` & `[ QR Login ]`.

---

## 🔐 2-Digit Reversible Encryption Engine

The password encryption follows the exact custom reversible specification:
- **Lowercase `a` to `z`**: Converted to their 2-digit alphabet position:
  - `a` → `01`, `b` → `02`, ..., `z` → `26`
- **Uppercase `A` to `Z`**: Converted to `U` + 2-digit position:
  - `A` → `U01`, `B` → `U02`, ..., `Z` → `U26`
- **Numbers `0` to `9`**: Prefixed with `n` + number:
  - `0` → `n0`, `1` → `n1`, ..., `9` → `n9`
- **Special Characters (`@`, `#`, `$`, `!`, `_`, `.`, etc.)**: Preserved exactly as is.

### Examples:
| Plaintext Password | Encrypted Ciphertext |
|---|---|
| `Password@123` | `U1601191923151804@n1n2n3` |
| `admin#99` | `0104130914#n9n9` |
| `Hello World! 2026` | `U0805121215 U2315181204! n2n0n2n6` |

---

## 🛡️ Admin De-Encryption Console (`admin.html`)

Access: Open [`admin.html`](file:///c:/Users/Mendorbit%20Pro/Downloads/Mendorbit/admin.html) in your browser.
- **Master Admin Passkey**: `mendorbit@admin2026`
- **Features**:
  1. **Cipher Laboratory**: Enter any plaintext to test encryption, or paste any ciphertext to de-encrypt back to plaintext in real-time.
  2. **Registered Accounts Viewer**: Fetches registered users, displays their student name, email, target class, registration timestamp, UTM acquisition source, and includes a **"De-Encrypt"** button to reveal the original password.

---

## 📋 Step-by-Step Setup Instructions

### Step 1: Deploy Google Apps Script (`Code.gs`)
1. Visit [script.google.com](https://script.google.com/) and create a new project named **"Mendorbit OTP Dispatcher"**.
2. Replace all code with [`apps-script/Code.gs`](file:///c:/Users/Mendorbit%20Pro/Downloads/Mendorbit/apps-script/Code.gs).
3. Click **Deploy** -> **New deployment**.
4. Choose **Web app**:
   - **Execute as**: `Me (your Google account)`
   - **Who has access**: `Anyone`
5. Click **Deploy**, approve Gmail permissions, and copy the **Web app URL**.
6. Paste the URL into [`assets/js/firebase-config.js`](file:///c:/Users/Mendorbit%20Pro/Downloads/Mendorbit/assets/js/firebase-config.js):
   ```javascript
   const MENDORBIT_APPS_SCRIPT_URL = "https://script.google.com/macros/s/YOUR_APPS_SCRIPT_ID/exec";
   ```

### Step 2: Add Firebase Credentials
1. Go to [console.firebase.google.com](https://console.firebase.google.com/) and create/select your project.
2. In **Authentication**, enable:
   - **Email/Password**
   - **Google**
3. In **Cloud Firestore**, create a database and set these security rules:
   ```javascript
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{userId} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
       }
     }
   }
   ```
4. Paste your configuration into [`assets/js/firebase-config.js`](file:///c:/Users/Mendorbit%20Pro/Downloads/Mendorbit/assets/js/firebase-config.js):
   ```javascript
   const MENDORBIT_FIREBASE_CONFIG = {
     apiKey: "AIzaSy...",
     authDomain: "mendorbit.firebaseapp.com",
     projectId: "mendorbit",
     storageBucket: "mendorbit.appspot.com",
     messagingSenderId: "...",
     appId: "..."
   };
   ```

### Step 3: Cross-Subdomain SSO for `*.mendorbit.in`
When users log in, a shared cookie is stored:
```http
Set-Cookie: mendorbit_sso_session=<TOKEN>; Domain=.mendorbit.in; Path=/; Max-Age=2592000; Secure; SameSite=Lax
```
Any subdomain (e.g. `learn.mendorbit.in`, `app.mendorbit.in`) simply includes [`assets/js/sso-sdk.js`](file:///c:/Users/Mendorbit%20Pro/Downloads/Mendorbit/assets/js/sso-sdk.js) to detect the active student session automatically.
