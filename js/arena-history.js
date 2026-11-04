// Arena: the Historial list and its deck filter.
/* global CONFIG, State, Analytics, League, plural, countEntries, esc, deckInfo, deckNameHtml, logRowHtml, isStoreNight, isIsoDate, Arena */

Object.assign(Arena, {
  // ─────────────────────────────────────────────────────────────
  // CHRONOLOGICAL FULL HISTORY (with a deck filter)
  // ─────────────────────────────────────────────────────────────
  renderHistoryFilter(entries) {
    const el = document.getElementById("history-deck-filter");
    if (!el) return;
    const counts = new Map();
    entries.forEach(e => {
      if (e.deck && e.deck !== "No participó") {
        const key = e.deck.trim();
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    });
    const decks = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(x => x[0]);
    if (this.historyDeck !== 'all' && !decks.includes(this.historyDeck)) this.historyDeck = 'all';
    if (decks.length < 2) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    const chip = (key, html, count) =>
      `<button class="preset-chip chip-filter js-deck-chip" data-deck="${esc(key)}" type="button" onclick="Arena.setHistoryDeck(this.dataset.deck)" aria-pressed="${this.historyDeck === key}">${html}<span class="chip-count">${count}</span></button>`;
    el.innerHTML = chip('all', 'Todos', entries.length) + decks.map(d => chip(d, deckNameHtml(d), counts.get(d))).join('');
  },

  setHistoryDeck(key) {
    this.historyDeck = key || 'all';
    const params = new URLSearchParams(window.location.hash.slice(1));
    if (this.historyDeck === 'all') params.delete('deck'); else params.set('deck', this.historyDeck);
    history.replaceState(null, '', '#' + params.toString());
    this.renderFullHistory();
    // The chips were redrawn: keep keyboard focus on the one that was used.
    const again = [...document.querySelectorAll("#history-deck-filter .js-deck-chip")].find(b => b.dataset.deck === this.historyDeck);
    if (again) again.focus({ preventScroll: true });
  },

  // ─────────────────────────────────────────────────────────────
  // EDIT A SAVED TOURNAMENT (place, record, points, deck, notes), and take away the table of its day when it is wrong
  // ─────────────────────────────────────────────────────────────
  editTournament(index, button) {
    const item = State.historic[index];
    const dialog = document.getElementById("edit-dialog");
    if (!item || isStoreNight(item) || !dialog || typeof dialog.showModal !== 'function') return;
    this._editItem = item;
    // Where the pencil sat in its list, so focus comes back to the same row once the list is drawn again.
    const host = button && button.closest("#full-history-list, #deck-detail-content");
    this._editSpot = { host: host ? host.id : null, pos: host ? [...host.querySelectorAll(".js-edit-tournament")].indexOf(button) : -1 };
    document.getElementById("ed-body").textContent = `Torneo del ${item.date} (${item.season}). La fecha no se cambia: si es otro día, elimínalo y regístralo de nuevo.`;
    const decks = State.decksList.includes(item.deck) ? State.decksList : [item.deck, ...State.decksList];
    document.getElementById("ed-deck").innerHTML = decks.map(deck => `<option value="${esc(deck)}">${esc(deckInfo(deck).name)}</option>`).join('');
    document.getElementById("ed-deck").value = item.deck;
    document.getElementById("ed-rank").value = /^\d/.test(String(item.rank)) ? parseInt(item.rank, 10) : '';
    const [w, l, d] = String(item.wl || '').split('-');
    document.getElementById("ed-w").value = w ?? '';
    document.getElementById("ed-l").value = l ?? '';
    document.getElementById("ed-d").value = d ?? '';
    document.getElementById("ed-pts").value = item.pts;
    document.getElementById("ed-notes").value = item.notes || '';
    this._editCalc = Analytics.calculatePoints(Number(w) || 0, Number(d) || 0);
    this.showEditError('');
    const n = Array.isArray(item.playerResults) ? item.playerResults.length : 0;
    document.getElementById("ed-table").hidden = !n;
    document.getElementById("ed-table-text").textContent = `Este día tiene una tabla de ${plural(n, 'jugador', 'jugadores')} (la de la pestaña General). Si la captura se leyó mal, quítala: tu torneo se queda como está y puedes subir la captura otra vez.`;
    dialog.showModal();
  },

  // The points follow the record while they still hold what the record gave; typed points stay as typed.
  syncEditPoints() {
    const num = (id) => Number(document.getElementById(id).value) || 0;
    const calc = Analytics.calculatePoints(num("ed-w"), num("ed-d"));
    const pts = document.getElementById("ed-pts");
    if (pts.value === '' || Number(pts.value) === this._editCalc) pts.value = calc;
    this._editCalc = calc;
  },

  showEditError(message, fieldId) {
    const error = document.getElementById("ed-error");
    error.textContent = message;
    error.hidden = !message;
    document.querySelectorAll("#edit-form [aria-invalid]").forEach(el => el.removeAttribute("aria-invalid"));
    const field = fieldId && document.getElementById(fieldId);
    if (field) { field.setAttribute("aria-invalid", "true"); field.focus(); }
  },

  // Focus goes back to the pencil of the row (the lists are drawn again after a change).
  refocusEdit() {
    const spot = this._editSpot || {};
    const host = spot.host && document.getElementById(spot.host);
    const pencils = host ? host.querySelectorAll(".js-edit-tournament") : [];
    const target = pencils[spot.pos] || pencils[pencils.length - 1] || document.getElementById("page-title");
    if (target) target.focus({ preventScroll: true });
  },

  saveEdit(event) {
    event.preventDefault();
    const item = this._editItem;
    if (!item || !State.historic.includes(item)) { document.getElementById("edit-dialog").close(); return; }
    const val = (id) => document.getElementById(id).value.trim();
    const rankRaw = val("ed-rank");
    if (rankRaw && (!/^\d{1,3}\s*[°º]?$/.test(rankRaw) || parseInt(rankRaw, 10) < 1)) return this.showEditError("Escribe solo el número de tu puesto, por ejemplo 3.", "ed-rank");
    const whole = (id) => { const raw = val(id); if (raw === '') return 0; const n = Number(raw); return Number.isInteger(n) ? n : NaN; };
    const w = whole("ed-w"), l = whole("ed-l"), d = whole("ed-d");
    if ([w, l, d].some(n => Number.isNaN(n) || n < 0 || n > 20)) return this.showEditError("Cada valor del récord va de 0 a 20.", "ed-w");
    if (w + l + d === 0) return this.showEditError("Escribe el récord: victorias, derrotas y empates.", "ed-w");
    if (w + l + d > 9) return this.showEditError(`Un torneo de ${w + l + d} partidas parece un error de captura. Revisa el récord.`, "ed-w");
    let pts = Analytics.calculatePoints(w, d);
    if (val("ed-pts") !== '') {
      pts = Number(val("ed-pts"));
      if (!Number.isInteger(pts) || pts < 0 || pts > 60) return this.showEditError("Los puntos van de 0 a 60.", "ed-pts");
    }
    const before = this.snapshot();
    item.deck = document.getElementById("ed-deck").value;
    item.rank = rankRaw ? `${parseInt(rankRaw, 10)}°` : "—";
    item.wl = `${w}-${l}-${d}`;
    item.pts = pts;
    item.type = pts >= CONFIG.BENCHMARKS.TYPE_GOOD_PTS ? "good" : (pts <= CONFIG.BENCHMARKS.TYPE_BAD_PTS ? "bad" : "normal");
    item.notes = val("ed-notes");
    document.getElementById("edit-dialog").close();
    State.syncDecksList();
    State.save();
    this.populateDeckPickers();
    this.refreshAll();
    this.refocusEdit();
    this.notify(`Torneo del ${item.date} guardado con los cambios.`, {
      action: { label: 'Deshacer', run: () => { this.restoreSnapshot(before); this.refocusEdit(); this.notify('Torneo como estaba.'); } }
    });
  },

  // Takes the table off the day, not the tournament: the person's own result stays, and the General tab stops counting the others.
  removeTable() {
    const item = this._editItem;
    if (!item || !State.historic.includes(item) || !Array.isArray(item.playerResults) || !item.playerResults.length) return;
    const before = this.snapshot();
    const n = item.playerResults.length;
    delete item.playerResults;
    document.getElementById("edit-dialog").close();
    State.save();
    this.refreshAll();
    this.refocusEdit();
    this.notify(`Se quitó la tabla de ${plural(n, 'jugador', 'jugadores')} del ${item.date}. Tu torneo sigue igual.`, {
      action: { label: 'Deshacer', run: () => { this.restoreSnapshot(before); this.refocusEdit(); this.notify('La tabla volvió.'); } }
    });
  },

  // Tournaments saved twice: the same day, deck, place, record and points. A scanned table left one behind when it was saved as
  // another tournament instead of being added to the one already saved. Only tournaments of the person count; the nights made from
  // the store's table and the days they skipped are not tournaments.
  repeatedTournaments() {
    const groups = new Map();
    State.historic.forEach(item => {
      if (!item || !item.deck || item.deck === "No participó" || isStoreNight(item) || !isIsoDate(item.isoDate)) return;
      const key = [item.isoDate, item.deck.trim().toLowerCase(), item.rank, item.pts, item.wl].join('|');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    return [...groups.values()].filter(group => group.length > 1);
  },

  // Says so above the list, with the way out. It shows for the whole history, whatever the season filter says.
  renderRepeated() {
    const box = document.getElementById("history-repeated");
    if (!box) return;
    const groups = this.repeatedTournaments();
    box.hidden = groups.length === 0;
    if (!groups.length) return;
    const first = groups[0][0];
    const what = `${first.date} (${deckInfo(first.deck).name}${/^\d/.test(String(first.rank)) ? `, ${first.rank}` : ''}, ${first.pts} pts)`;
    document.getElementById("history-repeated-text").textContent = groups.length === 1
      ? `El torneo del ${what} está guardado ${groups[0].length} veces. Pasa cuando la captura de la tabla se guarda como otro torneo en vez de sumarse al que ya tenías. Al unirlos queda uno solo, con la tabla y tus notas.`
      : `Hay ${groups.length} torneos guardados más de una vez, por ejemplo el del ${what}. Pasa cuando la captura de la tabla se guarda como otro torneo en vez de sumarse al que ya tenías. Al unirlos queda cada uno una sola vez, con su tabla y tus notas.`;
  },

  // Joins each repeated tournament into one: the one with the biggest table stays (the first saved when they tie), takes in the
  // players and the notes of the others, and the others go. Undoable.
  mergeRepeated() {
    const groups = this.repeatedTournaments();
    if (!groups.length) return;
    const before = this.snapshot();
    const size = (item) => (Array.isArray(item.playerResults) ? item.playerResults.length : 0);
    let removed = 0;
    groups.forEach(group => {
      const keeper = group.reduce((best, item) => (size(item) > size(best) ? item : best), group[0]);
      group.filter(item => item !== keeper).forEach(extra => {
        if (size(extra)) keeper.playerResults = League.mergeStored(keeper.playerResults || [], extra.playerResults).rows;
        if (extra.notes && extra.notes !== keeper.notes) keeper.notes = [keeper.notes, extra.notes].filter(Boolean).join(' · ');
        State.historic.splice(State.historic.indexOf(extra), 1);
        removed++;
      });
    });
    State.syncDecksList();
    State.save();
    this.refreshAll();
    this.notify(`${plural(removed, 'torneo repetido se unió', 'torneos repetidos se unieron')} a su original: cada uno queda una sola vez, con su tabla.`, {
      action: { label: 'Deshacer', run: () => { this.restoreSnapshot(before); this.notify('Los torneos repetidos volvieron.'); } }
    });
    // The button that was pressed goes with the notice: focus lands on the page heading instead of falling to the page.
    const heading = document.getElementById("page-title");
    if (heading) heading.focus({ preventScroll: true });
  },

  renderFullHistory() {
    this.renderRepeated();
    const seasonEntries = this.getFilteredEntries();
    this.renderHistoryFilter(seasonEntries);
    const entries = this.historyDeck === 'all' ? seasonEntries : seasonEntries.filter(e => e.deck && e.deck.trim() === this.historyDeck);
    const container = document.getElementById("full-history-list");
    const countBadge = document.getElementById("history-entry-count");
    if (countBadge) {
      // The nights made from the store's table are nobody's tournaments: they are counted apart.
      countBadge.textContent = this.historyDeck === 'all'
        ? countEntries(entries)
        : `${entries.length} de ${plural(seasonEntries.filter(e => !isStoreNight(e)).length, 'torneo', 'torneos')}`;
    }

    if (!container) return;

    if (entries.length === 0) {
      container.innerHTML = `<p class="empty">Aún no hay torneos${esc(this.inSeason())}. Registra uno y aparecerá aquí.</p>`;
      return;
    }

    const sortedEntries = [...entries].sort((a, b) => {
      return Analytics.parseDate(b.date, b.season, b) - Analytics.parseDate(a.date, a.season, a);
    });

    // Group by season only when more than one is on screen.
    const seasons = [];
    sortedEntries.forEach(item => { if (!seasons.includes(item.season)) seasons.push(item.season); });
    container.innerHTML = seasons.map(season => {
      const rows = sortedEntries.filter(item => item.season === season);
      const head = seasons.length > 1
        ? `<h3 class="group-label">Temporada ${esc(season)} · ${plural(rows.length, 'torneo', 'torneos')}</h3>`
        : '';
      return head + `<ul class="log">` + rows.map(item =>
        logRowHtml(item, { mode: 'deck', fresh: item === this._fresh, delIdx: State.historic.indexOf(item) })
      ).join('') + `</ul>`;
    }).join('');
  },
});
