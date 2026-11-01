// Arena: the Historial list and its deck filter.
/* global State, Analytics, League, plural, countEntries, esc, deckInfo, deckNameHtml, logRowHtml, isStoreNight, isIsoDate, Arena */

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
