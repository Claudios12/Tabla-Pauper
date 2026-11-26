// Arena: the hero numbers and the findings on the Comparador.
/* global CONFIG, State, Analytics, nf0, nf1, pct, plural, esc, MANA_NAME, deckInfo, pipsHtml,
         deckNameHtml, shortDate, deckExtremes, localIsoDate, weekdayName, isStoreNight, Arena */

Object.assign(Arena, {
  // ─────────────────────────────────────────────────────────────
  // HERO METRICS & INSIGHTS
  // ─────────────────────────────────────────────────────────────
  seasonLabel() {
    return this.currentFilterSeason === 'all' ? 'todas las temporadas' : this.currentFilterSeason;
  },

  // For sentences like "Aún no hay torneos en 2026-2": nothing is added when every season is on screen.
  inSeason() {
    return this.currentFilterSeason === 'all' ? '' : ` en ${this.currentFilterSeason}`;
  },

  // League nights left until the next closing date, whichever season it belongs to, counted on the weekday the league plays.
  // With no date ahead, the card says so and asks for the next one; with a date but no weekday, it asks for the weekday.
  // The card is a button: it opens the dialog that sets what is missing.
  seasonCountdownCard() {
    const today = localIsoDate();
    const dates = Object.values(State.seasonEnds).sort();
    const upcoming = dates.find(date => date >= today);
    const upcomingSeason = Object.keys(State.seasonEnds).find(season => State.seasonEnds[season] === upcoming);
    const lastEnd = dates.filter(date => date < today).pop();
    const day = (iso) => new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long' }).format(Analytics.parseDate(iso));
    const weekday = State.leagueDay();

    let value = '—', note = 'Define cuándo termina la temporada.', cls = 'dash';
    let opens = 'Arena.openSeasonDialog()', hidden = 'Editar el fin de temporada';
    if (upcoming && weekday === null) {
      note = 'Falta saber qué día juega tu liga.';
      opens = 'Arena.openLeagueDialog()';
      hidden = 'Elegir el día de tu liga';
    } else if (upcoming) {
      // The same count the risk card uses (today's night included until its table is saved), so the two never disagree.
      const remaining = this.nightsLeft(upcomingSeason);
      const name = weekdayName(weekday, remaining || 2);
      value = nf0.format(remaining);
      note = remaining ? `${name} hasta el ${day(upcoming)}` : `no quedan ${name} hasta el ${day(upcoming)}`;
      cls = '';
    } else if (lastEnd) {
      note = `Cerró el ${day(lastEnd)}. Define la próxima.`;
    }
    return `<div class="kpi-stack">${this.infoButton('nightsLeft', 'Fechas restantes')}<button class="kpi kpi-action js-season-end" type="button" onclick="${opens}">`
      + `<span class="kpi-label">Fechas restantes<svg class="kpi-edit" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></span>`
      + `<span class="kpi-value ${cls}">${value}</span>`
      + `<span class="kpi-note">${note}</span>`
      + `<span class="visually-hidden">${hidden}</span></button></div>`;
  },

  // ─────────────────────────────────────────────────────────────
  // "¿DE DÓNDE SALE?": a figure, tapped, shows its sum and the tournaments it is made of
  // ─────────────────────────────────────────────────────────────
  // kind: 'winrate', 'mp', 'ppt', 'count', 'avgRank' or 'bestRank'; deck: a deck's name, or '' for every deck. The rows and sums
  // are Analytics.explainRows / explainTotals over the season on screen, the very tournaments the figure was worked out from,
  // and the figure is written the way its card writes it, so the dialog never shows another number.
  explainFigure(kind, deck, opener) {
    const dialog = document.getElementById("explain-dialog");
    if (!dialog || typeof dialog.showModal !== 'function') return;
    this._explainOpener = opener || document.activeElement;
    const rows = Analytics.explainRows(this.getFilteredEntries(), deck || null);
    const t = Analytics.explainTotals(rows);
    const where = `${deck ? ` con ${deckInfo(deck).name}` : ''}${this.inSeason()}`;
    const n = (x) => nf0.format(x);
    const notes = [];
    const noRecord = rows.filter(row => row.w === null).length;
    const fromRecord = rows.filter(row => row.ptsFrom === 'record').length;
    const noPts = rows.filter(row => row.ptsFrom === 'none').length;
    const noRank = rows.filter(row => row.rank === null).length;
    let title, sum;
    if (kind === 'winrate' || kind === 'mp') {
      const rate = t.matches ? (kind === 'winrate' ? t.w / t.matches : (t.w * 3 + t.d) / (t.matches * 3)) * 100 : null;
      const shown = rate === null ? '—' : pct(deck && kind === 'winrate' ? Analytics.roundPct(rate) : rate);
      title = kind === 'winrate' ? `% de victorias${where}: ${shown}` : `Efectividad (MP)${where}: ${shown}`;
      sum = !t.matches ? 'Aún no hay partidas con récord.'
        : (kind === 'winrate'
          ? `${plural(t.w, 'victoria', 'victorias')} de ${plural(t.matches, 'partida', 'partidas')} (${t.w}-${t.l}-${t.d}): ${n(t.w)} ÷ ${n(t.matches)} = ${shown}`
          : `Puntos de partida conseguidos de los posibles: (${n(t.w)} × 3 + ${n(t.d)}) ÷ (${n(t.matches)} × 3) = ${n(t.w * 3 + t.d)} ÷ ${n(t.matches * 3)} = ${shown}`);
      notes.push('Las partidas salen del récord de cada torneo (victorias-derrotas-empates); un bye cuenta como victoria cuando está en el récord.');
      if (kind === 'mp') notes.push('Cada victoria vale 3, cada empate 1 y cada derrota 0, sin contar los puntos especiales de la tienda.');
      if (noRecord) notes.push(`${plural(noRecord, 'torneo no tiene', 'torneos no tienen')} récord y no ${noRecord === 1 ? 'suma' : 'suman'} partidas.`);
    } else if (kind === 'ppt') {
      const shown = t.count ? nf1.format(t.pts / t.count) : '—';
      title = `Pts por torneo${where}: ${shown}`;
      sum = t.count ? `${n(t.pts)} pts ÷ ${plural(t.count, 'torneo', 'torneos')} = ${shown}` : 'Aún no hay torneos.';
      notes.push('Son los puntos oficiales de cada torneo, los que escribiste o leyó la captura.');
      if (fromRecord) notes.push(`En ${plural(fromRecord, 'torneo', 'torneos')} no había puntos escritos y salen del récord (3 por victoria, 1 por empate): ${fromRecord === 1 ? 'va marcado' : 'van marcados'} con *.`);
      if (noPts) notes.push(`${plural(noPts, 'torneo no tiene', 'torneos no tienen')} ni puntos ni récord: ${noPts === 1 ? 'cuenta' : 'cuentan'} como torneo con 0 pts.`);
    } else if (kind === 'count') {
      title = `Torneos${where}: ${n(t.count)}`;
      sum = deck ? `Todos los torneos que guardaste con este mazo${this.inSeason()}.` : `Todos los torneos que guardaste${this.inSeason()}, con cualquier mazo.`;
      notes.push('Las noches en que no jugaste («No participó») y las noches creadas con la tabla del mes de la tienda no cuentan.');
    } else {
      const avg = t.ranks.length ? t.ranks.reduce((a, b) => a + b, 0) / t.ranks.length : null;
      const best = t.ranks.length ? Math.min(...t.ranks) : null;
      if (kind === 'avgRank') {
        title = `Posición promedio${where}: ${avg === null ? '—' : `${nf1.format(avg)}°`}`;
        sum = avg === null ? 'Ningún torneo tiene puesto.' : `(${t.ranks.length > 12 ? `${t.ranks.slice(0, 12).join(' + ')} + …` : t.ranks.join(' + ')}) ÷ ${t.ranks.length} = ${n(t.ranks.reduce((a, b) => a + b, 0))} ÷ ${t.ranks.length} = ${nf1.format(avg)}°`;
      } else {
        const at = rows.find(row => row.rank === best);
        title = `Mejor posición${where}: ${best === null ? '—' : `${best}°`}`;
        sum = best === null ? 'Ningún torneo tiene puesto.' : `El puesto más alto entre ${plural(t.ranks.length, 'torneo', 'torneos')} con puesto: ${best}°, el ${at.entry.date}.`;
      }
      if (noRank) notes.push(`${plural(noRank, 'torneo no tiene', 'torneos no tienen')} puesto y no ${noRank === 1 ? 'cuenta' : 'cuentan'} aquí.`);
    }
    document.getElementById("ex-title").textContent = title;
    document.getElementById("ex-def").innerHTML = this.infoHtml(kind);
    document.getElementById("ex-sum").innerHTML = `<strong>Con tus números.</strong> ${esc(sum)}`;
    document.getElementById("ex-notes").innerHTML = notes.map(note => `<p>${esc(note)}</p>`).join('');
    const showDeck = !deck;
    const mark = (row) => {
      if (kind === 'ppt' && row.ptsFrom === 'record') return `${row.pts}*<span class="visually-hidden"> (del récord)</span>`;
      if (kind === 'ppt' && row.ptsFrom === 'none') return `0<span class="visually-hidden"> (sin puntos ni récord)</span>`;
      return String(row.pts);
    };
    const quiet = (yes) => (yes ? ' class="is-out"' : '');
    const body = rows.map(row => {
      // What does not go into this figure is greyed (a tournament with no record for a rate, no place for a position).
      const out = ((kind === 'winrate' || kind === 'mp') && row.w === null) || ((kind === 'avgRank' || kind === 'bestRank') && row.rank === null);
      return `<tr${quiet(out)}><th scope="row">${esc(row.entry.date)}</th>${showDeck ? `<td class="explain-deck">${esc(deckInfo(row.entry.deck).name)}</td>` : ''}`
        + `<td>${row.w === null ? '—' : `${row.w}-${row.l}-${row.d}`}</td><td>${mark(row)}</td><td>${row.rank === null ? '—' : `${row.rank}°`}</td></tr>`;
    }).join('');
    const foot = rows.length ? `<tfoot><tr><th scope="row">Total</th>${showDeck ? '<td></td>' : ''}<td>${t.w}-${t.l}-${t.d}</td><td>${n(t.pts)}</td><td></td></tr></tfoot>` : '';
    document.getElementById("ex-table").innerHTML = !rows.length ? '' : `<div class="table-wrap explain-wrap" role="region" aria-label="Los torneos que forman esta cifra" tabindex="0"><table class="month-grid explain-grid">`
      + `<caption>Los torneos que forman esta cifra, del más reciente al más antiguo</caption>`
      + `<thead><tr><th scope="col">Fecha</th>${showDeck ? '<th scope="col">Mazo</th>' : ''}<th scope="col">Récord</th><th scope="col">Pts</th><th scope="col">Puesto</th></tr></thead>`
      + `<tbody>${body}</tbody>${foot}</table></div>`;
    dialog.showModal();
  },

  explainClosed() {
    const opener = this._explainOpener;
    this._explainOpener = null;
    if (opener && opener.isConnected) opener.focus();
  },

  // The small mark that says a figure can be tapped to see where it comes from.
  INFO_ICON: '<svg class="kpi-edit" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',

  // A figure that opens its "¿De dónde sale?": the card is a button, and says so to a screen reader.
  explainKpi(label, value, note, cls, kind, deck = '') {
    return `<button class="kpi kpi-action kpi-explain" type="button" onclick="Arena.explainFigure('${kind}', this.dataset.deck, this)" data-deck="${esc(deck)}" aria-haspopup="dialog">`
      + `<span class="kpi-label">${label}${this.INFO_ICON}</span><span class="kpi-value ${cls || ''}">${value}</span>`
      + (note ? `<span class="kpi-note">${note}</span>` : '')
      + `<span class="visually-hidden">. ¿De dónde sale?</span></button>`;
  },

  renderHeroMetrics() {
    const entries = this.getFilteredEntries();
    const allDeckStats = Analytics.getAllDeckStats(entries).filter(d => d.count > 0);

    // One set of numbers for the whole screen: the totals come from the same stats as the cards.
    let globalW = 0, globalL = 0, globalD = 0, sumPts = 0, sumCount = 0;
    allDeckStats.forEach(d => {
      globalW += d.totalWins;
      globalL += d.totalLosses;
      globalD += d.totalDraws;
      sumPts += d.totalPts;
      sumCount += d.count;
    });
    const matches = globalW + globalL + globalD;
    const globalWr = matches > 0 ? (globalW / matches) * 100 : null;

    const { lead: best, weak: worst } = deckExtremes(allDeckStats);
    const kpi = (label, value, note, cls) =>
      `<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value ${cls || ''}">${value}</div><div class="kpi-note">${note}</div></div>`;

    const kpis = document.getElementById("hero-kpis");
    if (kpis) {
      kpis.innerHTML =
        (matches ? this.explainKpi : kpi).call(this, '% de victorias global', globalWr !== null ? pct(globalWr) : '—',
          matches ? `${globalW}W-${globalL}L-${globalD}D · ${plural(matches, 'partida', 'partidas')}` : 'Sin partidas',
          globalWr === null ? 'dash' : (globalWr >= 50 ? 'win-rate-good' : ''), 'winrate') +
        (sumCount ? this.explainKpi : kpi).call(this, 'Pts por torneo', sumCount ? nf1.format(sumPts / sumCount) : '—',
          sumCount ? `${nf0.format(sumPts)} pts en ${plural(sumCount, 'torneo', 'torneos')}` : 'Sin torneos',
          sumCount ? '' : 'dash', 'ppt') +
        (sumCount ? this.explainKpi : kpi).call(this, 'Torneos', nf0.format(sumCount), `${plural(allDeckStats.length, 'mazo', 'mazos')} · ${esc(this.seasonLabel())}`, '', 'count') +
        this.seasonCountdownCard();
    }

    // The one finding, read first.
    const sub = document.getElementById("cmp-sub");
    if (sub) {
      if (!best) {
        sub.textContent = `Aún no hay torneos registrados${this.inSeason()}. Registra el primero en la pestaña Registrar.`;
      } else {
        const small = best.count < CONFIG.BENCHMARKS.MIN_SAMPLE_SIZE ? ' (muestra pequeña)' : '';
        let html = `<strong class="emphasis">${esc(deckInfo(best.deck).name)}</strong> lidera con ${pct(best.winRate)} de victorias en ${plural(best.count, 'torneo', 'torneos')}${small}.`;
        if (worst) {
          html += ` <strong class="emphasis">${esc(deckInfo(worst.deck).name)}</strong> es el que más sufre (${pct(worst.winRate)}).`;
        }
        sub.innerHTML = html;
      }
    }
  },

  renderInsights() {
    const entries = this.getFilteredEntries();
    const allStats = Analytics.getAllDeckStats(entries).filter(d => d.count > 0);
    const container = document.getElementById("insights-container");
    if (!container) return;

    if (allStats.length === 0) {
      container.innerHTML = `<p class="empty">No hay torneos registrados para el filtro seleccionado. Registra tus resultados para generar el diagnóstico.</p>`;
      return;
    }

    // Top performer and the deck that struggles most: the same two the headline names.
    const { lead: topWr, weak: worstWr } = deckExtremes(allStats);

    // Best peak finish: only decks with enough data, tiebreak by count then winRate
    const sortedByPeak = [...allStats]
      .filter(d => d.bestRank !== null && d.count >= CONFIG.BENCHMARKS.MIN_SAMPLE_SIZE)
      .sort((a, b) => (a.bestRank - b.bestRank) || (b.count - a.count) || (b.winRate - a.winRate));
    const peakDeck = sortedByPeak[0];
    // When the best deck also holds the best finish, say it once instead of naming it twice.
    const samePeak = !!(peakDeck && peakDeck.bestRank && peakDeck.deck === topWr.deck);

    const cell = (label, deck, line, tone) =>
      `<div class="finding ${tone}"><div class="finding-label">${label}</div><div class="finding-name">${deckNameHtml(deck)}</div><div class="finding-line">${line}</div></div>`;

    let html = cell('Mazo más efectivo', topWr.deck,
      `<strong class="emphasis">${pct(topWr.winRate)}</strong> de victorias · ${topWr.totalWins}W-${topWr.totalLosses}L en ${plural(topWr.count, 'torneo', 'torneos')}` +
      (samePeak ? ` · su mejor puesto fue el <strong class="emphasis">${peakDeck.bestRank}°</strong>` : ''), 'f-good');

    if (peakDeck && peakDeck.bestRank && !samePeak) {
      html += cell('Mejor pico de torneo', peakDeck.deck,
        `Alcanzó el <strong class="emphasis">${peakDeck.bestRank}° puesto</strong> en ${esc(this.seasonLabel())}`, 'f-peak');
    }

    if (worstWr) {
      html += cell('Mazo con mayor dificultad', worstWr.deck,
        `Promedia <strong class="emphasis">${nf1.format(worstWr.ppg)} pts por torneo</strong> con ${pct(worstWr.winRate)} de victorias. Requiere ajustes de lista o banquillo.`, 'f-bad');
    }

    container.innerHTML = `<div class="findings">${html}</div>`;
  },

  // ─────────────────────────────────────────────────────────────
  // POINTS PER TOURNAMENT (SVG columns, redrawn when the width changes)
  // Each column wears the colours of the deck that played it.
  // ─────────────────────────────────────────────────────────────
  renderPointsChart() {
    const wrap = document.getElementById("points-chart");
    const legend = document.getElementById("points-legend");
    if (!wrap) return;
    const W = wrap.clientWidth;
    if (!W) return;

    // The nights made from the store's table are nobody's tournament: they take no column.
    const rows = [...this.getFilteredEntries()].filter(item => !isStoreNight(item))
      .sort((a, b) => Analytics.parseDate(a.date, a.season, a) - Analytics.parseDate(b.date, b.season, b))
      .map(item => {
        const played = item.deck && item.deck !== "No participó" && item.pts !== "—" && Number.isFinite(Number(item.pts));
        return { item, v: played ? Number(item.pts) : null };
      });
    const n = rows.length;
    if (!n) {
      wrap.innerHTML = `<p class="empty empty-flush">Aún no hay torneos para graficar.</p>`;
      if (legend) legend.innerHTML = '';
      return;
    }

    const H = 190, L = 28, R = 2, T = 8, B = 24;
    const iw = W - L - R, ih = H - T - B;
    const max = rows.reduce((m, r) => Math.max(m, r.v || 0), 0);
    let step = 3;
    for (const s of [3, 5, 6, 10, 15, 20]) { step = s; if (Math.ceil(Math.max(max, 1) / s) <= 4) break; }
    const top = Math.max(Math.ceil(max / step), 2) * step;
    const y = (v) => T + ih - (v / top) * ih;

    let grid = '';
    for (let t = 0; t <= top; t += step) {
      grid += `<line class="${t === 0 ? 'ch-base' : 'ch-grid'}" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/>`;
      grid += `<text class="ch-tick" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${t}</text>`;
    }
    // The line that used to turn a bar green: 6 points is a good result.
    const good = CONFIG.BENCHMARKS.FORM_WIN_PTS;
    if (top >= good) grid += `<line class="ch-ref" x1="${L}" x2="${W - R}" y1="${y(good)}" y2="${y(good)}"/>`;

    const slot = iw / n;
    const bw = Math.max(3, Math.min(16, slot * 0.64));
    let bars = '';
    rows.forEach((r, i) => {
      if (r.v === null || r.v <= 0) return;
      const h = (r.v / top) * ih;
      const x = L + i * slot + (slot - bw) / 2;
      const info = deckInfo(r.item.deck);
      // Wide columns show up to three of the deck's colours side by side; narrow ones show the first.
      const k = Math.min(info.pips.length, bw >= 12 ? 3 : (bw >= 7 ? 2 : 1));
      const keys = k ? info.pips.slice(0, k) : ['n'];
      const sw = bw / keys.length;
      const old = r.item.season === CONFIG.CURRENT_SEASON ? '' : ' old';
      keys.forEach((key, si) => {
        bars += `<rect class="bar-${MANA_NAME[key]}${old}" x="${(x + si * sw).toFixed(1)}" y="${(T + ih - h).toFixed(1)}" width="${sw.toFixed(1)}" height="${h.toFixed(1)}"><title>${esc(shortDate(r.item.date))}: ${r.v} pts · ${esc(info.name)}</title></rect>`;
      });
    });

    const labelCount = Math.min(n, W < 420 ? 4 : 6);
    let labels = '';
    for (let k = 0; k < labelCount; k++) {
      const i = labelCount === 1 ? 0 : Math.round((k * (n - 1)) / (labelCount - 1));
      const cx = L + i * slot + slot / 2;
      const anchor = k === 0 ? 'start' : k === labelCount - 1 ? 'end' : 'middle';
      const x = k === 0 ? L : k === labelCount - 1 ? W - R : cx;
      labels += `<text class="ch-tick" x="${x.toFixed(1)}" y="${H - 6}" text-anchor="${anchor}">${esc(shortDate(rows[i].item.date))}</text>`;
    }

    const played = rows.filter(r => r.v !== null).length;
    const srList = `<ol class="visually-hidden">${rows.filter(r => r.v !== null).map(r => `<li>${esc(shortDate(r.item.date))}: ${r.v} pts con ${esc(deckInfo(r.item.deck).name)}</li>`).join('')}</ol>`;
    wrap.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Puntos por torneo: ${played} torneos jugados, máximo ${max} puntos en una fecha">${grid}${bars}${labels}</svg>${srList}`;

    if (legend) {
      const decks = [];
      rows.forEach(r => { if (r.v !== null && !decks.includes(r.item.deck.trim())) decks.push(r.item.deck.trim()); });
      const hasOld = rows.some(r => r.v !== null && r.item.season !== CONFIG.CURRENT_SEASON);
      legend.innerHTML =
        decks.slice(0, 6).map(d => {
          const info = deckInfo(d);
          return `<span class="legend-item">${info.pips.length ? pipsHtml(info.pips) : '<i class="legend-mark swatch"></i>'}<span class="title-text">${esc(info.name)}</span></span>`;
        }).join('') +
        `<span class="legend-item"><i class="legend-mark ref"></i>${good} pts: buen resultado</span>` +
        (hasOld ? `<span class="legend-item"><i class="legend-mark old"></i>Atenuado: temporadas anteriores</span>` : '');
    }
  },
});
