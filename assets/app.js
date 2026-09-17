/* Tools for Everyone, shared behaviour for the landing page and every tool page.
   Loaded with defer, so it runs after each page's own inline script has been
   parsed. Everything here is additive: no tool function is redefined. */

(function () {
  'use strict';

  var MOBILE = '(max-width: 900px)';

  /* ---------- Theme ---------- */

  function readStoredTheme() {
    try { return localStorage.getItem('theme'); } catch (e) { return null; }
  }

  function storeTheme(value) {
    try { localStorage.setItem('theme', value); } catch (e) { /* private mode */ }
  }

  function currentTheme() {
    var stored = readStoredTheme();
    if (stored === 'dark' || stored === 'light') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    updateToggleIcon(theme);
  }

  function updateToggleIcon(theme) {
    var btn = document.getElementById('themeToggle');
    if (!btn) return;
    btn.innerHTML = theme === 'dark'
      ? '<i class="ph ph-sun" aria-hidden="true"></i>'
      : '<i class="ph ph-moon" aria-hidden="true"></i>';
    btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  }

  function toggleTheme() {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    storeTheme(next);
    applyTheme(next);
  }

  function initTheme() {
    applyTheme(currentTheme());
    var btn = document.getElementById('themeToggle');
    if (btn) btn.addEventListener('click', toggleTheme);
  }

  /* ---------- Toast ---------- */

  var ICONS = {
    success: 'check-circle',
    error: 'warning-circle',
    info: 'info'
  };

  function showToast(message, kind) {
    var type = ICONS[kind] ? kind : 'info';
    var existing = document.querySelector('.toast');
    if (existing) existing.remove();

    var el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.setAttribute('role', 'status');

    var icon = document.createElement('i');
    icon.className = 'ph ph-' + ICONS[type];
    icon.setAttribute('aria-hidden', 'true');

    var text = document.createElement('span');
    text.textContent = message;

    el.appendChild(icon);
    el.appendChild(text);
    document.body.appendChild(el);

    setTimeout(function () {
      if (el.parentNode) el.remove();
    }, 2500);
  }

  /* ---------- Inline errors ---------- */

  function clearInlineErrors() {
    var nodes = document.querySelectorAll('.inline-error');
    for (var i = 0; i < nodes.length; i++) nodes[i].remove();
  }

  function showInlineError(anchorEl, message) {
    clearInlineErrors();
    if (!anchorEl || !anchorEl.parentNode) {
      showToast(message, 'error');
      return;
    }
    var el = document.createElement('div');
    el.className = 'error-msg inline-error';
    el.setAttribute('role', 'alert');

    var icon = document.createElement('i');
    icon.className = 'ph ph-warning-circle';
    icon.setAttribute('aria-hidden', 'true');

    var text = document.createElement('span');
    text.textContent = message;

    el.appendChild(icon);
    el.appendChild(text);
    anchorEl.insertAdjacentElement('afterend', el);
  }

  /* ---------- Busy buttons ---------- */

  function setBusy(buttonEl, isBusy, label) {
    if (!buttonEl) return;
    if (isBusy) {
      if (buttonEl.dataset.idleHtml === undefined) buttonEl.dataset.idleHtml = buttonEl.innerHTML;
      buttonEl.disabled = true;
      buttonEl.setAttribute('aria-busy', 'true');
      buttonEl.innerHTML = '<span class="spinner" aria-hidden="true"></span> ';
      buttonEl.appendChild(document.createTextNode(label || 'Working...'));
    } else {
      buttonEl.disabled = false;
      buttonEl.removeAttribute('aria-busy');
      if (buttonEl.dataset.idleHtml !== undefined) {
        buttonEl.innerHTML = buttonEl.dataset.idleHtml;
        delete buttonEl.dataset.idleHtml;
      }
    }
  }

  /* ---------- Progress bar ---------- */

  function setProgress(containerEl, percent, label) {
    if (!containerEl) return;
    var pct = Math.max(0, Math.min(100, Math.round(percent)));
    var bar = containerEl.querySelector('.progress');
    if (!bar) {
      containerEl.innerHTML =
        '<div class="progress">' +
          '<div class="progress-track"><div class="progress-fill"></div></div>' +
          '<div class="progress-label"><span class="text"></span><span class="pct"></span></div>' +
        '</div>';
      bar = containerEl.querySelector('.progress');
    }
    bar.querySelector('.progress-fill').style.width = pct + '%';
    bar.querySelector('.text').textContent = label || '';
    bar.querySelector('.pct').textContent = pct + '%';
  }

  function clearProgress(containerEl) {
    if (containerEl) containerEl.innerHTML = '';
  }

  /* ---------- Share ---------- */

  function sharePage() {
    var data = {
      title: document.title,
      text: 'Free browser tools that never upload your files.',
      url: location.href
    };
    if (navigator.share) {
      navigator.share(data).catch(function () {});
      return;
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(location.href).then(function () {
        showToast('Link copied to clipboard', 'success');
      }).catch(function () {
        showToast('Could not copy the link', 'error');
      });
      return;
    }
    showToast('Copy this page address to share it', 'info');
  }

  /* ---------- Drop zones ---------- */

  function initDropZoneKeys() {
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      var zone = e.target.closest ? e.target.closest('.drop-zone') : null;
      if (!zone) return;
      e.preventDefault();
      zone.click();
    });
  }

  /* ---------- Control panels on small screens ---------- */

  function syncPanels() {
    var panels = document.querySelectorAll('details.panel[data-mobile-collapsed]');
    var isMobile = window.matchMedia(MOBILE).matches;
    for (var i = 0; i < panels.length; i++) {
      if (isMobile) panels[i].removeAttribute('open');
      else panels[i].setAttribute('open', '');
    }
  }

  function initPanels() {
    syncPanels();
    var mq = window.matchMedia(MOBILE);
    var handler = function () { syncPanels(); };
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else if (mq.addListener) mq.addListener(handler);
  }

  /* ---------- Install as an app ---------- */

  /* Browsers keep the install option buried in a menu, so the button below only
     appears once the browser has told us the site actually qualifies. Safari fires
     nothing and installs through its own share sheet, so the button stays hidden
     there rather than promising something that will not happen. */
  function initInstall() {
    var btn = document.getElementById('installApp');
    if (!btn) return;
    var deferredPrompt = null;

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
      btn.classList.remove('hidden');
    });

    btn.addEventListener('click', function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function () {
        deferredPrompt = null;
        btn.classList.add('hidden');
      }).catch(function () {});
    });

    window.addEventListener('appinstalled', function () {
      deferredPrompt = null;
      btn.classList.add('hidden');
    });
  }

  /* ---------- Service worker ---------- */

  function initServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    var path = document.body.dataset.swPath;
    if (!path) return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register(path).catch(function () {});
    });
  }

  /* ---------- Exports ---------- */

  window.showToast = showToast;
  window.showInlineError = showInlineError;
  window.clearInlineErrors = clearInlineErrors;
  window.setBusy = setBusy;
  window.setProgress = setProgress;
  window.clearProgress = clearProgress;
  window.sharePage = sharePage;
  /* Kept so any older inline handler still resolves. */
  window.shareThisTool = sharePage;
  window.shareThisPage = sharePage;

  /* Clearing runs in the capture phase, so an inline error raised by the click
     that follows is not wiped by its own event. */
  document.addEventListener('click', clearInlineErrors, true);

  initTheme();
  initDropZoneKeys();
  initPanels();
  initInstall();
  initServiceWorker();
})();
