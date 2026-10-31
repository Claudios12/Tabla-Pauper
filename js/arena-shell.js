// Arena: tabs, toasts, test mode and resetting the data.
/* global CONFIG, State, plural, localIsoDate, Arena */

Object.assign(Arena, {
  // ─────────────────────────────────────────────────────────────
  // NAVIGATION & TEST MODE
  // ─────────────────────────────────────────────────────────────
  activateTab(pageId) {
    const tab = this.TABS.find(t => t.id === pageId);
    if (tab) {
      const h = document.getElementById('page-title');
      if (h) h.textContent = tab.title;
      document.title = tab.title + ' · Pauper Deck Arena';
    }
    document.querySelectorAll('.js-tab-panel').forEach(p => p.classList.toggle('is-active', p.id === pageId));
    document.querySelectorAll('.js-nav-link').forEach(b => {
      if (tab && b.dataset.tab === tab.slug) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    // The General tab is only built while it is shown (see renderLeague).
    if (pageId === 'pg-league' && State.historic) this.renderLeague();
  },

  switchTab(pageId) {
    this.activateTab(pageId);
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    const params = new URLSearchParams(window.location.hash.slice(1));
    params.set('tab', pageId.replace('pg-', ''));
    if (this.currentFilterSeason === 'all') { params.delete('season'); }
    else { params.set('season', this.currentFilterSeason); }
    history.replaceState(null, '', '#' + params.toString());
    this.updateNavLinks();
    this.renderPointsChart();
    const heading = document.getElementById('page-title');
    if (heading) heading.focus({ preventScroll: true });
  },

  // Tab links keep working when opened in a new tab: they carry the tab and the season.
  updateNavLinks() {
    document.querySelectorAll('.js-nav-link').forEach(a => {
      const p = new URLSearchParams();
      p.set('tab', a.dataset.tab);
      if (this.currentFilterSeason !== 'all') p.set('season', this.currentFilterSeason);
      a.setAttribute('href', '#' + p.toString());
    });
  },

  toast(message, opts = {}) {
    const el = document.getElementById("toast");
    const text = document.getElementById("toast-text");
    const btn = document.getElementById("toast-action");
    if (!el || !text || !btn) return;
    text.textContent = message;
    if (opts.action) {
      btn.textContent = opts.action.label;
      btn.hidden = false;
      btn.onclick = () => { this.hideToast(); opts.action.run(); };
    } else {
      btn.hidden = true;
      btn.onclick = null;
    }
    el.classList.add('show');
    // A toast with an action stays long enough to be read and used.
    this._toastLife = opts.action ? 10000 : 4500;
    this.armToast(this._toastLife);
    // While the pointer rests on it or focus is inside it, it stays: the time to reach "Deshacer" is the person's, not the clock's.
    if (!el.dataset.pausable) {
      el.dataset.pausable = 'true';
      ['mouseenter', 'focusin'].forEach(type => el.addEventListener(type, () => clearTimeout(this._toastTimer)));
      ['mouseleave', 'focusout'].forEach(type => el.addEventListener(type, () => this.armToast(this._toastLife / 2)));
    }
  },

  armToast(ms) {
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.hideToast(), ms);
  },

  hideToast() {
    const el = document.getElementById("toast");
    const btn = document.getElementById("toast-action");
    if (el) el.classList.remove('show');
    if (btn) btn.hidden = true;
  },

  // The confirmation for a change that was just saved. If the browser refused the write, the change lives
  // only in this window, so say that instead. Undo stays when there is one; otherwise offer to export.
  notify(message, opts = {}) {
    if (!State.writeFailed) { this.toast(message, opts); return; }
    State.writeFailed = false;
    this.toast('No se pudo guardar en este dispositivo: el cambio se perderá al cerrar la app. Exporta una copia desde Historial para conservarlo.', {
      action: opts.action || { label: 'Exportar copia', run: () => this.exportJSON() }
    });
  },

  // Stored data the app could not read was set aside before starting over; offer it back as a file.
  offerUnreadableCopy() {
    const raw = State.unreadableCopy();
    if (!raw) return;
    this.toast('No se pudieron leer tus datos guardados. La app empezó con el historial inicial y apartó una copia de lo que había.', {
      action: { label: 'Descargar copia', run: () => this.downloadUnreadableCopy(raw) }
    });
  },

  downloadUnreadableCopy(raw) {
    this.saveAsFile(raw, `pauper_decks_unreadable_${localIsoDate()}.json`);
    State.discardUnreadable();
    this.toast('Copia descargada. Puedes revisarla o enviarla para recuperar lo que se pueda.');
  },

  // Hands text to the browser as a file download.
  saveAsFile(text, fileName) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  // Shell wiring: where the nav lives in the DOM, short season labels, Enter-to-save.
  bindShell() {
    const nav = document.querySelector(".js-nav");
    const inner = document.querySelector(".js-topbar-inner");
    const scope = document.querySelector(".js-season-scope");
    const desktop = window.matchMedia("(min-width: 1024px)");
    // Phones: the bar sits after the content in the DOM, so Tab reaches the page before the bar.
    // Desktop: the same element sits in the top bar, between the brand and the season scope.
    const place = () => {
      if (!nav || !inner || !scope) return;
      if (desktop.matches) { if (nav.parentElement !== inner) inner.insertBefore(nav, scope); }
      else if (nav.parentElement === inner) document.getElementById("main-content").after(nav);
    };
    place();
    desktop.addEventListener("change", place);
    const dataPanel = document.getElementById("data-panel");
    if (dataPanel && desktop.matches) dataPanel.open = true;

    window.matchMedia("(max-width: 480px)").addEventListener("change", () => this.labelSeasonOptions());

    const logger = document.getElementById("pg-logger");
    if (logger) logger.addEventListener("keydown", (e) => {
      // Enter in the review list only commits the value being typed there; it must not save the tournament.
      if (e.key === "Enter" && e.target.matches('input:not([type="file"]):not(.ocr-input)')) {
        e.preventDefault();
        this.saveManualTournament();
      }
    });
  },

  toggleTestMode() {
    const toggle = document.getElementById("test-mode-toggle");
    const banner = document.getElementById("test-mode-banner");
    const sel = document.getElementById("season-filter");
    CONFIG.isTestMode = toggle ? toggle.checked : false;
    document.documentElement.classList.toggle('is-demo', CONFIG.isTestMode);

    if (CONFIG.isTestMode) {
      if (banner) banner.style.display = 'block';
      State.loadDemo();
      // The sample's eight league nights can reach back into the previous season: show every season so the page is not empty.
      this._seasonBeforeTest = this.currentFilterSeason;
      if (sel && this.currentFilterSeason !== 'all') { sel.value = 'all'; this.handleSeasonFilterChange(); }
      State.writeFailed = false; // test data is throwaway: a refused write here must not colour the next real save
      this.toast("Modo de prueba activado. Ves una liga de ejemplo inventada; tus datos reales no se tocan.");
    } else {
      if (banner) banner.style.display = 'none';
      State.clearTestData();
      State.load();
      if (sel && this._seasonBeforeTest && sel.value !== this._seasonBeforeTest) { sel.value = this._seasonBeforeTest; this.handleSeasonFilterChange(); }
      this._seasonBeforeTest = null;
      this.toast("Modo de prueba desactivado. Vuelven tus datos reales.");
    }
    // A month table read from a picture was set against the other league's nights: it goes with them, and so does a reading under way.
    this.dropMonth();
    this.populateDeckPickers();
    this.refreshAll();
  },

  // Leaves the app as if it had just been opened for the first time.
  async wipeAllConfirm() {
    const ok = await this.confirmDialog({
      title: "Borrar todos mis datos",
      body: `Se borran de este dispositivo tus ${plural(State.historic.length, 'torneo', 'torneos')}, tus mazos, las fechas de temporada, tu nombre y el día de tu liga. Exporta una copia antes si quieres conservarlos. Podrás deshacerlo unos segundos después.`,
      confirmLabel: "Borrar datos"
    });
    if (!ok) return;
    const before = this.snapshot();
    State.wipeAll();
    this.dropMonth();
    this.populateDeckPickers();
    this.refreshAll();
    this.notify("Datos borrados: la app quedó como recién abierta.", {
      action: { label: 'Deshacer', run: () => { this.restoreSnapshot(before); this.notify('Tus datos volvieron a como estaban.'); } }
    });
  },
});
