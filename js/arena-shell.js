// Arena: tabs, toasts, test mode and resetting the data.
/* global CONFIG, State, plural, localIsoDate, Arena */

Object.assign(Arena, {
  // ─────────────────────────────────────────────────────────────
  // NAVIGATION & TEST MODE
  // ─────────────────────────────────────────────────────────────
  activateTab(pageId) {
    const ids = ['pg-decks', 'pg-detail', 'pg-logger', 'pg-history'];
    const titles = ['Comparador de mazos', 'Detalle por mazo', 'Registrar torneo', 'Historial'];
    const at = ids.indexOf(pageId);
    if (at >= 0) {
      const h = document.getElementById('page-title');
      if (h) h.textContent = titles[at];
      document.title = titles[at] + ' · Pauper Deck Arena';
    }
    document.querySelectorAll('.js-tab-panel').forEach(p => p.classList.toggle('is-active', p.id === pageId));
    document.querySelectorAll('.js-nav-link').forEach((b, i) => {
      if (ids[i] === pageId) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
  },

  switchTab(pageId, btnEl) {
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
    const tabs = ['decks', 'detail', 'logger', 'history'];
    document.querySelectorAll('.js-nav-link').forEach((a, i) => {
      const p = new URLSearchParams();
      p.set('tab', tabs[i]);
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
    clearTimeout(this._toastTimer);
    // A toast with an action stays long enough to be read and used.
    this._toastTimer = setTimeout(() => this.hideToast(), opts.action ? 10000 : 4500);
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
      if (e.key === "Enter" && e.target.matches('input:not([type="file"])')) {
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

    if (CONFIG.isTestMode) {
      if (banner) banner.style.display = 'block';
      State.resetToDefaults();
      State.loadSeasonEnds();
      State.save();
      // The history that ships with the app belongs to season 2026-1: show every season so the page is not empty.
      this._seasonBeforeTest = this.currentFilterSeason;
      if (sel && this.currentFilterSeason !== 'all') { sel.value = 'all'; this.handleSeasonFilterChange(); }
      State.writeFailed = false; // test data is throwaway: a refused write here must not colour the next real save
      this.toast("Modo de prueba activado. Ves el historial inicial incluido con la app; tus datos reales no se tocan.");
    } else {
      if (banner) banner.style.display = 'none';
      localStorage.removeItem('pauper_test_arena_historic');
      State.load();
      if (sel && this._seasonBeforeTest && sel.value !== this._seasonBeforeTest) { sel.value = this._seasonBeforeTest; this.handleSeasonFilterChange(); }
      this._seasonBeforeTest = null;
      this.toast("Modo de prueba desactivado. Vuelven tus datos reales.");
    }
    this.populateDeckPickers();
    this.refreshAll();
  },

  async resetToDefaultsConfirm() {
    const ok = await this.confirmDialog({
      title: "Restablecer a los datos iniciales",
      body: `Tu historial actual (${plural(State.historic.length, 'torneo', 'torneos')}) se reemplazará por el que viene incluido con la app (temporada 2026-1). Podrás deshacerlo unos segundos después.`,
      confirmLabel: "Restablecer datos"
    });
    if (!ok) return;
    const before = this.snapshot();
    State.resetToDefaults();
    State.save();
    this.populateDeckPickers();
    this.refreshAll();
    this.notify("Datos restablecidos al historial inicial.", {
      action: { label: 'Deshacer', run: () => { this.restoreSnapshot(before); this.notify('Tus datos volvieron a como estaban.'); } }
    });
  },
});
