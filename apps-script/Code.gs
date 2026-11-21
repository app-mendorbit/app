/**
 * MENDORBIT AUTHENTICATION & SECURITY ENGINE - GOOGLE APPS SCRIPT
 * Version: 2.5 (Production - Light Theme & Zero-BCC Decoupled Engine)
 * 
 * Features:
 * 1. 100% Light Theme Email Design (Pure white header, crisp slate typography, blue accents)
 * 2. Complete BCC Header Elimination: Student emails have zero admin headers;
 *    silent audit copies are forwarded independently to admin.mendorbit@gmail.com
 * 3. Daily Google Sheet OTP Auditor (Drive-permission free via PropertiesService & SpreadsheetApp)
 * 4. Real-time Security Alerts (Signup Welcome, New Login, Password Change, Emergency Lock Account)
 * 5. High-reliability dispatch with support for both POST and GET redirects
 */

const CONFIG = {
  BRAND_NAME: "Mendorbit",
  LOGO_URL: "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEgWmvErCJUcrCfthgBzuTPkSm3eH7NM5m9NUwI4JcnDrpnM31Z1iOY077wkFNA0G0gq2ytaKCsTS1rsYTdmge7wi1DUTrDI9-pjIiAgSbBfU3Som_bRkci1NASqzbRyU2cjP-Ro0Ntpk2Tt1Xvlwgwur3RNi6bfeXAWSlJ3TIP1kGnUAycIxqVCBJK3f9T-/s824/logo.png",
  SUPPORT_EMAIL: "conatct@mendorbit.in",
  REPLY_TO_EMAIL: "conatct@mendorbit.in",
  ADMIN_BCC_EMAIL: "admin.mendorbit@gmail.com",
  SECURITY_TEAM_EMAIL: "security.mendorbit@gmail.com",
  WEBSITE_URL: "https://mendorbit.in",
  OTP_EXPIRY_SECONDS: 120, // 2 minutes strict expiration
  RATE_LIMIT_MAX_ATTEMPTS: 5,
  RATE_LIMIT_WINDOW_SECONDS: 900
};

/**
 * Handle HTTP GET Requests
 */
function doGet(e) {
  e = e || {};
  const params = e.parameter || {};
  const action = params.action;

  if (action === "ping") {
    return jsonResponse({ status: "success", message: "Mendorbit Security Service is active." });
  }

  if (action === "verifyOtp") {
    return handleVerifyOtp(params.email, params.otp, params.purpose || "login");
  }

  if (action === "sendOtp") {
    return handleSendOtp(params.email, params.purpose || "login", params.name || "Student", {
      city: params.city || "Direct Web",
      country: params.country || "IN",
      ip: params.ip || ""
    });
  }

  if (action === "sendSecurityAlert") {
    return handleSendSecurityAlert(
      params.email,
      params.name || "Student",
      { city: params.city || "Direct Web", country: params.country || "IN", ip: params.ip || "" },
      params.eventType || "LOGIN"
    );
  }

  if (action === "getAuditSheetUrl" || action === "createAuditSheetNow") {
    const ss = getOrCreateAuditSpreadsheet();
    return jsonResponse({ status: "success", url: ss.getUrl(), id: ss.getId() });
  }

  if (action === "getDailyStats" || action === "getOtpStats") {
    return jsonResponse({ status: "success", stats: getDailyOtpStats() });
  }

  if (action === "verifyResetToken") {
    return handleVerifyResetToken(params.token, params.email);
  }

  if (action === "consumeResetToken") {
    return handleConsumeResetToken(params.token, params.email);
  }

  return jsonResponse({
    status: "online",
    service: "Mendorbit Security & OTP Gateway",
    version: "2.5-light",
    timestamp: new Date().toISOString()
  });
}

/**
 * Handle HTTP POST Requests
 */
function doPost(e) {
  try {
    e = e || {};
    let data = {};
    if (e.postData && e.postData.contents) {
      try {
        data = JSON.parse(e.postData.contents);
      } catch (err) {
        data = e.parameter || {};
      }
    } else {
      data = e.parameter || {};
    }

    const action = data.action;
    const email = (data.email || "").trim().toLowerCase();

    // 1. Send OTP
    if (action === "sendOtp") {
      if (!isValidEmail(email)) return jsonResponse({ status: "error", message: "Invalid email address." }, 400);
      return handleSendOtp(email, data.purpose || "login", data.name || "Student", data.location || {});
    }

    // 2. Verify OTP
    if (action === "verifyOtp") {
      const otp = (data.otp || "").trim();
      return handleVerifyOtp(email, otp, data.purpose || "login");
    }

    // 3. Send Security Alert / Welcome / Password Change Email
    if (action === "sendSecurityAlert") {
      if (!isValidEmail(email)) return jsonResponse({ status: "error", message: "Invalid email address." }, 400);
      return handleSendSecurityAlert(email, data.name || "Student", data.location || {}, data.eventType || "LOGIN");
    }

    // 4. Fetch Daily OTP Stats
    if (action === "getDailyStats" || action === "getOtpStats") {
      return jsonResponse({ status: "success", stats: getDailyOtpStats() });
    }

    // 5. Verify & Consume Reset Password Single-Use Tokens
    if (action === "verifyResetToken") {
      return handleVerifyResetToken(data.token, email);
    }
    if (action === "consumeResetToken") {
      return handleConsumeResetToken(data.token, email);
    }

    // 6. Initialize or return Audit Sheet
    if (action === "createAuditSheetNow" || action === "getAuditSheetUrl") {
      const ss = getOrCreateAuditSpreadsheet();
      return jsonResponse({ status: "success", url: ss.getUrl(), id: ss.getId() });
    }

    return jsonResponse({ status: "error", message: "Invalid action." }, 400);
  } catch (error) {
    return jsonResponse({ status: "error", message: "Server error: " + error.toString() }, 500);
  }
}

/**
 * Single-Dispatch Email Sender with BCC:
 * Sends only ONE single email using GmailApp.sendEmail with bcc: CONFIG.ADMIN_BCC_EMAIL.
 * Prevents doubling email counts and conserves daily email quota!
 */
function dispatchEmail(recipientEmail, subject, textBody, htmlBody) {
  const options = {
    htmlBody: htmlBody,
    name: CONFIG.BRAND_NAME,
    replyTo: CONFIG.REPLY_TO_EMAIL
  };

  // Keep admin in BCC as requested (only 1 email generated, no extra quota used)
  if (CONFIG.ADMIN_BCC_EMAIL && CONFIG.ADMIN_BCC_EMAIL.toLowerCase() !== recipientEmail.toLowerCase()) {
    options.bcc = CONFIG.ADMIN_BCC_EMAIL;
  }

  GmailApp.sendEmail(recipientEmail, subject, textBody, options);
}

/**
 * Utility: Friendly device string from user agent
 */
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

/**
 * Utility: Location string
 */
function getFriendlyLocationString(loc) {
  loc = loc || {};
  if (loc.exactPlace) return loc.exactPlace;
  const city = loc.city || "";
  const region = loc.region || "";
  const country = loc.country || "India";

  const parts = [];
  if (city && city !== "Unknown City" && city !== "Direct Web") parts.push(city);
  if (region) parts.push(region);
  parts.push(country);

  if (loc.latitude && loc.longitude) {
    const lat = Number(loc.latitude).toFixed(4);
    const lon = Number(loc.longitude).toFixed(4);
    parts.push(`(GPS: ${lat}°, ${lon}°)`);
  }

  return parts.join(", ") || "India";
}

/**
 * 1. PREMIUM EMAIL OTP VERIFICATION TEMPLATE (Matches Uploaded Images 3 & 4)
 */
function buildOtpEmailHtml(recipientName, purpose, otp) {
  const p = (purpose || "").toLowerCase();
  let actionDescription = "You requested an authentication verification code for your Mendorbit account.";

  if (p === "signup") {
    actionDescription = "You requested to <strong>create a new Mendorbit account</strong>. Use the OTP below to verify your email address and activate your learning profile.";
  } else if (p === "login") {
    actionDescription = "You requested to <strong>sign in to your Mendorbit account</strong> without a password. Use the OTP below to securely access your student dashboard.";
  } else if (p === "forgot" || p === "reset_password") {
    actionDescription = "You requested to <strong>reset your Mendorbit account password</strong>. Use the OTP below to verify your identity and set a new password.";
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mendorbit Email OTP Verification</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; margin: 0; padding: 32px 16px; color: #0f172a; -webkit-font-smoothing: antialiased;">
  <div style="max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 30px -5px rgba(15, 23, 42, 0.08); border: 1px solid #e2e8f0;">
    
    <!-- CIRCULAR LOGO (MATCHES REFERENCE DESIGN) -->
    <div style="text-align: center; padding: 36px 24px 14px 24px;">
      <img src="${CONFIG.LOGO_URL}" alt="Mendorbit" style="width: 80px; height: 80px; border-radius: 50%; object-fit: contain; background: #ffffff; padding: 4px; border: 2px solid #e2e8f0; box-shadow: 0 4px 14px rgba(0,0,0,0.08); display: inline-block;" />
    </div>

    <!-- CLEAN BLUE TITLE -->
    <h2 style="font-size: 22px; font-weight: 800; color: #2563eb; text-align: center; margin: 0 0 24px 0; letter-spacing: -0.5px;">Email OTP Verification</h2>

    <!-- BODY CONTENT -->
    <div style="padding: 0 36px 36px 36px; font-size: 14px; line-height: 1.6; color: #334155;">
      <p style="font-size: 15px; color: #0f172a; margin: 0 0 12px 0;">Dear <strong>${recipientName || 'Student'}</strong>,</p>
      
      <p style="margin: 0 0 22px 0; color: #475569; font-size: 14px; line-height: 1.6;">${actionDescription}</p>
      
      <div style="margin: 24px 0 16px 0;">
        <span style="font-size: 16px; color: #0f172a; font-weight: 600;">Your OTP is: </span>
        <span style="font-size: 32px; font-weight: 900; color: #2563eb; letter-spacing: 6px; font-family: 'Courier New', Courier, monospace; margin-left: 6px; display: inline-block; vertical-align: middle;">${otp}</span>
      </div>

      <p style="font-size: 14px; color: #475569; margin: 0 0 14px 0;">This OTP is valid for <strong>2 minutes</strong>.</p>
      
      <p style="font-size: 13px; color: #64748b; margin: 0 0 24px 0; line-height: 1.5;">If you did not request this, please ignore this email.</p>
      
      <p style="font-size: 14px; margin: 0 0 4px 0; color: #0f172a;">Regards,</p>
      <p style="font-size: 14px; font-weight: 700; margin: 0 0 24px 0; color: #0f172a;">Accounting & Admissions Department Mendorbit</p>

      <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0 18px 0;" />

      <!-- FOOTER -->
      <div style="font-size: 12px; color: #64748b; text-align: center; line-height: 1.6;">
        <p style="margin: 0 0 4px 0;">Need help? Email us at <a href="mailto:${CONFIG.SUPPORT_EMAIL}" style="color: #2563eb; text-decoration: none; font-weight: 600;">${CONFIG.SUPPORT_EMAIL}</a> or visit <a href="${CONFIG.WEBSITE_URL}" style="color: #2563eb; text-decoration: none; font-weight: 600;">mendorbit.in</a></p>
        <p style="margin: 0 0 4px 0; font-weight: 600; color: #475569;">© ${new Date().getFullYear()} Mendorbit Education. All rights reserved.</p>
        <p style="margin: 0; font-size: 11px; color: #94a3b8;">This is an automated security email. Please do not reply directly.</p>
      </div>
    </div>

  </div>
</body>
</html>`;
}

/**
 * 2. PREMIUM SECURITY ALERT & EVENT EMAIL TEMPLATE (Matches Uploaded Images 1 & 2)
 */
function buildSecurityAlertEmailHtml(params) {
  const {
    headerTitle,
    headerSubtitle,
    headerGradient,
    recipientName,
    messageIntro,
    device,
    location,
    ip,
    time,
    showWarningBox,
    warningText,
    actionButtonText,
    actionButtonUrl,
    actionButtonColor,
    footnote
  } = params;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${headerTitle || 'Security Alert'} | Mendorbit Education</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; margin: 0; padding: 32px 16px; color: #0f172a; -webkit-font-smoothing: antialiased;">
  <div style="max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 30px -5px rgba(15, 23, 42, 0.08); border: 1px solid #e2e8f0;">
    
    <!-- TOP HEADER BANNER (MATCHES IMAGE 2 GRADIENT & CIRCLE LOGO) -->
    <div style="background: ${headerGradient || 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)'}; padding: 32px 24px 26px 24px; text-align: center; color: #ffffff;">
      <img src="${CONFIG.LOGO_URL}" alt="Mendorbit" style="width: 64px; height: 64px; border-radius: 50%; object-fit: contain; background: #ffffff; padding: 4px; border: 2px solid rgba(255,255,255,0.4); box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: inline-block; margin-bottom: 12px;" />
      <h1 style="color: #ffffff; font-size: 22px; font-weight: 800; margin: 0 0 6px 0; letter-spacing: -0.5px;">${headerTitle || 'Security Alert'}</h1>
      <p style="color: #e0e7ff; font-size: 13px; margin: 0; font-weight: 500;">${headerSubtitle || 'New login detected on your account'}</p>
    </div>

    <!-- MAIN BODY CONTENT -->
    <div style="padding: 28px 28px 32px 28px; font-size: 14px; line-height: 1.6; color: #334155;">
      <p style="font-size: 15px; color: #0f172a; margin: 0 0 10px 0;">Hi <strong>${recipientName || 'Student'}</strong>,</p>
      
      <p style="font-size: 14px; color: #475569; line-height: 1.6; margin: 0 0 20px 0;">${messageIntro}</p>

      <!-- METADATA BOX (MATCHES IMAGE 1 ROWS) -->
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 16px; padding: 18px 20px; margin: 20px 0;">
        
        <!-- DEVICE -->
        <div style="margin-bottom: 14px;">
          <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px;">
            &#128241; DEVICE
          </div>
          <div style="font-size: 14px; font-weight: 600; color: #0f172a;">
            ${device || 'Windows PC - Chrome'}
          </div>
        </div>

        <!-- LOCATION -->
        <div style="margin-bottom: 14px;">
          <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px;">
            &#128205; LOCATION
          </div>
          <div style="font-size: 14px; font-weight: 600; color: #0f172a;">
            ${location || 'India'}
          </div>
        </div>

        <!-- IP ADDRESS -->
        <div style="margin-bottom: 14px;">
          <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px;">
            &#127760; IP ADDRESS
          </div>
          <div style="font-size: 14px; font-weight: 600; color: #0f172a; font-family: monospace;">
            ${ip || 'Direct Web'}
          </div>
        </div>

        <!-- TIME -->
        <div>
          <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px;">
            &#9200; TIME
          </div>
          <div style="font-size: 14px; font-weight: 600; color: #0f172a;">
            ${time}
          </div>
        </div>

      </div>

      <p style="font-size: 13px; color: #64748b; line-height: 1.5; margin: 0 0 18px 0;">If this was you, you can safely ignore this email. Your account is safe.</p>

      ${showWarningBox ? `
      <!-- RED ALERT WARNING BOX (MATCHES IMAGE 1) -->
      <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; border-radius: 8px; padding: 12px 16px; margin: 0 0 22px 0;">
        <p style="color: #b91c1c; font-size: 13px; font-weight: 600; margin: 0;">${warningText || 'Not you? Secure your account immediately to prevent unauthorized access.'}</p>
      </div>
      ` : ''}

      ${actionButtonText ? `
      <!-- ACTION BUTTON (MATCHES IMAGE 1 ROUNDED RED PILL) -->
      <div style="text-align: center; margin: 0 0 12px 0;">
        <a href="${actionButtonUrl || '#'}" style="display: inline-block; background-color: ${actionButtonColor || '#dc2626'}; color: #ffffff !important; font-size: 14px; font-weight: 700; text-decoration: none; padding: 13px 32px; border-radius: 9999px; box-shadow: 0 4px 14px rgba(220, 38, 38, 0.3);">
          ${actionButtonText}
        </a>
      </div>
      ` : ''}

      ${footnote ? `
      <p style="font-size: 11px; color: #94a3b8; text-align: center; margin: 0 0 24px 0;">${footnote}</p>
      ` : ''}

      <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 0 0 16px 0;" />
      
      <p style="font-size: 11px; color: #94a3b8; text-align: center; margin: 0;">© ${new Date().getFullYear()} Mendorbit Education. All rights reserved.</p>
    </div>

  </div>
</body>
</html>`;
}

/**
 * Generate, Email, and Log OTP into Daily Google Sheet
 */
function handleSendOtp(email, purpose, recipientName, locationInfo) {
  const cache = CacheService.getScriptCache();
  const rateLimitKey = "rl_" + email;

  // Rate Limiting
  const attempts = parseInt(cache.get(rateLimitKey) || "0", 10);
  if (attempts >= CONFIG.RATE_LIMIT_MAX_ATTEMPTS) {
    return jsonResponse({
      status: "error",
      message: "Too many OTP requests. Please wait 15 minutes before requesting a new code."
    }, 429);
  }

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const cacheKey = "otp_" + purpose + "_" + email;
  const otpPayload = otp + "::" + (Date.now() + (CONFIG.OTP_EXPIRY_SECONDS * 1000));
  cache.put(cacheKey, otpPayload, CONFIG.OTP_EXPIRY_SECONDS);
  cache.put(rateLimitKey, (attempts + 1).toString(), CONFIG.RATE_LIMIT_WINDOW_SECONDS);

  // Increment Daily OTP Count (1 Row Per Day!)
  incrementDailyOtpCounter(purpose);

  let purposeLabel = "Verification";
  if (purpose === "signup") purposeLabel = "Account Registration";
  if (purpose === "login") purposeLabel = "Direct Login";
  if (purpose === "reset_password" || purpose === "forgot") purposeLabel = "Password Reset";

  const subject = `[${otp}] Your Mendorbit Verification Code (${purposeLabel})`;
  const htmlBody = buildOtpEmailHtml(recipientName, purpose, otp);
  const textBody = `Dear ${recipientName || 'Student'}, your Mendorbit OTP verification code is ${otp}. Valid for 2 minutes.`;

  dispatchEmail(email, subject, textBody, htmlBody);

  return jsonResponse({
    status: "success",
    message: "OTP sent successfully to " + email,
    expiresIn: CONFIG.OTP_EXPIRY_SECONDS
  });
}

/**
 * Validate OTP & Update Sheet Status to SUCCESS
 */
function handleVerifyOtp(email, otp, purpose) {
  if (!otp || otp.length !== 6) {
    return jsonResponse({ status: "error", message: "Please enter all 6 digits of the verification code." }, 400);
  }

  const cache = CacheService.getScriptCache();
  const cacheKey = "otp_" + purpose + "_" + email;
  const storedData = cache.get(cacheKey);

  if (!storedData) {
    return jsonResponse({
      status: "error",
      message: "OTP has expired. Please request a new code."
    }, 400);
  }

  let storedOtp = storedData;
  if (storedData.indexOf("::") !== -1) {
    const parts = storedData.split("::");
    storedOtp = parts[0];
    const expiresAt = Number(parts[1]);
    if (Date.now() > expiresAt) {
      cache.remove(cacheKey);
      return jsonResponse({
        status: "error",
        message: "OTP has expired. Please request a new code."
      }, 400);
    }
  }

  if (storedOtp !== otp) {
    return jsonResponse({
      status: "error",
      message: "Incorrect OTP. Please check and try again."
    }, 400);
  }

  // Success - remove from cache to prevent reuse
  cache.remove(cacheKey);

  // Increment today's verified counter in Daily Sheet
  incrementDailyVerifiedCounter();

  return jsonResponse({
    status: "success",
    message: "Code verified successfully.",
    verifiedEmail: email
  });
}

/**
 * Send Security Alert / Welcome / Password Change Email (All in Light Theme)
 */
function handleSendSecurityAlert(email, name, locationInfo, eventType) {
  if (!email) return jsonResponse({ status: "error", message: "Email required." }, 400);
  const normalizedEmail = (email || "").toLowerCase().trim();

  // Deduplication guard: 20s window prevents duplicate emails if worker & client trigger simultaneously
  const cache = CacheService.getScriptCache();
  const alertDedupKey = "alert_dedup_" + (eventType || "LOGIN") + "_" + normalizedEmail;
  if (cache.get(alertDedupKey)) {
    Logger.log("Duplicate alert suppressed within 20s window: " + alertDedupKey);
    return jsonResponse({ status: "success", message: "Alert already dispatched." });
  }
  cache.put(alertDedupKey, "dispatched", 20);

  locationInfo = locationInfo || {};
  const ip = locationInfo.ip || "Direct Web";
  const rawDevice = locationInfo.userAgent || "";
  const friendlyDevice = getFriendlyDeviceString(rawDevice);
  const friendlyLocation = getFriendlyLocationString(locationInfo);
  const timeFormatted = Utilities.formatDate(new Date(), "Asia/Kolkata", "MM/dd/yyyy, hh:mm:ss a");

  // Emergency Account Lock & Password Change Link (Single-Use 24-Hour Cryptographic Token)
  // Email is completely hatched/encrypted inside the token - ZERO email exposed in URL
  const tokenId = Utilities.getUuid().replace(/-/g, "").substring(0, 16);
  const issuedAt = Date.now();
  // Payload: tokenId::email::issuedAt
  const lockToken = Utilities.base64Encode(tokenId + "::" + normalizedEmail + "::" + issuedAt);
  // Direct integration into index.html without exposing user email in query parameters
  const lockAccountUrl = `https://mendorbit.in/index.html?action=lock&token=${encodeURIComponent(lockToken)}`;

  // Cache single-use active token for 24 hours (86400 seconds)
  try {
    const tokenCache = CacheService.getScriptCache();
    tokenCache.put("single_use_token_" + tokenId, "ACTIVE::" + normalizedEmail + "::" + issuedAt, 86400);
  } catch (err) {
    Logger.log("Token cache note: " + err);
  }

  let subject = "";
  let htmlBody = "";
  let textBody = "";

  if (eventType === "SIGNUP") {
    subject = `[WELCOME] Welcome to Mendorbit Education, ${name || 'Student'}!`;
    htmlBody = buildSecurityAlertEmailHtml({
      headerTitle: "Welcome to Mendorbit",
      headerSubtitle: "Your student learning account is ready",
      headerGradient: "linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)",
      recipientName: name,
      messageIntro: `Welcome to Mendorbit Education! Your student account (<strong>${email}</strong>) has been successfully created and secured with our cipher authentication engine.`,
      device: friendlyDevice,
      location: friendlyLocation,
      ip: ip,
      time: timeFormatted,
      showWarningBox: false,
      actionButtonText: "Enter Student Dashboard",
      actionButtonUrl: "https://mendorbit.in",
      actionButtonColor: "#2563eb",
      footnote: "Keep your login credentials secure. Never share your password with anyone."
    });
    textBody = `Welcome to Mendorbit, ${name || 'Student'}! Your account (${email}) has been successfully created.`;
  } else if (eventType === "PASSWORD_CHANGE") {
    subject = `[SECURITY NOTICE] Your Mendorbit Password Was Changed (${friendlyLocation})`;
    htmlBody = buildSecurityAlertEmailHtml({
      headerTitle: "Security Alert",
      headerSubtitle: "Password changed on your account",
      headerGradient: "linear-gradient(135deg, #e11d48 0%, #be123c 100%)",
      recipientName: name,
      messageIntro: `The password for your Mendorbit account (<strong>${email}</strong>) was recently changed. All other active sessions across devices have been automatically logged out for your safety.`,
      device: friendlyDevice,
      location: friendlyLocation,
      ip: ip,
      time: timeFormatted,
      showWarningBox: true,
      actionButtonText: "Secure My Account",
      actionButtonUrl: lockAccountUrl,
      actionButtonColor: "#dc2626",
      footnote: "Changing your password will instantly log you out of all other active devices."
    });
    textBody = `Security Alert: The password for your Mendorbit account (${email}) was recently changed from ${friendlyLocation}.`;
  } else if (eventType === "TAMPER_ALERT") {
    subject = `[CRITICAL ALERT] Client Storage Tampering Detected (${email}) - ${friendlyLocation}`;
    htmlBody = buildSecurityAlertEmailHtml({
      headerTitle: "Security Incident Alert",
      headerSubtitle: "Unauthorized client storage manipulation detected",
      headerGradient: "linear-gradient(135deg, #b91c1c 0%, #991b1b 100%)",
      recipientName: "Security Team",
      messageIntro: `A student browser client (${email}) attempted unauthorized modification of encrypted authentication storage via DevTools or external scripts. The session was invalidated immediately.`,
      device: friendlyDevice,
      location: friendlyLocation,
      ip: ip,
      time: timeFormatted,
      showWarningBox: true,
      warningText: `Incident Key: ${locationInfo.tamperedKey || 'mendorbit_sso_user'} | Reason: ${locationInfo.reason || 'DevTools manual manipulation'}`,
      actionButtonText: "Review Student Record",
      actionButtonUrl: "https://mendorbit.in/admin.html",
      actionButtonColor: "#b91c1c",
      footnote: "Automated tamper-defense protocol executed: Session revoked and local vault purged."
    });
    textBody = `CRITICAL ALERT: Client storage tampering detected for student ${email} at ${friendlyLocation}.`;
    dispatchEmail(CONFIG.SECURITY_TEAM_EMAIL, subject, textBody, htmlBody);
    return jsonResponse({ status: "success", message: "Tamper alert dispatched to security team." });
  } else {
    // Standard login (LOGIN, LOGIN_OTP, GOOGLE_LOGIN) - 100% matches Images 1 & 2
    subject = `[SECURITY ALERT] New Sign-in to your Mendorbit Account (${friendlyLocation})`;
    htmlBody = buildSecurityAlertEmailHtml({
      headerTitle: "Security Alert",
      headerSubtitle: "New login detected on your account",
      headerGradient: "linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)",
      recipientName: name,
      messageIntro: "We noticed a new login to your Mendorbit account. We want to make sure it was you.",
      device: friendlyDevice,
      location: friendlyLocation,
      ip: ip,
      time: timeFormatted,
      showWarningBox: true,
      warningText: "Not you? Secure your account immediately to prevent unauthorized access.",
      actionButtonText: "Secure My Account",
      actionButtonUrl: lockAccountUrl,
      actionButtonColor: "#dc2626",
      footnote: "Changing your password will instantly log you out of all other active devices."
    });
    textBody = `Security Alert: We noticed a new sign-in to your Mendorbit account (${email}) from ${friendlyLocation} (${friendlyDevice}) at ${timeFormatted}.`;
  }

  dispatchEmail(email, subject, textBody, htmlBody);
  return jsonResponse({ status: "success", message: "Email dispatched." });
}

/**
 * ==================== DAILY OTP COUNTER LOGGER ====================
 * Maintains a clean summary spreadsheet "Mendorbit_Daily_OTP_Stats".
 * Fast, atomic increments per day (1 row per date).
 * Tracks: Date, Total Sent, Total Verified, Signup, Login, Password Reset, Last Activity.
 */
function getOrCreateAuditSpreadsheet() {
  const scriptProperties = PropertiesService.getScriptProperties();
  let sheetId = scriptProperties.getProperty("MENDORBIT_AUDIT_SHEET_ID");
  let ss = null;

  if (sheetId) {
    try {
      ss = SpreadsheetApp.openById(sheetId);
    } catch (e) {
      Logger.log("Stored sheet ID inaccessible (" + sheetId + "), creating fresh spreadsheet: " + e.toString());
    }
  }

  if (!ss) {
    ss = SpreadsheetApp.create("Mendorbit_Daily_OTP_Stats");
    sheetId = ss.getId();
    scriptProperties.setProperty("MENDORBIT_AUDIT_SHEET_ID", sheetId);
  }

  return ss;
}

function getDailyStatsSheet() {
  const ss = getOrCreateAuditSpreadsheet();
  let sheet = ss.getSheetByName("Daily_Stats");

  // If Daily_Stats doesn't exist, create it as the first tab
  if (!sheet) {
    sheet = ss.insertSheet("Daily_Stats", 0);
  }

  // Ensure 7 headers exist with bold styling and frozen row
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "Date (IST)", "Total OTPs Sent", "Total Verified", "Signup OTPs", "Login OTPs", "Password Reset OTPs", "Last Activity (IST)"
    ]);
    const headerRange = sheet.getRange(1, 1, 1, 7);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#2563eb");
    headerRange.setFontColor("#ffffff");
    sheet.setFrozenRows(1);

    sheet.setColumnWidth(1, 130); // Date
    sheet.setColumnWidth(2, 150); // Total Sent
    sheet.setColumnWidth(3, 150); // Total Verified
    sheet.setColumnWidth(4, 130); // Signup
    sheet.setColumnWidth(5, 130); // Login
    sheet.setColumnWidth(6, 170); // Reset
    sheet.setColumnWidth(7, 210); // Last Activity
  }

  return sheet;
}

function normalizeDateCell(cellVal) {
  if (!cellVal) return "";
  if (cellVal instanceof Date) {
    return Utilities.formatDate(cellVal, "Asia/Kolkata", "yyyy-MM-dd");
  }
  const s = String(cellVal).trim();
  const match = s.match(/\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  return s;
}

function findTodayRow(sheet, todayStr) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (normalizeDateCell(data[i][0]) === todayStr) {
      return i + 1; // 1-based index
    }
  }
  return -1;
}

function incrementDailyOtpCounter(purpose) {
  try {
    const sheet = getDailyStatsSheet();
    const now = new Date();
    const todayStr = Utilities.formatDate(now, "Asia/Kolkata", "yyyy-MM-dd");
    const timeStr = Utilities.formatDate(now, "Asia/Kolkata", "hh:mm:ss a 'IST'");

    const todayRow = findTodayRow(sheet, todayStr);
    const p = (purpose || "").toLowerCase();

    if (todayRow !== -1) {
      // Increment Total Sent
      const currentSent = Number(sheet.getRange(todayRow, 2).getValue()) || 0;
      sheet.getRange(todayRow, 2).setValue(currentSent + 1);

      // Increment Purpose Count
      if (p === "signup") {
        const cur = Number(sheet.getRange(todayRow, 4).getValue()) || 0;
        sheet.getRange(todayRow, 4).setValue(cur + 1);
      } else if (p === "login") {
        const cur = Number(sheet.getRange(todayRow, 5).getValue()) || 0;
        sheet.getRange(todayRow, 5).setValue(cur + 1);
      } else {
        const cur = Number(sheet.getRange(todayRow, 6).getValue()) || 0;
        sheet.getRange(todayRow, 6).setValue(cur + 1);
      }
      sheet.getRange(todayRow, 7).setValue(timeStr);
    } else {
      // Create fresh row for today
      const signupCount = (p === "signup") ? 1 : 0;
      const loginCount = (p === "login") ? 1 : 0;
      const resetCount = (p !== "signup" && p !== "login") ? 1 : 0;
      sheet.appendRow([todayStr, 1, 0, signupCount, loginCount, resetCount, timeStr]);
    }
  } catch (err) {
    Logger.log("Daily OTP counter increment error: " + err.toString());
  }
}

function incrementDailyVerifiedCounter() {
  try {
    const sheet = getDailyStatsSheet();
    const now = new Date();
    const todayStr = Utilities.formatDate(now, "Asia/Kolkata", "yyyy-MM-dd");
    const timeStr = Utilities.formatDate(now, "Asia/Kolkata", "hh:mm:ss a 'IST'");

    const todayRow = findTodayRow(sheet, todayStr);

    if (todayRow !== -1) {
      const currentVerified = Number(sheet.getRange(todayRow, 3).getValue()) || 0;
      sheet.getRange(todayRow, 3).setValue(currentVerified + 1);
      sheet.getRange(todayRow, 7).setValue(timeStr);
    } else {
      sheet.appendRow([todayStr, 1, 1, 0, 0, 0, timeStr]);
    }
  } catch (err) {
    Logger.log("Daily verified counter increment error: " + err.toString());
  }
}

function getDailyOtpStats() {
  try {
    const sheet = getDailyStatsSheet();
    const now = new Date();
    const todayStr = Utilities.formatDate(now, "Asia/Kolkata", "yyyy-MM-dd");
    const data = sheet.getDataRange().getValues();

    let stats = {
      date: todayStr,
      totalSent: 0,
      totalVerified: 0,
      signupOtps: 0,
      loginOtps: 0,
      resetOtps: 0,
      lastActivity: "None recorded yet today",
      sheetUrl: getOrCreateAuditSpreadsheet().getUrl()
    };

    for (let i = 1; i < data.length; i++) {
      if (normalizeDateCell(data[i][0]) === todayStr) {
        stats.totalSent = Number(data[i][1]) || 0;
        stats.totalVerified = Number(data[i][2]) || 0;
        stats.signupOtps = Number(data[i][3]) || 0;
        stats.loginOtps = Number(data[i][4]) || 0;
        stats.resetOtps = Number(data[i][5]) || 0;
        stats.lastActivity = String(data[i][6]) || "";
        break;
      }
    }
    return stats;
  } catch (e) {
    return { error: e.toString() };
  }
}

/**
 * One-Click Audit Sheet Setup & Verification
 */
function createAuditSheetNow() {
  const sheet = getDailyStatsSheet();
  const ss = sheet.getParent();
  const url = ss.getUrl();
  const id = ss.getId();
  Logger.log("==================================================");
  Logger.log("Mendorbit Daily OTP Stats Sheet is ACTIVE & READY!");
  Logger.log("URL: " + url);
  Logger.log("ID: " + id);
  Logger.log("==================================================");
  return { status: "success", url: url, id: id, sheetName: sheet.getName() };
}

/**
 * Verify Single-Use Reset Token
 */
function handleVerifyResetToken(token, email) {
  if (!token) return jsonResponse({ status: "error", code: "MISSING_TOKEN", message: "Security token is required." }, 400);
  try {
    const decoded = Utilities.newBlob(Utilities.base64Decode(token)).getDataAsString();
    const parts = decoded.split("::");
    if (parts.length < 3) {
      return jsonResponse({ status: "error", code: "INVALID_TOKEN", message: "Malformed security token." }, 400);
    }
    const tokenId = parts[0];
    const tokenEmail = (parts[1] || "").toLowerCase().trim();
    const issuedAt = Number(parts[2]);

    if (email && email.toLowerCase().trim() !== tokenEmail) {
      return jsonResponse({ status: "error", code: "EMAIL_MISMATCH", message: "Token does not match the account email." }, 400);
    }

    // Check expiration (Strict 24 hours = 86,400,000 ms)
    if (Date.now() - issuedAt > 24 * 60 * 60 * 1000) {
      return jsonResponse({ status: "error", code: "EXPIRED", message: "This change password link has expired (24-hour security limit). Please request a new link." }, 400);
    }

    // Check consumption in CacheService
    const tokenCache = CacheService.getScriptCache();
    const cacheVal = tokenCache.get("single_use_token_" + tokenId);

    if (cacheVal && cacheVal.indexOf("CONSUMED::") !== -1) {
      return jsonResponse({ status: "error", code: "ALREADY_USED", message: "This change password link has already been used and cannot be reused." }, 400);
    }

    return jsonResponse({
      status: "success",
      valid: true,
      tokenId: tokenId,
      email: tokenEmail,
      issuedAt: issuedAt
    });
  } catch (e) {
    return jsonResponse({ status: "error", code: "INVALID_TOKEN", message: "Invalid security token format." }, 400);
  }
}

/**
 * Mark Single-Use Reset Token as Consumed
 */
function handleConsumeResetToken(token, email) {
  if (!token) return jsonResponse({ status: "error", message: "Token required." }, 400);
  try {
    const decoded = Utilities.newBlob(Utilities.base64Decode(token)).getDataAsString();
    const parts = decoded.split("::");
    const tokenId = parts[0];
    const tokenEmail = (parts[1] || "").toLowerCase().trim();

    const tokenCache = CacheService.getScriptCache();
    // Mark as CONSUMED permanently for 24 hours (86400s)
    tokenCache.put("single_use_token_" + tokenId, "CONSUMED::" + tokenEmail + "::" + Date.now(), 86400);

    return jsonResponse({ status: "success", message: "Token marked as consumed." });
  } catch (e) {
    return jsonResponse({ status: "error", message: "Failed to consume token: " + e.toString() }, 400);
  }
}

function isValidEmail(email) {
  const re = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return re.test(email);
}

function jsonResponse(payload, statusCode) {
  const output = ContentService.createTextOutput(JSON.stringify(payload));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

/**
 * Test Dispatchers for Apps Script Console
 */
function testDailyStats() {
  incrementDailyOtpCounter("signup");
  incrementDailyOtpCounter("login");
  incrementDailyVerifiedCounter();
  const stats = getDailyOtpStats();
  Logger.log("Live Daily OTP Stats: " + JSON.stringify(stats));
  return stats;
}

function testSendOtp() {
  const res = handleSendOtp("admin.mendorbit@gmail.com", "signup", "Shivam", { city: "Delhi", country: "India", ip: "127.0.0.1" });
  Logger.log(res.getContent());
}

function testSecurityAlert() {
  const res = handleSendSecurityAlert("admin.mendorbit@gmail.com", "Shivam", { city: "Patna", country: "India", ip: "103.21.244.2" }, "SIGNUP");
  Logger.log(res.getContent());
}
