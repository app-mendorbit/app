/**
 * MENDORBIT SUBDOMAIN SSO CLIENT SDK (sso-sdk.js)
 * Usage in any Mendorbit Subdomain (e.g., learn.mendorbit.in, app.mendorbit.in):
 * 
 * <script src="https://mendorbit.in/assets/js/sso-sdk.js"></script>
 * <script>
 *   MendorbitSSOSDK.init({
 *     authUrl: 'https://mendorbit.in/login',
 *     requireAuth: true, // Auto-redirect to login if not logged in
 *     onUserReady: function(user) {
 *       console.log('Logged in student:', user.displayName, user.class);
 *       document.getElementById('studentName').innerText = user.displayName;
 *     }
 *   });
 * </script>
 */

(function (root) {
  const SDK = {
    version: "1.0.0",
    cookieName: "mendorbit_sso_session",
    storageKey: "mendorbit_sso_user",

    getUser: function () {
      // 1. Try reading wildcard cookie
      const nameEQ = this.cookieName + "=";
      const ca = document.cookie.split(';');
      for (let i = 0; i < ca.length; i++) {
        let c = ca[i].trim();
        if (c.indexOf(nameEQ) === 0) {
          const raw = decodeURIComponent(c.substring(nameEQ.length));
          try {
            const parts = raw.split('.');
            return JSON.parse(decodeURIComponent(atob(parts[0])));
          } catch (e) {}
        }
      }

      // 2. Try localStorage / Encrypted Vault
      try {
        if (typeof MendorbitSecureStorage !== 'undefined') {
          const secure = MendorbitSecureStorage.getItem(this.storageKey);
          if (secure) return secure;
        }
        const stored = localStorage.getItem(this.storageKey);
        if (stored) return JSON.parse(stored);
      } catch (e) {}

      return null;
    },

    isLoggedIn: function () {
      const user = this.getUser();
      if (!user) return false;
      if (user.expiresAt && Date.now() > user.expiresAt) return false;
      return true;
    },

    logout: function (redirectUrl) {
      document.cookie = `${this.cookieName}=; Max-Age=-99999999; domain=.mendorbit.in; path=/;`;
      document.cookie = `${this.cookieName}=; Max-Age=-99999999; path=/;`;
      try { localStorage.removeItem(this.storageKey); } catch (e) {}
      if (redirectUrl) window.location.href = redirectUrl;
    },

    init: function (options) {
      options = options || {};
      const user = this.getUser();
      const authUrl = options.authUrl || "https://mendorbit.in";

      if (this.isLoggedIn()) {
        // Passive user callback
        if (typeof options.onUserReady === 'function') {
          options.onUserReady(user);
        }
      } else if (options.requireAuth) {
        const currentUrl = encodeURIComponent(window.location.href);
        window.location.href = `${authUrl}?redirect_url=${currentUrl}`;
      }
    }
  };

  root.MendorbitSSOSDK = SDK;
})(typeof self !== 'undefined' ? self : this);
