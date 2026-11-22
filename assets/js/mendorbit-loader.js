/**
 * MENDORBIT UNIVERSAL DOT-CIRCLE LOADER
 * Provides a sleek dimmed backdrop, rotating dot-circle SVG spinner,
 * and a 5.5s timeout detector that explains slow network/server issues
 * with a "Dismiss & Continue" button so the user is never stuck.
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MendorbitLoader = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  let overlayEl = null;
  let titleEl = null;
  let subtitleEl = null;
  let delayBoxEl = null;
  let delayReasonEl = null;
  let dismissBtnEl = null;
  let delayTimer = null;
  let safetyTimer = null;
  let currentOptions = {};

  function injectDOM() {
    if (document.getElementById('mendorbit-global-loader')) {
      overlayEl = document.getElementById('mendorbit-global-loader');
      titleEl = document.getElementById('loader-title');
      subtitleEl = document.getElementById('loader-subtitle');
      delayBoxEl = document.getElementById('loader-delay-box');
      delayReasonEl = document.getElementById('loader-delay-reason');
      dismissBtnEl = document.getElementById('btn-loader-dismiss');
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.id = 'mendorbit-global-loader';
    wrapper.className = 'fixed inset-0 z-[99999] flex items-center justify-center bg-slate-950/50 backdrop-blur-md transition-all duration-300 opacity-0 pointer-events-none select-none';
    wrapper.style.display = 'none';

    wrapper.innerHTML = `
      <div id="mendorbit-loader-card" class="relative w-full max-w-sm mx-4 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200/90 dark:border-slate-800 rounded-3xl p-6 sm:p-7 shadow-2xl text-center transform scale-95 transition-all duration-300">
        
        <!-- Rotating Dot Circle Spinner (Vedantu / SaaS Grade) -->
        <div class="flex items-center justify-center mb-4">
          <div class="relative w-16 h-16 flex items-center justify-center">
            <svg class="w-14 h-14 text-orange-500 animate-spin" style="animation-duration: 0.85s;" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="6" r="3.5" fill="currentColor" fill-opacity="1"/>
              <circle cx="36.7" cy="11.3" r="3.5" fill="currentColor" fill-opacity="0.87"/>
              <circle cx="42" cy="24" r="3.5" fill="currentColor" fill-opacity="0.75"/>
              <circle cx="36.7" cy="36.7" r="3.5" fill="currentColor" fill-opacity="0.62"/>
              <circle cx="24" cy="42" r="3.5" fill="currentColor" fill-opacity="0.5"/>
              <circle cx="11.3" cy="36.7" r="3.5" fill="currentColor" fill-opacity="0.37"/>
              <circle cx="6" cy="24" r="3.5" fill="currentColor" fill-opacity="0.25"/>
              <circle cx="11.3" cy="11.3" r="3.5" fill="currentColor" fill-opacity="0.12"/>
            </svg>
            <div class="absolute w-3.5 h-3.5 rounded-full bg-gradient-to-tr from-blue-600 via-indigo-600 to-orange-500 animate-pulse shadow-sm"></div>
          </div>
        </div>

        <!-- Title & Subtitle -->
        <h3 id="loader-title" class="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight">Please wait...</h3>
        <p id="loader-subtitle" class="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed font-medium">Securing communication with Mendorbit servers.</p>

        <!-- Delay Explanation Box (Triggered at 5.5 seconds) -->
        <div id="loader-delay-box" class="hidden mt-4 p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 text-left transition-all">
          <div class="flex items-start gap-2.5">
            <svg class="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div class="flex-1">
              <h4 class="text-xs font-bold text-amber-900 dark:text-amber-300">Taking longer than usual...</h4>
              <p id="loader-delay-reason" class="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5 leading-relaxed font-medium">
                Internet response is slow or remote server is processing your request. Please wait or dismiss.
              </p>
            </div>
          </div>
          <div class="mt-3 flex items-center justify-end gap-2">
            <button type="button" id="btn-loader-dismiss" class="px-3.5 py-1.5 rounded-xl bg-amber-200/80 dark:bg-amber-900/60 hover:bg-amber-300 dark:hover:bg-amber-800 text-amber-950 dark:text-amber-100 text-xs font-bold transition shadow-sm">
              Dismiss & Continue
            </button>
          </div>
        </div>

      </div>
    `;

    document.body.appendChild(wrapper);

    overlayEl = wrapper;
    titleEl = wrapper.querySelector('#loader-title');
    subtitleEl = wrapper.querySelector('#loader-subtitle');
    delayBoxEl = wrapper.querySelector('#loader-delay-box');
    delayReasonEl = wrapper.querySelector('#loader-delay-reason');
    dismissBtnEl = wrapper.querySelector('#btn-loader-dismiss');

    dismissBtnEl.addEventListener('click', () => {
      hide();
      if (typeof currentOptions.onDismiss === 'function') {
        currentOptions.onDismiss();
      }
    });
  }

  function show(title = "Please wait...", subtitle = "Communicating securely with Mendorbit servers...", options = {}) {
    currentOptions = options || {};
    if (!overlayEl) {
      if (document.body) {
        injectDOM();
      } else {
        document.addEventListener('DOMContentLoaded', () => {
          injectDOM();
          show(title, subtitle, options);
        });
        return;
      }
    }

    clearTimeout(delayTimer);
    clearTimeout(safetyTimer);

    if (titleEl) titleEl.textContent = title;
    if (subtitleEl) subtitleEl.textContent = subtitle;
    if (delayBoxEl) delayBoxEl.classList.add('hidden');

    overlayEl.style.display = 'flex';
    // Trigger transition
    requestAnimationFrame(() => {
      overlayEl.classList.remove('opacity-0', 'pointer-events-none');
      const card = overlayEl.querySelector('#mendorbit-loader-card');
      if (card) card.classList.remove('scale-95');
    });

    // 1. After 5.5 seconds, if still running, reveal "Taking longer than usual" warning box
    delayTimer = setTimeout(() => {
      if (!overlayEl.classList.contains('opacity-0') && delayBoxEl) {
        delayBoxEl.classList.remove('hidden');
        if (delayReasonEl) {
          if (!navigator.onLine) {
            delayReasonEl.textContent = "Your device appears to be offline. Please verify your internet/WiFi connection.";
          } else if (currentOptions.reason) {
            delayReasonEl.textContent = currentOptions.reason;
          } else {
            delayReasonEl.textContent = "Your network is experiencing latency or server is handling high traffic. You can wait or dismiss.";
          }
        }
      }
    }, 5500);

    // 2. Safety Timeout: After 15 seconds, auto-dismiss to prevent getting permanently stuck
    safetyTimer = setTimeout(() => {
      if (!overlayEl.classList.contains('opacity-0')) {
        console.warn("[MendorbitLoader] Safety timeout fired (15s). Automatically releasing UI.");
        hide();
        if (typeof currentOptions.onTimeout === 'function') {
          currentOptions.onTimeout();
        }
      }
    }, 15000);
  }

  function hide() {
    clearTimeout(delayTimer);
    clearTimeout(safetyTimer);
    if (!overlayEl) return;

    overlayEl.classList.add('opacity-0', 'pointer-events-none');
    const card = overlayEl.querySelector('#mendorbit-loader-card');
    if (card) card.classList.add('scale-95');

    setTimeout(() => {
      if (overlayEl.classList.contains('opacity-0')) {
        overlayEl.style.display = 'none';
        if (delayBoxEl) delayBoxEl.classList.add('hidden');
      }
    }, 300);
  }

  function isShowing() {
    return overlayEl && !overlayEl.classList.contains('opacity-0');
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectDOM);
    } else {
      injectDOM();
    }
  }

  return { show, hide, isShowing };
}));
