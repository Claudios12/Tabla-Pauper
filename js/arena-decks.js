// Arena: the deck cards, the matrix and the Detalle por mazo page.
/* global CONFIG, State, Analytics, nf0, nf1, pct, plural, esc, deckInfo, pipsHtml, stripeHtml,
         deckNameHtml, shortDate, TRASH_ICON, logRowHtml, pickLead, statusPillClass, deckPillHtml,
         deltaHtml, Arena */

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
        cardsContainer.innerHTML = `<div class="card card-pad first-run"><h3 class="first-run-title">Aún no hay torneos${esc(this.inSeason())}</h3><p class="first-run-text">Registra tu primer resultado y aquí verás qué mazo rinde mejor.</p><button class="btn btn-primary" type="button" onclick="Arena.switchTab('pg-logger', document.querySelectorAll('.js-nav-link')[2])">Registrar mi primer torneo</button></div>`;
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
  // DECK DRILL-DOWN DOSSIER
  // ─────────────────────────────────────────────────────────────
  openDeckDetail(deckName) {
    const select = document.getElementById("detail-deck-select");
    if (select) {
      select.value = deckName;
    }
    this.switchTab('pg-detail', document.querySelectorAll('.js-nav-link')[1]);
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
