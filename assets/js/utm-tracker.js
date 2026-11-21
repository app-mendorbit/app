/**
 * MENDORBIT UTM ATTRIBUTION & SAFE REDIRECT ENGINE
 * Features:
 * 1. Automatic extraction of UTM parameters (source, medium, campaign, term, content).
 * 2. Captures entry landing URL (utm_link) and HTTP Referrer.
 * 3. Persists attribution state across session navigation so it is preserved until signup.
 * 4. Safe URL Redirect validator against Open Redirect vulnerabilities (whitelisting *.mendorbit.in & Netlify test site).
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MendorbitTracker = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  const STORAGE_KEY = "mendorbit_attribution_data";
  const FIRST_TOUCH_KEY = "mendorbit_first_attribution";
  const DEFAULT_REDIRECT = "dashboard.html";

  // Allowed domains for redirection security
  const ALLOWED_REDIRECT_PATTERNS = [
    /^mendorbit\.in$/i,
    /^[a-z0-9-]+\.mendorbit\.in$/i,
    /^mendorbit-test\.netlify\.app$/i,
    /^mendorbit-login-test\.netlify\.app$/i,
    /^localhost(:\d+)?$/i,
    /^127\.0\.0\.1(:\d+)?$/i
  ];

  /**
   * Parse current query parameters
   */
  function parseQueryParams() {
    const params = new URLSearchParams(window.location.search);
    const result = {};
    for (const [key, value] of params.entries()) {
      result[key] = value.trim();
    }
    return result;
  }

  /**
   * Capture and persist UTM attribution data (Strict First-Touch Acquisition Lock)
   * Only records once at first entry / registration, never repeatedly overwrites with 'direct'
   */
  function captureAttribution() {
    const params = parseQueryParams();
    let stored = {};

    try {
      // Check permanent localStorage first-touch cache
      const firstStored = localStorage.getItem(FIRST_TOUCH_KEY);
      if (firstStored) {
        stored = JSON.parse(firstStored);
      } else {
        const sessionStored = sessionStorage.getItem(STORAGE_KEY);
        if (sessionStored) {
          stored = JSON.parse(sessionStored);
        }
      }
    } catch (e) {
      console.warn("Storage access restricted:", e);
    }

    // If explicit UTM parameters are present in URL, capture them
    const hasExplicitUtm = !!(params.utm_source || params.utm_medium || params.utm_campaign);

    // If already stored and current URL has NO explicit new UTM campaign, preserve existing attribution!
    if (!hasExplicitUtm && stored && stored.utm_source) {
      return stored;
    }

    // Capture standard marketing UTM tags
    const currentAttribution = {
      utm_source: params.utm_source || stored.utm_source || "direct",
      utm_medium: params.utm_medium || stored.utm_medium || "none",
      utm_campaign: params.utm_campaign || stored.utm_campaign || "none",
      utm_term: params.utm_term || stored.utm_term || "",
      utm_content: params.utm_content || stored.utm_content || "",
      
      // Where user arrived from
      utm_link: params.utm_link || window.location.href,
      referrer: document.referrer || stored.referrer || "direct",
      entry_timestamp: stored.entry_timestamp || new Date().toISOString(),
      user_agent: navigator.userAgent
    };

    try {
      localStorage.setItem(FIRST_TOUCH_KEY, JSON.stringify(currentAttribution));
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(currentAttribution));
    } catch (e) {}

    return currentAttribution;
  }

  /**
   * Retrieve currently active attribution data
   */
  function getAttribution() {
    try {
      const firstStored = localStorage.getItem(FIRST_TOUCH_KEY);
      if (firstStored) return JSON.parse(firstStored);
      const sessionStored = sessionStorage.getItem(STORAGE_KEY);
      if (sessionStored) return JSON.parse(sessionStored);
    } catch (e) {}
    return captureAttribution();
  }

  /**
   * Validate destination URL against open redirect vulnerabilities
   */
  function isSafeRedirect(targetUrl) {
    if (!targetUrl) return false;
    targetUrl = targetUrl.trim();

    // Safe relative paths (e.g. /dashboard or /courses?id=1, but not protocol-relative //malicious.com)
    if (targetUrl.startsWith('/') && !targetUrl.startsWith('//')) {
      return true;
    }

    try {
      const parsed = new URL(targetUrl, window.location.origin);
      const hostname = parsed.hostname;
      return ALLOWED_REDIRECT_PATTERNS.some(pattern => pattern.test(hostname));
    } catch (e) {
      return false;
    }
  }

  /**
   * Get target redirect destination based on 'redirect' or 'redirect_url' query params
   */
  function getValidatedRedirectUrl() {
    const params = parseQueryParams();
    const candidate = params.redirect_url || params.redirect;

    if (candidate && isSafeRedirect(candidate)) {
      return candidate;
    }

    return DEFAULT_REDIRECT;
  }

  /**
   * Geolocation Module: Requests browser permission for exact GPS coordinates
   */
  let cachedLocation = null;

  async function requestExactLocation() {
    if (cachedLocation) return cachedLocation;
    if (!navigator.geolocation) return null;

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          const accuracy = Math.round(pos.coords.accuracy);

          let exactPlace = "";
          let city = "";
          let region = "";
          let country = "India";

          try {
            // Reverse geocode with 2-second timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1`, {
              signal: controller.signal,
              headers: { "Accept-Language": "en" }
            });
            clearTimeout(timeoutId);
            if (geoRes.ok) {
              const geoData = await geoRes.json();
              const addr = geoData.address || {};
              city = addr.city || addr.town || addr.village || addr.suburb || addr.county || "";
              region = addr.state || "";
              country = addr.country || "India";
              const locality = addr.suburb || addr.neighbourhood || addr.road || "";
              if (locality && city) {
                exactPlace = `${locality}, ${city}, ${region}`;
              } else if (city) {
                exactPlace = `${city}, ${region}`;
              }
            }
          } catch (e) {}

          cachedLocation = {
            latitude: lat,
            longitude: lon,
            accuracy: accuracy,
            city: city || "Detected Location",
            region: region,
            country: country,
            exactPlace: exactPlace || (city ? `${city}, ${region}` : `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`),
            isExactGps: true
          };

          try {
            sessionStorage.setItem("mendorbit_exact_location", JSON.stringify(cachedLocation));
          } catch (e) {}

          console.log("[Geolocation] Exact GPS position acquired:", cachedLocation);
          resolve(cachedLocation);
        },
        (err) => {
          console.warn("[Geolocation] Permission note:", err.message);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 300000 }
      );
    });
  }

  function getExactLocation() {
    if (cachedLocation) return cachedLocation;
    try {
      const stored = sessionStorage.getItem("mendorbit_exact_location");
      if (stored) {
        cachedLocation = JSON.parse(stored);
        return cachedLocation;
      }
    } catch (e) {}
    return null;
  }

  /**
   * Perform safe redirect after authentication
   */
  function executePostLoginRedirect() {
    const destination = getValidatedRedirectUrl();
    console.log("[Mendorbit Redirect] Directing user to:", destination);
    window.location.href = destination;
  }

  return {
    captureAttribution: captureAttribution,
    getAttribution: getAttribution,
    isSafeRedirect: isSafeRedirect,
    getValidatedRedirectUrl: getValidatedRedirectUrl,
    executePostLoginRedirect: executePostLoginRedirect,
    requestExactLocation: requestExactLocation,
    getExactLocation: getExactLocation
  };
});
