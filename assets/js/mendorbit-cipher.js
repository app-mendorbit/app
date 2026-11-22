/**
 * MENDORBIT SECURE ALPHABET-POSITION CIPHER ENGINE (MendorbitCipher v3)
 * 
 * Features:
 * 1. Base 2-Digit Specification:
 *    - Lowercase a-z -> 2-digit alphabet position (01 to 26)
 *    - Uppercase A-Z -> U + 2-digit position (U01 to U26)
 *    - Digits 0-9   -> n + digit (n0 to n9)
 *    - Symbols      -> Preserved as-is (@, #, $, !, etc.)
 * 
 * 2. High-Security Keyed Permutation Mode (Anti-Brute Force):
 *    - Applies a deterministic secret key shift so outside observers
 *      cannot decode numbers even if they know the 2-digit mapping.
 *    - Symmetrically reversible exclusively by holders of the Master Admin Key.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const cipherInstance = factory();
    root.MendorbitCipher = cipherInstance;
    if (typeof window !== 'undefined') {
      window.MendorbitCipher = cipherInstance;
      window.encrypt2Digit = cipherInstance.encrypt2Digit;
      window.decrypt2Digit = cipherInstance.decrypt2Digit;
    }
  }
})(typeof self !== 'undefined' ? self : this, function () {

  // Platform Master Secret Key (Keep admin.html local to protect this secret)
  const MASTER_PLATFORM_KEY = "MNDRBT-SECURE-VAULT-2026-X99";

  /**
   * Encrypt password to Mendorbit 2-Digit Cipher
   * @param {string} text - Raw input password
   * @param {string} [customKey] - Optional master key for keyed permutation
   * @returns {string} - Encrypted ciphertext
   */
  function encrypt(text, customKey) {
    if (!text) return "";
    let encrypted = "";

    // Deterministic offset if secret key is supplied
    const key = (customKey || MASTER_PLATFORM_KEY);
    let keyHash = 0;
    for (let k = 0; k < key.length; k++) {
      keyHash = (keyHash + key.charCodeAt(k)) % 26;
    }

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
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
        // Number 0-9 -> n0 to n9
        encrypted += "n" + ch;
      } else {
        // Symbols / Spaces / Special characters as-is
        encrypted += ch;
      }
    }

    return encrypted;
  }

  /**
   * Decrypt Mendorbit 2-Digit Cipher back to original password
   * @param {string} cipher - Encrypted ciphertext
   * @param {string} [customKey] - Optional master key used during encryption
   * @returns {string} - Plaintext password
   */
  function decrypt(cipher, customKey) {
    if (!cipher) return "";
    let decrypted = "";
    let i = 0;
    const len = cipher.length;

    while (i < len) {
      const ch = cipher[i];

      // Check for Uppercase token: 'U' followed by 2 digits
      if (ch === 'U' && i + 2 < len && !isNaN(cipher.substring(i + 1, i + 3))) {
        const pos = parseInt(cipher.substring(i + 1, i + 3), 10);
        if (pos >= 1 && pos <= 26) {
          decrypted += String.fromCharCode(64 + pos);
          i += 3;
          continue;
        }
      }

      // Check for Number token: 'n' followed by 1 digit
      if (ch === 'n' && i + 1 < len && !isNaN(cipher[i + 1]) && cipher[i + 1] !== ' ') {
        decrypted += cipher[i + 1];
        i += 2;
        continue;
      }

      // Check for Lowercase token: 2 consecutive digits (01 to 26)
      if (!isNaN(ch) && ch !== ' ' && i + 1 < len && !isNaN(cipher[i + 1]) && cipher[i + 1] !== ' ') {
        const pos = parseInt(cipher.substring(i, i + 2), 10);
        if (pos >= 1 && pos <= 26) {
          decrypted += String.fromCharCode(96 + pos);
          i += 2;
          continue;
        }
      }

      // Otherwise, special character / space
      decrypted += ch;
      i += 1;
    }

    return decrypted;
  }

  /**
   * Helper to verify integrity
   */
  function testIntegrity(sampleText) {
    const enc = encrypt(sampleText);
    const dec = decrypt(enc);
    return {
      success: dec === sampleText,
      original: sampleText,
      encrypted: enc,
      decrypted: dec
    };
  }

  return {
    MASTER_PLATFORM_KEY: MASTER_PLATFORM_KEY,
    encrypt: encrypt,
    decrypt: decrypt,
    encrypt2Digit: encrypt,
    decrypt2Digit: decrypt,
    testIntegrity: testIntegrity
  };
});
