// Arena: the deck cards, the matrix and the Detalle por mazo page.
/* global CONFIG, State, Analytics, nf0, nf1, pct, plural, esc, deckInfo, pipsHtml, stripeHtml,
         deckNameHtml, shortDate, TRASH_ICON, logRowHtml, pickLead, statusPillClass, deckPillHtml,
         deltaHtml, deckNameWithColours, Arena, EDIT_ICON, cleanRounds */

Object.assign(Arena, {
  // ─────────────────────────────────────────────────────────────
  // DECK COMPARISON HUB & MATRIX
  // ─────────────────────────────────────────────────────────────
  renderDeckComparison() {
    const entries = this.getFilteredEntries();
    const allStats = Analytics.getAllDeckStats(entries);
    const sortMode = document.getElementById("deck-sort-select")?.value || 'winrate';
    const lead = pickLead(allStats.filter(d => d.count > 0));
    const anyPlayed = allStats.some(d => d.count > 0);

    // Filter out decks with 0 count if viewing a specific season, unless it's a default deck
    let displayStats = allStats.filter(d => d.count > 0);
    if (displayStats.length === 0) {
      displayStats = allStats; // Show all even if 0
    }

    // Sorting
    displayStats.sort((a, b) => {
      if (sortMode === 'winrate') {
        if (b.count > 0 && a.count === 0) return 1;
        if (a.count > 0 && b.count === 0) return -1;
        return b.winRate - a.winRate || b.ppg - a.ppg;
      }
      if (sortMode === 'ppg') return b.ppg - a.ppg;
      if (sortMode === 'tourneys') return b.count - a.count;
      if (sortMode === 'rank') {
        const rA = a.bestRank !== null ? a.bestRank : 999;
        const rB = b.bestRank !== null ? b.bestRank : 999;
        return rA - rB;
      }
      return 0;
    });

    // The card shows one metric (the win rate). When the list is sorted by another one, that one is shown too.
    const sortNote = (stat) => {
      if (sortMode === 'ppg') return `<span class="sort-note">${nf1.format(stat.ppg)} pts por torneo</span>`;
      if (sortMode === 'rank') return `<span class="sort-note">${stat.bestRank ? 'mejor puesto ' + stat.bestRank + '°' : 'sin puestos'}</span>`;
      return '';
    };

    // 1. Render Deck Cards
    const cardsContainer = document.getElementById("deck-cards-list");
    if (cardsContainer) {
      if (!anyPlayed) {
        // With nothing saved at all the welcome card above already carries this button.
        const start = State.historic.length ? `<button class="btn btn-primary" type="button" onclick="Arena.switchTab('pg-logger')">Registrar mi primer torneo</button>` : '';
        cardsContainer.innerHTML = `<div class="card card-pad first-run"><h3 class="first-run-title">Aún no hay torneos${esc(this.inSeason())}</h3><p class="first-run-text">Registra tu primer resultado y aquí verás qué mazo rinde mejor.</p>${start}</div>`;
      } else if (displayStats.length === 0) {
        cardsContainer.innerHTML = `<div class="card"><p class="empty empty-inset">No hay mazos registrados para esta temporada.</p></div>`;
      } else {
        const n = displayStats.length;
        const cols = n === 1 ? '' : (n % 3 === 0 ? 'cols-3' : (n % 2 === 0 ? 'cols-2' : 'cols-3'));
        cardsContainer.innerHTML = `<div class="deck-grid ${cols}">` + displayStats.map(stat => {
          const info = deckInfo(stat.deck);
          const isLead = lead && lead.deck === stat.deck;
          const badgeClass = stat.status.class;

          // Last five tournaments with this deck: green 6+ pts, red 3 or fewer (explained under "Cómo leer las tarjetas")
          let formHtml = '';
          if (stat.recentForm && stat.recentForm.length > 0) {
            formHtml = stat.recentForm.map(f => {
              let pillClass = 'draw';
              if (f.pts >= CONFIG.BENCHMARKS.FORM_WIN_PTS || f.type === 'good') pillClass = 'win';
              else if (f.pts <= CONFIG.BENCHMARKS.FORM_LOSS_PTS || f.type === 'bad') pillClass = 'loss';
              return `<span class="form-pill ${pillClass}" title="${esc(f.date)}: ${esc(f.rank)} (${esc(f.wl)})">${esc(f.wl || f.pts + 'p')}</span>`;
            }).join('');
          } else {
            formHtml = `<span class="form-label">Sin partidas</span>`;
          }

          return `
          <article class="deck-card st-${badgeClass} ${isLead ? 'lead' : ''}" data-deck="${esc(stat.deck)}">
            ${stripeHtml(stat.deck)}
            <div class="deck-head">
              <button class="deck-title" type="button" onclick="Arena.openDeckDetail(this.closest('[data-deck]').dataset.deck)" aria-label="Ver detalle de ${esc(info.name)}">${pipsHtml(info.pips)}<span class="title-text">${esc(info.name)}</span></button>
              <span class="deck-pills">${deckPillHtml(stat, isLead)}</span>
            </div>

            <div class="deck-body">
              <div class="win-rate">
                <b class="win-rate-value">${pct(stat.winRate)}</b>
                <small class="win-rate-detail">
                  <span>${plural(stat.count, 'torneo', 'torneos')} · ${stat.totalWins}W-${stat.totalLosses}L-${stat.totalDraws}D</span>
                  ${deltaHtml(stat)}
                  ${sortNote(stat)}
                </small>
              </div>

              <div>
                <div class="meter" role="img" aria-label="${pct(stat.winRate)} de victorias. La marca central es el 50 %."><i class="meter-fill" style="--w:${Math.min(100, stat.winRate).toFixed(1)}%"></i></div>
                <div class="meter-scale" aria-hidden="true"><span>0 %</span><span>50 %</span><span class="meter-scale-max">100 %</span></div>
                <div class="form-row">
                  <span class="form-label">Última racha</span>
                  <div class="form-pills">${formHtml}</div>
                </div>
              </div>
            </div>
          </article>`;
        }).join('') + `</div>`;
      }
    }

    // 2. Render Comparative Matrix Table (every metric the cards leave out lives here)
    const tbody = document.getElementById("deck-matrix-tbody");
    const countBadge = document.getElementById("table-deck-count");
    if (countBadge) countBadge.textContent = anyPlayed ? plural(displayStats.length, 'mazo', 'mazos') : '0 mazos';

    // With nothing registered the table has nothing to say: a short message stands in for it (and for its scroll hint).
    const matrixWrap = document.getElementById("matrix-wrap");
    const matrixHint = document.getElementById("table-hint");
    const matrixEmpty = document.getElementById("matrix-empty");
    if (matrixWrap) matrixWrap.hidden = !anyPlayed;
    if (matrixHint) matrixHint.hidden = !anyPlayed;
    if (matrixEmpty) matrixEmpty.hidden = anyPlayed;

    if (tbody) {
      tbody.innerHTML = !anyPlayed ? '' : displayStats.map(stat => {
        const isLead = lead && lead.deck === stat.deck;
        return `
        <tr class="matrix-row${isLead ? ' lead' : ''}">
          <th scope="row"><div class="deck-cell">${deckNameHtml(stat.deck)}</div></th>
          <td>${stat.count}</td>
          <td>${stat.totalWins}-${stat.totalLosses}-${stat.totalDraws} <span class="game-count">(${stat.totalMatches})</span></td>
          <td class="key ${stat.status.class === 'good' ? 'win-rate-good' : ''}">${pct(stat.winRate)}</td>
          <td title="Match Point %: (${stat.totalWins}×3 + ${stat.totalDraws}×1) / (${stat.totalMatches}×3)">${pct(stat.matchPointRate)}</td>
          <td>${nf0.format(stat.totalPts)} pts</td>
          <td class="key">${nf1.format(stat.ppg)}</td>
          <td>${stat.avgRank ? nf1.format(stat.avgRank) + '°' : '—'}</td>
          <td class="key">${stat.bestRank ? stat.bestRank + '°' : '—'}</td>
          <td>${stat.top4Count} / ${stat.top8Count}</td>
        </tr>`;
      }).join('');
    }
  },

  // ─────────────────────────────────────────────────────────────
  // RENAMING AN OPPONENT'S DECK in the rounds ("Afinity" for "Affinity"), or joining it to another written by mistake
  // ─────────────────────────────────────────────────────────────
  // Every opponent named in a round (saved or being marked), one per name whatever its capitals, with how many rounds name it.
  opponentRounds() {
    const seen = new Map();
    const add = (round) => {
      if (!round.vs) return;
      const key = round.vs.toLowerCase();
      if (!seen.has(key)) seen.set(key, { vs: round.vs, n: 0 });
      seen.get(key).n++;
    };
    State.historic.forEach(entry => cleanRounds(entry.rounds).forEach(add));
    if (this._draft) cleanRounds(this._draft.rounds).forEach(add);
    return seen;
  },

  openOpponentRename(vs, opener) {
    const dialog = document.getElementById("vs-dialog");
    if (!dialog || typeof dialog.showModal !== 'function' || !vs) return;
    this._renameVs = vs;
    this._renameVsOpener = opener || document.activeElement;
    const input = document.getElementById("vs-name");
    input.value = vs;
    input.removeAttribute("aria-invalid");
    const error = document.getElementById("vs-error");
    error.textContent = '';
    error.hidden = true;
    dialog.showModal();
    input.select();
  },

  async saveOpponentRename(event) {
    event.preventDefault();
    const from = this._renameVs;
    const input = document.getElementById("vs-name");
    const error = document.getElementById("vs-error");
    const dialog = document.getElementById("vs-dialog");
    const name = input.value.replace(/\s+/g, ' ').trim();
    if (!name) {
      error.textContent = 'Escribe el nombre del mazo rival.';
      error.hidden = false;
      input.setAttribute("aria-invalid", "true");
      input.focus();
      return;
    }
    if (!from || name === from) { dialog.close(); return; }
    let to = name;
    // The name of another opponent already written: the same deck written two ways, so the two are joined, after asking.
    const all = this.opponentRounds();
    const twin = name.toLowerCase() !== from.toLowerCase() ? all.get(name.toLowerCase()) : null;
    if (twin) {
      dialog.close();
      const mine = (all.get(from.toLowerCase()) || { n: 0 }).n;
      const ok = await this.confirmDialog({
        title: `Unir «${from}» con «${twin.vs}»`,
        body: `Ya anotaste «${twin.vs}» en ${plural(twin.n, 'ronda', 'rondas')}. Si sigues, ${mine === 1 ? 'la ronda' : `las ${mine} rondas`} contra «${from}» ${mine === 1 ? 'pasa' : 'pasan'} a «${twin.vs}» y cuentan juntas, con todos tus mazos. Podrás deshacerlo unos segundos después.`,
        confirmLabel: 'Unir los nombres',
        danger: false
      });
      if (!ok) { this._renameVsOpener?.focus(); return; }
      to = twin.vs;
    }
    const before = this.snapshot();
    // The night being marked is not in the undo copy (it is a draft on the device), so it is kept apart and put back too.
    const storedDraft = State.loadDraft();
    const draftBefore = this._draft ? { ...this._draft, rounds: this._draft.rounds.map(round => ({ ...round })) } : null;
    // State rewrites the draft on the device; the one on screen is the same night, so it takes the same name.
    const changed = State.renameOpponent(from, to);
    if (this._draft) {
      this._draft.rounds.forEach(round => { if (round.r !== 'B' && round.vs && round.vs.trim().toLowerCase() === from.toLowerCase()) round.vs = to; });
      this.renderRounds();
    }
    if (dialog.open) dialog.close();
    this.renderDeckDetail();
    const focusVs = (vs) => [...document.querySelectorAll(".js-rename-vs")].find(button => button.dataset.vs.toLowerCase() === vs.toLowerCase())?.focus();
    focusVs(to);
    const what = twin ? `«${from}» se unió a «${to}»` : `El mazo rival ahora se llama «${to}»`;
    this.notify(`${what}: ${plural(changed, 'ronda cambiada', 'rondas cambiadas')}.`, {
      action: {
        label: 'Deshacer',
        run: () => {
          this.restoreSnapshot(before);
          if (storedDraft) State.saveDraft(storedDraft);
          if (draftBefore) { this._draft = draftBefore; this.renderRounds(); }
          this.renderDeckDetail();
          focusVs(from);
          this.notify(`El mazo rival volvió a llamarse «${from}».`);
        }
      }
    });
  },

  // ─────────────────────────────────────────────────────────────
  // RENAMING A DECK (name and colours), or joining it to another written by mistake
  // ─────────────────────────────────────────────────────────────
  openDeckRename(deck, opener) {
    const dialog = document.getElementById("deck-dialog");
    if (!dialog || typeof dialog.showModal !== 'function' || !deck) return;
    this._renameDeck = deck;
    this._renameOpener = opener || document.activeElement;
    const info = deckInfo(deck);
    const input = document.getElementById("dk-name");
    input.value = info.name;
    input.removeAttribute("aria-invalid");
    const error = document.getElementById("dk-error");
    error.textContent = '';
    error.hidden = true;
    document.querySelectorAll(".js-dk-colour").forEach(button => button.setAttribute("aria-pressed", String(info.pips.includes(button.dataset.colour))));
    dialog.showModal();
  },

  toggleRenameColour(button) {
    button.setAttribute("aria-pressed", String(button.getAttribute("aria-pressed") !== "true"));
  },

  async saveDeckRename(event) {
    event.preventDefault();
    const from = this._renameDeck;
    const input = document.getElementById("dk-name");
    const error = document.getElementById("dk-error");
    const fail = (message) => { error.textContent = message; error.hidden = false; input.setAttribute("aria-invalid", "true"); input.focus(); };
    const name = input.value.replace(/\s+/g, ' ').trim();
    if (!name) return fail('Escribe el nombre del mazo.');
    // The name as typed, with the colours picked in front, the way every deck here is written (deckNameWithColours keeps colours
    // typed into the name itself).
    const colours = [...document.querySelectorAll('.js-dk-colour[aria-pressed="true"]')].map(button => button.dataset.colour);
    let to = deckNameWithColours(deckInfo(name).pips.length ? name : deckInfo(name).name, colours);
    const dialog = document.getElementById("deck-dialog");
    if (!from || to === from) { dialog.close(); return; }
    // The name of another deck already there: they are one deck written twice, so they are joined, after asking.
    const twin = State.decksList.find(deck => deck.trim().toLowerCase() !== from.trim().toLowerCase() && deckInfo(deck).name.toLowerCase() === deckInfo(to).name.toLowerCase());
    if (twin) {
      dialog.close();
      const count = (deck) => State.historic.filter(item => typeof item.deck === 'string' && item.deck.trim().toLowerCase() === deck.trim().toLowerCase()).length;
      const ok = await this.confirmDialog({
        title: `Unir «${deckInfo(from).name}» con «${deckInfo(twin).name}»`,
        body: `Ya tienes un mazo llamado «${deckInfo(twin).name}» (${plural(count(twin), 'torneo', 'torneos')}). Si sigues, ${count(from) === 1 ? 'el torneo' : `los ${count(from)} torneos`} de «${deckInfo(from).name}» ${count(from) === 1 ? 'pasa' : 'pasan'} a ese mazo y quedan juntos, con sus colores. Podrás deshacerlo unos segundos después.`,
        confirmLabel: 'Unir los mazos',
        danger: false
      });
      if (!ok) return;
      to = twin;
    }
    const before = this.snapshot();
    const changed = State.renameDeck(from, to);
    if (this._draft && this._draft.deck && this._draft.deck.trim().toLowerCase() === from.trim().toLowerCase()) this._draft.deck = to;
    if (this.historyDeck === from.trim()) this.setHistoryDeck(to.trim());
    if (dialog.open) dialog.close();
    this.populateDeckPickers();
    const select = document.getElementById("detail-deck-select");
    if (select) select.value = to;
    this.refreshAll();
    document.querySelector(".js-rename-deck")?.focus();
    const what = twin ? `«${deckInfo(from).name}» se unió a «${deckInfo(to).name}»` : `El mazo ahora se llama «${deckInfo(to).name}»`;
    this.notify(`${what}: ${plural(changed, 'torneo cambiado', 'torneos cambiados')}.`, {
      action: { label: 'Deshacer', run: () => { this.restoreSnapshot(before); const back = document.getElementById("detail-deck-select"); if (back) back.value = from; this.renderDeckDetail(); this.notify(`El mazo volvió a llamarse «${deckInfo(from).name}».`); } }
    });
  },

  // ─────────────────────────────────────────────────────────────
  // DECK DRILL-DOWN DOSSIER
  // ─────────────────────────────────────────────────────────────
  openDeckDetail(deckName) {
    const select = document.getElementById("detail-deck-select");
    if (select) {
      select.value = deckName;
    }
    this.switchTab('pg-detail');
    this.renderDeckDetail();
  },

  renderDeckDetail() {
    const select = document.getElementById("detail-deck-select");
    const container = document.getElementById("deck-detail-content");
    if (!select || !container) return;

    const deckName = select.value || State.decksList[0];
    if (!deckName) {
      container.innerHTML = `<div class="card"><p class="empty empty-inset">Aún no hay mazos. Registra un torneo para crear el primero.</p></div>`;
      return;
    }

    const entries = this.getFilteredEntries();
    const stat = Analytics.computeDeckStats(deckName, entries);
    const info = deckInfo(stat.deck);

    let timelineHtml = '';
    if (stat.entries.length === 0) {
      timelineHtml = `<p class="empty">No hay torneos registrados con ${esc(info.name)} en ${esc(this.seasonLabel())}.</p>`;
    } else {
      timelineHtml = `<ul class="log">` + [...stat.entries].reverse().map(item =>
        logRowHtml(item, { mode: 'date', showSeason: this.currentFilterSeason === 'all', delIdx: State.historic.indexOf(item) })
      ).join('') + `</ul>`;
    }

    const total = stat.totalMatches;
    const wPct = total > 0 ? (stat.totalWins / total) * 100 : 0;
    const dPct = total > 0 ? (stat.totalDraws / total) * 100 : 0;
    const lPct = total > 0 ? 100 - wPct - dPct : 0;

    // The matchup notes are the most personal data in the app: the latest two, in one short digest.
    const noted = [...stat.entries].reverse().filter(e => e.notes && String(e.notes).trim()).slice(0, 2);
    const where = esc(this.inSeason());
    const digest = noted.length
      ? `<p class="dossier-notes"><span class="caption">Últimas notas</span>${noted.map(e => `«${esc(String(e.notes).trim())}» <span class="muted">(${esc(shortDate(e.date))})</span>`).join(' · ')}</p>`
      : (stat.count > 0 ? `<p class="dossier-notes muted">Aún no hay notas de matchups con este mazo${where}. Puedes añadirlas al registrar un torneo.</p>` : '');

    // No games in the season on screen: say that, rather than a record of zeros.
    const none = total === 0;
    const statusLabel = stat.count === 0 ? 'Sin torneos' : stat.status.label;
    const statusDesc = stat.count === 0 ? `No jugaste este mazo${this.inSeason() || ' todavía'}.` : stat.status.desc;

    // How the deck did against each opponent deck, from the rounds marked on the night (see Arena.addRound). Only when there are some.
    const matchups = Analytics.matchups(entries, deckName);
    const matchupHtml = !matchups.some(row => row.vs) ? '' : `
      <section class="card matchup-card" aria-labelledby="h-matchups">
        <div class="card-head"><h2 id="h-matchups">Contra qué mazos</h2><span class="sec-meta">${plural(matchups.reduce((sum, row) => sum + row.played, 0), 'ronda', 'rondas')} anotadas</span></div>
        <div class="table-wrap matchup-wrap" role="region" aria-label="Récord de ${esc(info.name)} contra cada mazo" tabindex="0">
          <table class="month-grid matchup-grid">
            <caption>Récord de ${esc(info.name)} contra cada mazo rival${esc(this.inSeason())}, de las rondas que anotaste</caption>
            <thead><tr><th scope="col">Mazo rival</th><th scope="col">Rondas</th><th scope="col">Récord</th><th scope="col">% victorias</th></tr></thead>
            <tbody>${matchups.map(row => `<tr><th scope="row">${row.vs ? `<span class="matchup-name"><span class="matchup-vs">${esc(row.vs)}</span><button class="btn-icon-edit js-rename-vs" data-vs="${esc(row.vs)}" type="button" onclick="Arena.openOpponentRename(this.dataset.vs, this)" aria-haspopup="dialog" aria-label="Corregir el nombre de «${esc(row.vs)}»">${EDIT_ICON.replace('<svg ', '<svg class="row-delete-icon" ')}</button></span>` : '<span class="muted">Sin anotar</span>'}</th><td>${row.played}</td><td>${row.w}-${row.l}-${row.d}</td><td class="${row.winRate >= 50 ? 'win-rate-good' : ''}">${pct(row.winRate)}</td></tr>`).join('')}</tbody>
          </table>
        </div>
        <p class="hint matchup-note">Sale de las rondas que marcas en Registrar, en «Llevar la cuenta ronda a ronda». Con pocas rondas contra un mazo, el porcentaje dice poco.</p>
      </section>`;

    container.innerHTML = `
      <div class="cols detail">
        <section class="card card-pad st-${stat.status.class}" aria-labelledby="h-dossier">
          ${stripeHtml(stat.deck)}
          <h2 class="dossier-name" id="h-dossier">${pipsHtml(info.pips)}<span class="title-text">${esc(info.name)}</span></h2>
          <div class="dossier-status">
            <span class="pill ${statusPillClass(stat)}">${esc(statusLabel)}</span>
            <span>${esc(statusDesc)}</span>
          </div>
          ${digest}

          <div class="dossier-wr">
            <div>
              <div class="caption">% de victorias</div>
              <b class="dossier-wr-value ${stat.status.class === 'good' ? 'win-rate-good' : ''}">${none ? '—' : pct(Analytics.roundPct(stat.winRate))}</b>
            </div>
            <div class="record">${none ? 'Sin partidas' : `${stat.totalWins}W · ${stat.totalLosses}L · ${stat.totalDraws}D
              <span class="record-detail">${plural(total, 'partida', 'partidas')} · MP ${pct(stat.matchPointRate)}</span>
              ${deltaHtml(stat)}`}
            </div>
          </div>

          <div class="wld-bar" role="img" aria-label="${plural(stat.totalWins, 'victoria', 'victorias')}, ${plural(stat.totalDraws, 'empate', 'empates')} y ${plural(stat.totalLosses, 'derrota', 'derrotas')}">
            ${total > 0 ? `<i class="wld-segment win" style="width:${wPct.toFixed(1)}%"></i><i class="wld-segment draw" style="width:${dPct.toFixed(1)}%"></i><i class="wld-segment loss" style="width:${lPct.toFixed(1)}%"></i>` : ''}
          </div>
          <div class="wld-legend"${none ? ' hidden' : ''}>
            <span class="wld-legend-item"><i class="wld-legend-mark win"></i>${plural(stat.totalWins, 'victoria', 'victorias')}</span>
            <span class="wld-legend-item"><i class="wld-legend-mark draw"></i>${plural(stat.totalDraws, 'empate', 'empates')}</span>
            <span class="wld-legend-item"><i class="wld-legend-mark loss"></i>${plural(stat.totalLosses, 'derrota', 'derrotas')}</span>
          </div>

          <div class="kpis two dossier-kpis">
            <div class="kpi"><div class="kpi-label">Torneos</div><div class="kpi-value">${stat.count}</div></div>
            <div class="kpi"><div class="kpi-label">Pts por torneo</div><div class="kpi-value">${stat.count ? nf1.format(stat.ppg) : '—'}</div></div>
            <div class="kpi"><div class="kpi-label">Mejor posición</div><div class="kpi-value">${stat.bestRank ? stat.bestRank + '°' : '—'}</div></div>
            <div class="kpi"><div class="kpi-label">Posición promedio</div><div class="kpi-value">${stat.avgRank ? nf1.format(stat.avgRank) + '°' : '—'}</div></div>
          </div>
        </section>

        <section class="card" aria-labelledby="h-timeline">
          <div class="card-head">
            <h2 id="h-timeline">Torneos con este mazo</h2>
            <span class="sec-meta">Más reciente primero</span>
          </div>
          ${timelineHtml}
        </section>
      </div>

      ${matchupHtml}

      <section class="card card-pad detail-rename" aria-labelledby="h-rename-deck">
        <h2 class="detail-danger-title" id="h-rename-deck">Nombre y colores</h2>
        <p class="detail-danger-text">¿Lo escribiste mal o quieres llamarlo de otra forma? Se cambia en todos sus torneos. Si le pones el nombre de otro de tus mazos, los dos se unen.</p>
        <button class="btn btn-secondary js-rename-deck" data-deck="${esc(stat.deck)}" type="button" onclick="Arena.openDeckRename(this.dataset.deck, this)" aria-haspopup="dialog">Cambiar el nombre de «${esc(info.name)}»</button>
      </section>

      <section class="card card-pad detail-danger" aria-labelledby="h-del-deck">
        <h2 class="detail-danger-title" id="h-del-deck">Eliminar este mazo</h2>
        <p class="detail-danger-text">¿Ya no juegas este mazo? Retirarlo borra también sus torneos del historial. Podrás deshacerlo unos segundos después.</p>
        <button class="btn btn-danger" data-deck="${esc(stat.deck)}" type="button" onclick="Arena.deleteDeck(this.dataset.deck)">
          ${TRASH_ICON.replace('<svg ', '<svg class="btn-icon" width="18" height="18" ')} Eliminar «${esc(info.name)}»
        </button>
      </section>
    `;
  },
});
