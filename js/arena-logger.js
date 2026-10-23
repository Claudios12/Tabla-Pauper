// Arena: the Registrar form, its live preview and the OCR scan.
/* global CONFIG, State, Analytics, pct, plural, deckInfo, logRowHtml, localIsoDate, seasonOf,
         Arena */

Object.assign(Arena, {
  // ─────────────────────────────────────────────────────────────
  // LOGGER PREVIEW (what the row will look like once saved)
  // ─────────────────────────────────────────────────────────────
  renderLogPreview() {
    const el = document.getElementById("log-preview");
    if (!el) return;
    const val = (id) => (document.getElementById(id)?.value ?? '').trim();

    let deck = val("log-deck");
    if (deck === "other") deck = val("log-custom-deck");

    const dateVal = val("log-date");
    let date = '—';
    if (dateVal) {
      const [, m, d] = dateVal.split('-').map(Number);
      date = `${d} ${CONFIG.MONTHS_ABBR[m - 1]}`;
    }

    // Only a real position is shown; "-5" or "abc" stays out of the preview and the Save bar.
    const rankRaw = val("log-rank");
    const rankNum = /^\d{1,3}\s*[°º]?$/.test(rankRaw) ? parseInt(rankRaw, 10) : NaN;
    const rank = Number.isFinite(rankNum) && rankNum >= 1 ? `${rankNum}°` : '';

    const w = val("log-w"), l = val("log-l"), d = val("log-d");
    const hasRecord = w !== '' || l !== '' || d !== '';
    const wl = hasRecord ? `${parseInt(w, 10) || 0}-${parseInt(l, 10) || 0}-${parseInt(d, 10) || 0}` : '—';
    let pts = val("log-pts");
    if (pts === '' && hasRecord) pts = Analytics.calculatePoints(parseInt(w, 10) || 0, parseInt(d, 10) || 0);

    const season = dateVal ? seasonOf(Number(dateVal.slice(0, 4)), Number(dateVal.slice(5, 7))) : CONFIG.CURRENT_SEASON;
    const seasonTag = document.getElementById("logger-season-tag");
    if (seasonTag) seasonTag.textContent = season;
    el.innerHTML = `<ul class="log">` + logRowHtml({
      date, season, deck: deck || 'Elige un mazo', rank: rank || '—',
      wl, pts: pts === '' ? '—' : pts, notes: val("log-notes")
    }, { mode: 'deck', preview: true, showSeason: true }) + `</ul>`;

    // What Save will store, in the bar that stays on screen while the form scrolls on a phone.
    const summary = document.getElementById("save-summary");
    if (summary) {
      summary.textContent = (deck && hasRecord)
        ? [deckInfo(deck).name, wl, `${pts} pts`, rank].filter(Boolean).join(' · ')
        : 'Elige un récord para poder guardar.';
    }
    const saveBtn = document.querySelector(".js-save-button");
    if (saveBtn) saveBtn.classList.toggle("is-idle", !(deck && hasRecord));

    // Desktop side column: the chosen deck's latest results, so the entry is made with its trend in view.
    const recent = document.getElementById("log-recent");
    if (recent) {
      const key = deck.trim().toLowerCase();
      const latest = !key ? [] : State.historic
        .filter(e => e.deck && e.deck !== "No participó" && e.deck.trim().toLowerCase() === key)
        .sort((a, b) => Analytics.parseDate(b.date, b.season, b) - Analytics.parseDate(a.date, a.season, a))
        .slice(0, 5);
      recent.hidden = latest.length === 0;
      if (latest.length) {
        document.getElementById("log-recent-title").textContent = `Últimos torneos con ${deckInfo(deck).name}`;
        document.getElementById("log-recent-list").innerHTML = `<ul class="log">` + latest.map(item => logRowHtml(item, { mode: 'date', showSeason: true })).join('') + `</ul>`;
      }
    }

    // Non-blocking: two tournaments on one day are possible, but usually a slip.
    const note = document.getElementById("date-note");
    if (note) {
      const dup = dateVal ? State.historic.find(e => e.isoDate === dateVal && e.deck && e.deck !== "No participó") : null;
      note.hidden = !dup;
      note.textContent = dup ? `Ya registraste ${deckInfo(dup.deck).name} el ${dup.date}. Si es otro torneo, guárdalo igual.` : '';
    }

    this.syncRecordUi();
  },

  // ─────────────────────────────────────────────────────────────
  // TOURNAMENT LOGGING (MANUAL + OCR)
  // ─────────────────────────────────────────────────────────────
  // The deck used in the most recent played tournament: the likeliest answer for the next entry.
  lastUsedDeck() {
    let best = null, bestTime = -Infinity;
    State.historic.forEach(item => {
      if (!item.deck || item.deck === "No participó") return;
      const t = Analytics.parseDate(item.date, item.season, item).getTime();
      if (t > bestTime) { bestTime = t; best = item.deck.trim(); }
    });
    return best;
  },

  toggleRecordExtra(force) {
    const panel = document.getElementById("record-extra");
    const btn = document.getElementById("record-more");
    if (!panel || !btn) return;
    const open = typeof force === 'boolean' ? force : panel.hidden;
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
  },

  // The chips mirror the record in the inputs. The extra panel opens by itself when the record
  // (or the points) is not one of the four main chips, so nothing typed is ever hidden.
  syncRecordUi() {
    const val = (id) => (document.getElementById(id)?.value ?? '').trim();
    const hasRecord = val("log-w") !== '' || val("log-l") !== '' || val("log-d") !== '';
    const w = parseInt(val("log-w"), 10) || 0, l = parseInt(val("log-l"), 10) || 0, d = parseInt(val("log-d"), 10) || 0;
    let onMainChip = false;
    document.querySelectorAll(".js-record-chip[data-w]").forEach(chip => {
      const on = hasRecord && +chip.dataset.w === w && +chip.dataset.l === l && +chip.dataset.d === d;
      chip.setAttribute("aria-pressed", String(on));
      if (on && !chip.closest("#record-extra")) onMainChip = true;
    });
    const pts = val("log-pts");
    const customPts = pts !== '' && Number(pts) !== Analytics.calculatePoints(w, d);
    if ((hasRecord && !onMainChip) || customPts) this.toggleRecordExtra(true);
  },

  clearFieldErrors() {
    document.querySelectorAll("#pg-logger .js-field-error").forEach(e => { e.textContent = ''; e.hidden = true; });
    document.querySelectorAll("#pg-logger [aria-invalid]").forEach(i => i.removeAttribute("aria-invalid"));
  },

  fieldError(inputId, message, errId) {
    const input = document.getElementById(inputId);
    const err = document.getElementById(errId || ('err-' + inputId));
    if (input) input.setAttribute("aria-invalid", "true");
    if (err) { err.textContent = message; err.hidden = false; }
    return inputId;
  },

  saveManualTournament() {
    const val = (id) => (document.getElementById(id)?.value ?? '').trim();
    this.clearFieldErrors();
    this.setStatus('');
    const errors = [];
    const fail = (inputId, message, errId) => errors.push(this.fieldError(inputId, message, errId));

    // Date: required, never in the future
    const dateVal = val("log-date");
    if (!dateVal) fail("log-date", "Elige la fecha del torneo.");
    else if (dateVal > localIsoDate()) fail("log-date", "La fecha no puede ser futura. Revisa el día del torneo.");

    // Deck
    let selectedDeck = val("log-deck");
    if (selectedDeck === "other") {
      selectedDeck = val("log-custom-deck");
      if (!selectedDeck) fail("log-custom-deck", "Escribe el nombre del mazo.");
    }

    // Rank: optional, but a number when present
    let rankVal = val("log-rank");
    if (rankVal) {
      const n = parseInt(rankVal, 10);
      if (!/^\d{1,3}\s*[°º]?$/.test(rankVal) || n < 1) fail("log-rank", "Escribe solo el número de tu puesto, por ejemplo 3.");
      else rankVal = `${n}°`;
    } else {
      rankVal = "—";
    }

    // Record: whole numbers, a believable number of rounds
    const whole = (id) => { const raw = val(id); if (raw === '') return 0; const n = Number(raw); return Number.isInteger(n) ? n : NaN; };
    const w = whole("log-w"), l = whole("log-l"), d = whole("log-d");
    let recordTyped = false;
    if ([w, l, d].some(n => Number.isNaN(n) || n < 0 || n > 20)) {
      fail("log-w", "Cada valor del récord va de 0 a 20.", "err-log-record");
      recordTyped = true;
    } else if (w + l + d === 0) {
      fail("log-w", "Elige tu récord entre los frecuentes, o abre «Otro récord» y escribe victorias, derrotas y empates.", "err-log-record");
    } else if (w + l + d > 9) {
      fail("log-w", `Un torneo de ${w + l + d} partidas parece un error de captura. Revisa el récord.`, "err-log-record");
      recordTyped = true;
    }

    // Points: derived from the record unless overridden (byes, special events)
    const ptsRaw = val("log-pts");
    let ptsVal = Analytics.calculatePoints(w, d);
    if (ptsRaw !== '') {
      const n = Number(ptsRaw);
      if (!Number.isInteger(n) || n < 0 || n > 60) fail("log-pts", "Los puntos van de 0 a 60.");
      else ptsVal = n;
    }

    if (errors.length) {
      const first = errors[0];
      const extra = document.getElementById("record-extra");
      if ((first === "log-pts" || (first === "log-w" && recordTyped)) && extra && extra.hidden) this.toggleRecordExtra(true);
      const target = document.getElementById(first);
      (target && target.offsetParent !== null ? target : document.querySelector(".js-record-chip"))?.focus();
      this.setStatus(`${plural(errors.length, 'campo necesita', 'campos necesitan')} tu atención antes de guardar.`, "var(--color-bad)");
      return;
    }

    const [y, m, dayNum] = dateVal.split("-").map(Number);
    const entry = {
      date: `${dayNum} ${CONFIG.MONTHS_ABBR[m - 1]}`,
      isoDate: dateVal,
      season: seasonOf(y, m),
      deck: selectedDeck,
      rank: rankVal,
      pts: ptsVal,
      wl: `${w}-${l}-${d}`,
      type: ptsVal >= CONFIG.BENCHMARKS.TYPE_GOOD_PTS ? "good" : (ptsVal <= CONFIG.BENCHMARKS.TYPE_BAD_PTS ? "bad" : "normal"),
      notes: val("log-notes")
    };

    const before = this.snapshot();
    State.historic.push(entry);
    State.syncDecksList();
    State.save();

    // Land where the new row can be found, even if the season filter would hide it.
    if (this.currentFilterSeason !== 'all' && this.currentFilterSeason !== entry.season) {
      this.currentFilterSeason = entry.season;
      this.populateSeasonFilter();
      this.handleSeasonFilterChange();
    }
    this._deckPicked = false;
    this.populateDeckPickers();
    this._fresh = entry;
    this.historyDeck = 'all';
    this.refreshAll();

    ["log-rank", "log-w", "log-l", "log-d", "log-pts", "log-notes", "log-custom-deck"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    this.toggleRecordExtra(false);
    this.renderLogPreview();

    this.switchTab('pg-history', document.querySelectorAll('.js-nav-link')[3]);
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() => {
      const row = document.querySelector(".js-log-row.fresh");
      if (row) row.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    });
    clearTimeout(this._freshTimer);
    this._freshTimer = setTimeout(() => {
      this._fresh = null;
      document.querySelectorAll(".js-log-row.fresh").forEach(r => r.classList.remove("fresh"));
    }, 6000);

    // The consequence, not only the confirmation: what happened to the deck's win rate.
    const inSeason = (list) => list.filter(e => e.season === entry.season);
    const prev = Analytics.computeDeckStats(selectedDeck, inSeason(before.historic));
    const next = Analytics.computeDeckStats(selectedDeck, inSeason(State.historic));
    let effect = '';
    if (next.totalMatches > 0) {
      if (prev.totalMatches === 0) effect = ` Primer torneo de este mazo en ${entry.season}: ${pct(next.winRate)} de victorias.`;
      else if (Analytics.roundPct(prev.winRate) === Analytics.roundPct(next.winRate)) effect = ` Su % de victorias en ${entry.season} se mantiene en ${pct(next.winRate)}.`;
      else effect = ` Su % de victorias en ${entry.season} pasa de ${pct(prev.winRate)} a ${pct(next.winRate)}.`;
    }
    this.notify(`Torneo guardado: ${deckInfo(selectedDeck).name} · ${entry.wl} · ${ptsVal} pts.${effect}`, {
      action: { label: 'Deshacer', run: () => { this.restoreSnapshot(before); this.notify('Torneo deshecho. Puedes registrarlo de nuevo cuando quieras.'); } }
    });
  },
});
