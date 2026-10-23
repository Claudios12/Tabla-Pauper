// Arena: the Historial list and its deck filter.
/* global State, Analytics, plural, esc, deckNameHtml, logRowHtml, Arena */

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

  renderFullHistory() {
    const seasonEntries = this.getFilteredEntries();
    this.renderHistoryFilter(seasonEntries);
    const entries = this.historyDeck === 'all' ? seasonEntries : seasonEntries.filter(e => e.deck && e.deck.trim() === this.historyDeck);
    const container = document.getElementById("full-history-list");
    const countBadge = document.getElementById("history-entry-count");
    if (countBadge) {
      countBadge.textContent = this.historyDeck === 'all'
        ? plural(entries.length, 'torneo', 'torneos')
        : `${entries.length} de ${plural(seasonEntries.length, 'torneo', 'torneos')}`;
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
