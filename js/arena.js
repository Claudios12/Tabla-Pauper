// The screen controller (Arena): start-up, season picker, deck pickers and cross-window sync.
/* global CONFIG, State, Analytics, deckInfo, deckNameWithColours, SEASON_FORMAT, ResizeObserver */
/* exported Arena */

// ══════════════════════════════════════════════════════════════════
// UI CONTROLLER & RENDERING
// ══════════════════════════════════════════════════════════════════
const Arena = {
  currentFilterSeason: CONFIG.CURRENT_SEASON,
  historyDeck: 'all',
  // The tabs in the order of the nav. The slug is what #tab= carries and what the nav link is tagged with.
  TABS: [
    { id: 'pg-decks', slug: 'decks', title: 'Comparador de mazos' },
    { id: 'pg-league', slug: 'league', title: 'General de la liga' },
    { id: 'pg-detail', slug: 'detail', title: 'Detalle por mazo' },
    { id: 'pg-logger', slug: 'logger', title: 'Registrar torneo' },
    { id: 'pg-history', slug: 'history', title: 'Historial' }
  ],

  init() {
    State.load();
    const params = new URLSearchParams(window.location.hash.slice(1));
    const seasonParam = params.get('season');
    const tabParam = params.get('tab');
    if (params.get('deck')) this.historyDeck = params.get('deck');
    // A link can only pick a season the app knows; anything else keeps today's season.
    if (seasonParam === 'all' || this.knownSeasons().has(seasonParam)) this.currentFilterSeason = seasonParam;
    const linked = this.TABS.find(tab => tab.slug === tabParam);
    if (linked) this.activateTab(linked.id);
    this.initDatePicker();
    this.populateDeckPickers();
    this.refreshAll();
    this.updateNavLinks();
    const form = document.getElementById('pg-logger');
    if (form) {
      // The list that says where a scanned table goes is read when it changes: a redraw on its "input" event would put the old choice back first.
      form.addEventListener('input', (e) => { if (e.target.id !== 'ocr-target') this.renderLogPreview(); });
      form.addEventListener('change', () => this.renderLogPreview());
    }
    const wrap = document.getElementById('points-chart');
    if ('ResizeObserver' in window && wrap) new ResizeObserver(() => this.renderPointsChart()).observe(wrap);
    else window.addEventListener('resize', () => this.renderPointsChart());
    this.bindShell();
    window.addEventListener('storage', (e) => this.onStorageChange(e));
    this.offerUnreadableCopy();
  },

  // Another window saved: take in what it stored, or this one would overwrite it on its next save.
  onStorageChange(e) {
    if (e.storageArea !== localStorage) return;
    if (e.key !== null && ![State.historicKey(), State.storeNightsKey(), State.deletedKey(), State.seasonEndsKey(), State.seasonTopKey(), State.profileKey()].includes(e.key)) return;
    clearTimeout(this._syncTimer);
    this._syncTimer = setTimeout(() => this.syncFromStorage(), 50);
  },

  syncFromStorage() {
    State.load();
    this.populateDeckPickers();
    this.refreshAll();
    // Replaces any toast, so an Undo from before the change cannot bring old data back.
    this.toast('Otra ventana cambió tus datos. Esta ya muestra la versión más reciente.');
  },

  initDatePicker() {
    const dateInput = document.getElementById("log-date");
    if (dateInput) {
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      dateInput.value = `${yyyy}-${mm}-${dd}`;
      dateInput.max = `${yyyy}-${mm}-${dd}`;
    }
  },

  getFilteredEntries() {
    if (this.currentFilterSeason === 'all') {
      return State.historic;
    }
    return State.historic.filter(item => item.season === this.currentFilterSeason);
  },

  // Today's season plus every well-formed season found in the data. Anything else a backup carries
  // in its season field is never offered, so it cannot become the active filter or end up in the URL.
  knownSeasons() {
    return new Set([CONFIG.CURRENT_SEASON, ...State.historic.map(item => item.season)].filter(s => SEASON_FORMAT.test(s)));
  },

  // The picker lists "all" and each known season, newest first; the one on screen stays listed even when empty.
  populateSeasonFilter() {
    const select = document.getElementById("season-filter");
    if (!select) return;
    const seasons = this.knownSeasons();
    if (this.currentFilterSeason !== 'all') seasons.add(this.currentFilterSeason);
    const list = [...seasons].sort().reverse();
    if (this._seasonList !== list.join()) {
      select.querySelectorAll('option:not([value="all"])').forEach(o => o.remove());
      list.forEach(season => {
        const option = document.createElement("option");
        option.value = season;
        option.dataset.full = `Temporada ${season}`;
        option.dataset.short = `Temp. ${season}`;
        select.append(option);
      });
      this._seasonList = list.join();
      this.labelSeasonOptions();
    }
    select.value = this.currentFilterSeason;
  },

  // Phones get the short label so the picker fits beside the brand.
  labelSeasonOptions() {
    const narrow = window.matchMedia("(max-width: 480px)").matches;
    document.querySelectorAll("#season-filter option").forEach(o => {
      o.textContent = narrow ? o.dataset.short : o.dataset.full;
    });
  },

  handleSeasonFilterChange() {
    const select = document.getElementById("season-filter");
    if (select) {
      this.currentFilterSeason = select.value;
      this.refreshAll();
      const params = new URLSearchParams(window.location.hash.slice(1));
      if (this.currentFilterSeason === 'all') { params.delete('season'); }
      else { params.set('season', this.currentFilterSeason); }
      history.replaceState(null, '', '#' + params.toString());
      this.updateNavLinks();
    }
  },

  refreshAll() {
    this.populateSeasonFilter();
    this.renderWelcome();
    this.renderLeagueSettings();
    this.renderHeroMetrics();
    this.renderInsights();
    this.renderDeckComparison();
    this.renderLeague();
    this.renderDeckDetail();
    this.renderFullHistory();
    this.renderPointsChart();
    this.renderLogPreview();
  },

  populateDeckPickers() {
    State.syncDecksList();
    const logDeckSelect = document.getElementById("log-deck");
    const detailDeckSelect = document.getElementById("detail-deck-select");
    
    if (logDeckSelect) {
      const currentVal = logDeckSelect.value;
      let html = '';
      State.decksList.forEach(deck => {
        html += `<option value="${Analytics.escHtml(deck)}">${Analytics.escHtml(deckInfo(deck).name)}</option>`;
      });
      html += `<option value="other">+ Nuevo mazo…</option>`;
      logDeckSelect.innerHTML = html;
      const lastUsed = this.lastUsedDeck();
      if (this._deckPicked && currentVal && (currentVal === 'other' || State.decksList.includes(currentVal))) {
        logDeckSelect.value = currentVal;
      } else if (lastUsed && State.decksList.includes(lastUsed)) {
        logDeckSelect.value = lastUsed;
      } else if (currentVal && State.decksList.includes(currentVal)) {
        logDeckSelect.value = currentVal;
      }
    }

    if (detailDeckSelect) {
      const currentDetailVal = detailDeckSelect.value;
      let html = '';
      State.decksList.forEach(deck => {
        html += `<option value="${Analytics.escHtml(deck)}">${Analytics.escHtml(deckInfo(deck).name)}</option>`;
      });
      detailDeckSelect.innerHTML = html;
      if (currentDetailVal && State.decksList.includes(currentDetailVal)) {
        detailDeckSelect.value = currentDetailVal;
      }
    }
    this.syncCustomDeckGroup();
  },

  // The new-deck fields show only while "+ Nuevo mazo…" is what the picker stands on (it is the only choice until there is a deck).
  syncCustomDeckGroup() {
    const select = document.getElementById("log-deck");
    const customGroup = document.getElementById("custom-deck-group");
    if (select && customGroup) customGroup.hidden = select.value !== "other";
  },

  handleDeckPickerChange() {
    this.syncCustomDeckGroup();
    this._deckPicked = true;
  },

  // The colours picked for the new deck, as keys: "w", "u", "b", "r", "g".
  pickedColours() {
    return [...document.querySelectorAll('.js-colour-pick[aria-pressed="true"]')].map(button => button.dataset.colour);
  },

  toggleDeckColour(button) {
    button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
    this.renderLogPreview();
  },

  clearDeckColours() {
    document.querySelectorAll('.js-colour-pick').forEach(button => button.setAttribute('aria-pressed', 'false'));
  },

  // The deck the form stands on: the one picked, or the new one typed, with the colours chosen for it written the way every
  // deck here is written (colour circles, then the name).
  formDeck() {
    const val = (id) => (document.getElementById(id)?.value ?? '').trim();
    const picked = val("log-deck");
    return picked === "other" ? deckNameWithColours(val("log-custom-deck"), this.pickedColours()) : picked;
  },

  setRecordPreset(w, l, d) {
    document.getElementById("log-w").value = w;
    document.getElementById("log-l").value = l;
    document.getElementById("log-d").value = d;
    this.autoCalculatePointsFromRecord();
  },

  autoCalculatePointsFromRecord() {
    const w = parseInt(document.getElementById("log-w").value, 10) || 0;
    const d = parseInt(document.getElementById("log-d").value, 10) || 0;
    const pts = Analytics.calculatePoints(w, d);
    document.getElementById("log-pts").value = pts;
    this.renderLogPreview();
  },

};
