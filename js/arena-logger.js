// Arena: the Registrar form, its live preview and the OCR scan.
/* global CONFIG, State, Analytics, League, pct, plural, deckInfo, logRowHtml, localIsoDate, seasonOf,
         isStoreNight, tournamentType, cleanRounds, esc, isIsoDate, Arena */

Object.assign(Arena, {
  // ─────────────────────────────────────────────────────────────
  // LOGGER PREVIEW (what the row will look like once saved)
  // ─────────────────────────────────────────────────────────────
  renderLogPreview() {
    const el = document.getElementById("log-preview");
    if (!el) return;
    const val = (id) => (document.getElementById(id)?.value ?? '').trim();

    const deck = this.formDeck();

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
    // A table that goes to a tournament already saved adds no tournament: the preview shows the saved one, which does not change.
    const target = this.scanTarget();
    el.innerHTML = target
      ? `<ul class="log">` + logRowHtml(target, { mode: 'deck', preview: true, showSeason: true }) + `</ul><p class="hint">Tu torneo ya guardado no cambia y no se agrega otro: la tabla solo trae a los demás jugadores.</p>`
      : `<ul class="log">` + logRowHtml({
        date, season, deck: deck || 'Elige un mazo', rank: rank || '—',
        wl, pts: pts === '' ? '—' : pts, notes: val("log-notes")
      }, { mode: 'deck', preview: true, showSeason: true }) + `</ul>`;

    // What Save will store, in the bar that stays on screen while the form scrolls on a phone.
    const summary = document.getElementById("save-summary");
    if (summary) {
      const table = this.scannedSummary();
      if (target) summary.textContent = `Se suma a tu torneo del ${target.date}: ${table}. No se agrega otro torneo.`;
      else summary.textContent = (deck && hasRecord)
        ? [deckInfo(deck).name, wl, `${pts} pts`, rank, table].filter(Boolean).join(' · ')
        : 'Elige un récord para poder guardar.';
    }
    const saveBtn = document.querySelector(".js-save-button");
    if (saveBtn) {
      saveBtn.classList.toggle("is-idle", !target && !(deck && hasRecord));
      saveBtn.textContent = target ? 'Sumar la tabla al torneo' : 'Guardar torneo';
    }

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

    this.renderSameDay();
    this.syncRecordUi();
    // A night being marked round by round belongs to the date and deck the form shows.
    if (this._draft) this.persistDraft();
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

  // Rows of the table that still need a look ask before the table is kept: the person goes back to them, or keeps them as
  // they are. Resolves false when they go back (and takes them there).
  // It asks too when the table lacks places (a row the reader missed: the first one, under the title of the picture, is the usual): those
  // players would never reach the league, and the only sign was a note. `complement` is true when the table is added to a tournament
  // that already has one: what this picture lacks is then most likely there already.
  async confirmDoubtfulRows(complement = false) {
    const doubtful = this._scanned.filter(row => row.flags.length).length;
    const places = complement ? [] : (this._scanNotes.places || []);
    // A player the person added by hand (no place, with a name and points) covers one of the missing ones.
    const byHand = this._scanned.filter(row => row.rank === null && this.scannedRowIsComplete(row)).length;
    const absent = Math.max(0, (places.length || (complement ? 0 : (this._scanNotes.missing || 0))) - byHand);
    if (!doubtful && !absent) return true;
    const omitted = this._scanned.filter(row => !this.scannedRowIsComplete(row)).length;
    const blank = omitted === 0 ? '' : (omitted === 1 ? ' La que no tiene puntos no se guardará.' : ` Las ${omitted} que no tienen puntos no se guardarán.`);
    const parts = [];
    if (doubtful) parts.push(`${plural(doubtful, 'fila tiene', 'filas tienen')} avisos.${blank}`);
    if (absent && places.length && absent === places.length) parts.push(`Faltan ${this.describePlaces(places)} en la tabla: esos jugadores no contarán en la liga.`);
    else if (absent) parts.push(`Parece que ${absent === 1 ? 'falta 1 fila' : `faltan ${absent} filas`}: esos jugadores no contarán en la liga.`);
    const ok = await this.confirmDialog({
      title: doubtful ? (absent ? "La tabla leída está incompleta y tiene filas por revisar" : "La tabla leída tiene filas por revisar") : "A la tabla leída le faltan jugadores",
      body: `${parts.join(' ')} ${absent ? 'Vuelve y agrégalos con «Agregar jugador» o con otra captura, o guarda así.' : 'Si guardas así, la tabla de la liga puede salir con errores.'}`,
      confirmLabel: "Guardar igual",
      danger: false
    });
    if (!ok) this.openScanReview();
    return ok;
  },

  async saveManualTournament() {
    const val = (id) => (document.getElementById(id)?.value ?? '').trim();
    // A table for a tournament the person already saved is added to it and nothing else: no form to fill, no second copy of the tournament.
    const saved = this.scanTarget();
    if (saved) {
      await this.mergeIntoSaved(saved);
      return;
    }
    this.clearFieldErrors();
    this.setStatus('');
    if (this._recordConflict) {
      this.setStatus('Antes de guardar, elige tu récord: el de tu cuenta ronda a ronda o el de la captura.', "var(--color-bad)");
      document.getElementById("round-conflict")?.focus();
      return;
    }
    const errors = [];
    const fail = (inputId, message, errId) => errors.push(this.fieldError(inputId, message, errId));

    // Date: required, never in the future
    const dateVal = val("log-date");
    if (!dateVal) fail("log-date", "Elige la fecha del torneo.");
    else if (dateVal > localIsoDate()) fail("log-date", "La fecha no puede ser futura. Revisa el día del torneo.");

    // Deck
    let selectedDeck = val("log-deck");
    if (selectedDeck === "other") {
      if (!val("log-custom-deck")) fail("log-custom-deck", "Escribe el nombre del mazo.");
      selectedDeck = this.formDeck();
      // A deck that reads the same in the lists as one already there is that deck: a second one would split its numbers.
      const twin = selectedDeck && State.decksList.find(deck => deck !== selectedDeck && deckInfo(deck).name.toLowerCase() === deckInfo(selectedDeck).name.toLowerCase());
      if (twin) fail("log-custom-deck", `Ya tienes un mazo llamado «${deckInfo(twin).name}»: elígelo en la lista «Mazo jugado».`);
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

    // The table the scan read goes with the tournament, but never on trust: rows that still need a look ask first, and a
    // row without points cannot be added up, so it is left out (and the person is told).
    const tableRows = this._scanned.filter(row => this.scannedRowIsComplete(row));
    const omitted = this._scanned.length - tableRows.length;
    if (!(await this.confirmDoubtfulRows())) return;
    const [y, m, dayNum] = dateVal.split("-").map(Number);
    const entry = {
      date: `${dayNum} ${CONFIG.MONTHS_ABBR[m - 1]}`,
      isoDate: dateVal,
      season: seasonOf(y, m),
      deck: selectedDeck,
      rank: rankVal,
      pts: ptsVal,
      wl: `${w}-${l}-${d}`,
      type: tournamentType(ptsVal),
      notes: val("log-notes")
    };
    // Only what the General tab adds up is stored: the name, the points and, when it was read cleanly, the record.
    // The rounds marked during the night go with it (see addRound): an optional field, read only through cleanRounds.
    const rounds = this.hasDraftRounds() ? cleanRounds(this._draft.rounds) : [];
    if (rounds.length) entry.rounds = rounds;
    if (tableRows.length) entry.playerResults = tableRows.map(row => (row.wl ? { name: row.name, pts: row.pts, wl: row.wl } : { name: row.name, pts: row.pts }));

    const before = this.snapshot();
    // A night made from the store's table for this day gives way to the person's own table, and brings what that one lacks: the
    // store's retos and the players the scan missed (the person's own points stay).
    const madeNight = tableRows.length ? State.historic.find(item => isStoreNight(item) && item.isoDate === dateVal) : null;
    let absorbed = null;
    if (madeNight) {
      // Who of the store's night is who in this table is the league's call (the names the person joined count).
      const same = League.who(State.historic.filter(item => item.season === entry.season), entry.playerResults.map(row => row.name));
      absorbed = League.absorb(entry.playerResults, madeNight.playerResults, same);
      entry.playerResults = absorbed.rows;
      State.historic.splice(State.historic.indexOf(madeNight), 1);
    }
    State.historic.push(entry);
    State.syncDecksList();
    State.save();
    // Undo takes the tournament out of the history, but the table took a while to check: it goes back to the form.
    const keptScan = { rows: this._scanned.map(row => ({ ...row, flags: [...row.flags] })), notes: { ...this._scanNotes }, pictures: [...this._scanPictures] };
    this.clearScannedStandings();
    const keptDraft = this._draft ? { ...this._draft, rounds: this._draft.rounds.map(round => ({ ...round })) } : null;
    this.forgetDraft();

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
    this.clearDeckColours();
    this.toggleRecordExtra(false);
    this.renderLogPreview();

    this.switchTab('pg-history');
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
    const absorbedNote = absorbed ? ` La noche de ese día creada con la tabla de la tienda se juntó con tu tabla: ${plural(absorbed.retos, 'reto', 'retos')} y ${plural(absorbed.added, 'jugador', 'jugadores')} que tu captura no traía.` : '';
    const tableNote = tableRows.length ? ` Tabla de ${plural(tableRows.length, 'jugador', 'jugadores')} guardada.${omitted ? ` ${omitted === 1 ? '1 fila sin puntos no se guardó' : `${omitted} filas sin puntos no se guardaron`}.` : ''}` : '';
    this.notify(`Torneo guardado: ${deckInfo(selectedDeck).name} · ${entry.wl} · ${ptsVal} pts.${effect}${tableNote}${absorbedNote}`, {
      action: {
        label: 'Deshacer',
        run: () => {
          this.restoreSnapshot(before);
          if (keptDraft) { State.saveDraft(keptDraft); this.applyDraft(keptDraft); }
          if (keptScan.rows.length) {
            this._scanned = keptScan.rows;
            this._scanNotes = keptScan.notes;
            this._scanPictures = keptScan.pictures || [];
            this.renderScanned();
            this.renderLogPreview();
          }
          this.notify(keptScan.rows.length ? 'Torneo deshecho. La tabla leída sigue en Registrar por si lo guardas de nuevo.' : 'Torneo deshecho. Puedes registrarlo de nuevo cuando quieras.');
        }
      }
    });
  },
  // ─────────────────────────────────────────────────────────────
  // ROUND BY ROUND: the night marked as it is played, kept as a draft on the device until the tournament is saved
  // ─────────────────────────────────────────────────────────────
  // The draft is { date, deck, rounds: [{ r: 'W'|'L'|'D', vs }] } (State.loadDraft / saveDraft). Every change is written at
  // once, so closing the app on the night loses nothing. The rounds fill the record fields; the screenshot, read at the end,
  // fills only what it alone knows (the place and the printed points), and when its record says otherwise the person picks
  // (`_recordConflict`): nothing is saved until they do.
  _draft: null,
  _draftPending: null,
  _roundEdit: -1,
  _recordConflict: null,
  _scanPts: null,
  ROUND_WORDS: { W: 'Gané', L: 'Perdí', D: 'Empaté', B: 'Bye' },

  // Focus on the first button of the next round ("Gané"): the label beside it is text and cannot take focus.
  focusRoundButtons() {
    document.querySelector("#rounds-panel .rounds-body > .preset-records button")?.focus();
  },

  hasDraftRounds() {
    return !!(this._draft && this._draft.rounds.length);
  },

  roundsRecord(rounds = this._draft ? this._draft.rounds : []) {
    // A bye is a win: 3 points, and a win in the record, as the standings screen counts it.
    return { w: rounds.filter(round => round.r === 'W' || round.r === 'B').length, l: rounds.filter(round => round.r === 'L').length, d: rounds.filter(round => round.r === 'D').length };
  },

  recordText({ w, l, d }) {
    return `${w}-${l}-${d}`;
  },

  // On opening (and on leaving the test mode, or after a wipe): a draft of today is simply put back; one of another day is
  // offered, since the person may have forgotten to save it.
  restoreDraft() {
    this._draft = null;
    this._draftPending = null;
    this._roundEdit = -1;
    this._recordConflict = null;
    this._scanPts = null;
    const draft = State.loadDraft();
    if (draft && draft.rounds.length) {
      if (draft.date && draft.date !== localIsoDate()) this._draftPending = draft;
      else this.applyDraft(draft);
    }
    this.renderRounds();
    this.renderConflict();
  },

  applyDraft(draft) {
    this._draft = { date: draft.date, deck: draft.deck, rounds: draft.rounds.map(round => ({ ...round })), done: draft.done === true };
    this._draftPending = null;
    const date = document.getElementById("log-date");
    if (date && draft.date) date.value = draft.date;
    const deck = document.getElementById("log-deck");
    if (deck && draft.deck && State.decksList.includes(draft.deck)) { deck.value = draft.deck; this._deckPicked = true; this.syncCustomDeckGroup(); }
    document.getElementById("rounds-panel").open = true;
    this.syncRoundsToForm();
    this.renderRounds();
  },

  resumeDraft() {
    if (!this._draftPending) return;
    this.applyDraft(this._draftPending);
    this.focusRoundButtons();
  },

  async discardDraft() {
    const draft = this._draftPending || this._draft;
    if (!draft) return;
    this.forgetDraft();
    ["log-w", "log-l", "log-d", "log-pts"].forEach(id => { const field = document.getElementById(id); if (field) field.value = ''; });
    this.renderLogPreview();
    this.focusRoundButtons();
    this.notify(`Se descartó la cuenta de ${plural(draft.rounds.length, 'ronda', 'rondas')}.`, {
      action: { label: 'Deshacer', run: () => { State.saveDraft(draft); this.applyDraft(draft); this.notify('La cuenta de rondas volvió.'); } }
    });
  },

  // The draft goes (saved as a tournament, or thrown away).
  forgetDraft() {
    this._draft = null;
    this._draftPending = null;
    this._roundEdit = -1;
    this._recordConflict = null;
    this._scanPts = null;
    State.saveDraft(null);
    this.renderRounds();
    this.renderConflict();
  },

  persistDraft() {
    if (!this._draft) return;
    const date = document.getElementById("log-date")?.value || '';
    this._draft.date = isIsoDate(date) ? date : this._draft.date;
    const deck = this.formDeck();
    if (deck && deck !== 'other') this._draft.deck = deck;
    State.saveDraft(this._draft);
  },

  // A night has as many rounds as people came (three, four, five): the person says when it is over. The rounds stop being asked
  // for, the night is summed up, and the next step is offered: the screenshot for the place and the points, then Guardar. A round
  // can still be changed, and "Agregar otra ronda" opens the night again.
  endNight() {
    if (!this.hasDraftRounds()) return;
    this._draft.done = true;
    this._roundEdit = -1;
    this.persistDraft();
    this.renderRounds();
    document.getElementById("rounds-done")?.focus();
  },

  reopenNight() {
    if (!this._draft) return;
    this._draft.done = false;
    this.persistDraft();
    this.renderRounds();
    this.focusRoundButtons();
  },

  // From the end of the night straight to the screenshot: the scan panel opens and the file picker with it.
  pickNightScreenshot() {
    if (document.getElementById("ocr-trigger")?.getAttribute("aria-expanded") !== "true") this.toggleOcrAccordion();
    const input = document.getElementById("ocr-file");
    if (!input) return;
    input.scrollIntoView({ block: 'center' });
    input.click();
  },

  addRound(result) {
    if (this._draft && this._draft.done) return;
    if (this._draftPending) { this.setStatus('Primero continúa o descarta la noche sin terminar de arriba.', "var(--color-bad)"); return; }
    if (!this._draft) this._draft = { date: null, deck: '', rounds: [] };
    if (this._draft.rounds.length >= 9) { this.setStatus('Un torneo de más de 9 rondas parece un error: revisa las que marcaste.', "var(--color-bad)"); return; }
    this._draft.rounds.push({ r: result, vs: '' });
    // A bye has no opponent to write: the round is done, and the next one is ready.
    this._roundEdit = result === 'B' ? -1 : this._draft.rounds.length - 1;
    this.persistDraft();
    this.syncRoundsToForm();
    this.renderRounds();
    // Otherwise straight to the opponent's deck: it is the next thing to write, and "Listo" leaves it blank.
    if (result === 'B') this.focusRoundButtons(); else document.getElementById("round-vs")?.focus();
  },

  editRound(index) {
    if (!this._draft || !this._draft.rounds[index]) return;
    this._roundEdit = index;
    this.renderRounds();
    document.getElementById("round-vs")?.focus();
  },

  setRoundResult(result) {
    const round = this._draft && this._draft.rounds[this._roundEdit];
    if (!round) return;
    round.r = result;
    if (result === 'B') round.vs = '';
    this.persistDraft();
    this.syncRoundsToForm();
    this.renderRounds();
  },

  setRoundDeck(value) {
    const round = this._draft && this._draft.rounds[this._roundEdit];
    if (!round || round.r === 'B') return;
    round.vs = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    this.persistDraft();
    this.renderRoundList();
  },

  // The decks already played against, as buttons: one tap writes the rival and closes the round, so the same name is never typed
  // again (and never spelled two ways). Most played first; while typing, only the ones that contain what is typed.
  opponentPicks(typed = '') {
    const counts = new Map();
    const add = (round) => {
      if (!round.vs) return;
      const key = round.vs.toLowerCase();
      if (!counts.has(key)) counts.set(key, { vs: round.vs, n: 0 });
      counts.get(key).n++;
    };
    State.historic.forEach(entry => cleanRounds(entry.rounds).forEach(add));
    // The round being written is not a suggestion for itself.
    (this._draft ? this._draft.rounds : []).forEach((round, i) => { if (i !== this._roundEdit) add(round); });
    const needle = String(typed || '').trim().toLowerCase();
    return [...counts.values()]
      .filter(item => !needle || item.vs.toLowerCase().includes(needle))
      .sort((a, b) => (b.n - a.n) || a.vs.localeCompare(b.vs, 'es'))
      .slice(0, this.VS_PICKS);
  },
  VS_PICKS: 8,

  renderVsPicks(typed) {
    const host = document.getElementById("round-vs-picks");
    const round = this._draft && this._draft.rounds[this._roundEdit];
    if (!host) return;
    const picks = round && round.r !== 'B' ? this.opponentPicks(typed) : [];
    host.hidden = !picks.length;
    const current = round ? round.vs.toLowerCase() : '';
    host.innerHTML = !picks.length ? '' : `<span class="rounds-next" id="round-vs-picks-label">${typed && typed.trim() ? 'Coinciden:' : 'Ya jugaste contra:'}</span>`
      + picks.map(item => `<button class="preset-chip js-vs-pick" data-vs="${esc(item.vs)}" type="button" onclick="Arena.pickOpponent(this.dataset.vs)" aria-pressed="${item.vs.toLowerCase() === current}">${esc(item.vs)}</button>`).join('');
  },

  pickOpponent(vs) {
    const input = document.getElementById("round-vs");
    if (input) input.value = vs;
    this.setRoundDeck(vs);
    this.closeRoundEditor();
  },

  closeRoundEditor() {
    const at = this._roundEdit;
    this._roundEdit = -1;
    this.renderRounds();
    const back = document.querySelectorAll("#rounds-list .js-round-item")[at];
    if (back) back.focus(); else this.focusRoundButtons();
  },

  removeRound() {
    if (!this._draft || !this._draft.rounds[this._roundEdit]) return;
    this._draft.rounds.splice(this._roundEdit, 1);
    this._roundEdit = -1;
    if (!this._draft.rounds.length) {
      this.forgetDraft();
      ["log-w", "log-l", "log-d", "log-pts"].forEach(id => { const field = document.getElementById(id); if (field) field.value = ''; });
      this.renderLogPreview();
    } else {
      this.persistDraft();
      this.syncRoundsToForm();
      this.renderRounds();
    }
    this.focusRoundButtons();
  },

  // The rounds are the record. Points follow it, unless the screenshot printed others (special events score differently).
  syncRoundsToForm() {
    if (!this.hasDraftRounds()) return;
    const { w, l, d } = this.roundsRecord();
    this.setRecordPreset(w, l, d);
    if (this._scanPts !== null) {
      document.getElementById("log-pts").value = this._scanPts;
      this.renderLogPreview();
    }
    // Fixing a round so the two records agree settles the question by itself.
    if (this._recordConflict && this.recordText(this._recordConflict.theirs) === this.recordText({ w, l, d })) this._recordConflict = null;
    this.renderConflict();
  },

  // What the screenshot says of the person's own row, while rounds are being kept: its place and points go in the form (done by
  // fillFormFromRow), its record is only compared.
  noteScanRecord(record, pts) {
    if (pts !== null && pts !== undefined) this._scanPts = pts;
    const mine = this.roundsRecord();
    this._recordConflict = record && this.recordText(record) !== this.recordText(mine) ? { theirs: { w: record.w, l: record.l, d: record.d } } : null;
    this.renderConflict();
  },

  useMyRecord() {
    if (!this._recordConflict) return;
    this._recordConflict = null;
    this.renderConflict();
    this.setStatus(`Se guardará tu cuenta: ${this.recordText(this.roundsRecord())}.`, "var(--text-secondary)");
    document.querySelector(".js-save-button")?.focus();
  },

  useScanRecord() {
    if (!this._recordConflict) return;
    const { w, l, d } = this._recordConflict.theirs;
    this._recordConflict = null;
    this.setRecordPreset(w, l, d);
    if (this._scanPts !== null) document.getElementById("log-pts").value = this._scanPts;
    this.renderLogPreview();
    this.renderConflict();
    this.setStatus(`Se guardará el récord de la captura: ${w}-${l}-${d}. Tus rondas se guardan como las marcaste.`, "var(--text-secondary)");
    document.querySelector(".js-save-button")?.focus();
  },

  renderConflict() {
    const box = document.getElementById("round-conflict");
    if (!box) return;
    const conflict = this._recordConflict;
    box.hidden = !conflict;
    if (!conflict) { box.innerHTML = ''; return; }
    const mine = this.recordText(this.roundsRecord()), theirs = this.recordText(conflict.theirs);
    box.innerHTML = `<p class="round-conflict-text">Tu cuenta ronda a ronda dice <strong>${mine}</strong> y la captura dice <strong>${theirs}</strong>. ¿Cuál es tu récord de esta noche? Si marcaste mal una ronda, corrígela arriba y esto se resuelve solo.</p>`
      + `<div class="btn-row"><button class="btn btn-secondary" type="button" onclick="Arena.useMyRecord()">Usar la mía (${mine})</button>`
      + `<button class="btn btn-secondary" type="button" onclick="Arena.useScanRecord()">Usar la de la captura (${theirs})</button></div>`;
  },

  // The opponent decks the person has written before, for the field's suggestions: theirs alone, nothing shipped with the app.
  opponentDecks() {
    const seen = new Map();
    State.historic.forEach(entry => cleanRounds(entry.rounds).forEach(round => { if (round.vs && !seen.has(round.vs.toLowerCase())) seen.set(round.vs.toLowerCase(), round.vs); }));
    (this._draft ? this._draft.rounds : []).forEach(round => { if (round.vs && !seen.has(round.vs.toLowerCase())) seen.set(round.vs.toLowerCase(), round.vs); });
    return [...seen.values()].sort((a, b) => a.localeCompare(b, 'es'));
  },

  renderRoundList() {
    const list = document.getElementById("rounds-list");
    if (!list) return;
    const rounds = this._draft ? this._draft.rounds : [];
    list.innerHTML = rounds.map((round, i) => `<li><button class="round-item js-round-item${i === this._roundEdit ? ' is-editing' : ''}" type="button" onclick="Arena.editRound(${i})" aria-label="Ronda ${i + 1}: ${this.ROUND_WORDS[round.r]}${round.r === 'B' ? ', sin rival' : (round.vs ? `, contra ${esc(round.vs)}` : ', rival sin anotar')}. Cambiarla">`
      + `<span class="round-n">R${i + 1}</span><i class="dot ${round.r === 'W' || round.r === 'B' ? 'win' : (round.r === 'L' ? 'loss' : 'draw')}" aria-hidden="true"></i><span class="round-result">${this.ROUND_WORDS[round.r]}</span>`
      + `<span class="round-vs">${round.r === 'B' ? 'sin rival (3 pts)' : (round.vs ? `vs ${esc(round.vs)}` : 'rival sin anotar')}</span></button></li>`).join('');
  },

  renderRounds() {
    const panel = document.getElementById("rounds-panel");
    if (!panel) return;
    const rounds = this._draft ? this._draft.rounds : [];
    const resume = document.getElementById("rounds-resume");
    const pending = this._draftPending;
    resume.hidden = !pending;
    if (pending) {
      panel.open = true;
      const day = pending.date ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(Analytics.parseDate(pending.date)) : 'otro día';
      resume.innerHTML = `<p class="round-conflict-text">Tienes una noche sin guardar del ${esc(day)}: ${plural(pending.rounds.length, 'ronda', 'rondas')} (${this.recordText(this.roundsRecord(pending.rounds))}).</p>`
        + `<div class="btn-row"><button class="btn btn-secondary" type="button" onclick="Arena.resumeDraft()">Continuar esa noche</button><button class="btn btn-secondary" type="button" onclick="Arena.discardDraft()">Descartarla</button></div>`;
    } else resume.innerHTML = '';
    this.renderRoundList();
    const record = this.roundsRecord();
    // The night is over: no more rounds are asked for, and what comes next is said.
    const done = !!(this._draft && this._draft.done && rounds.length);
    document.getElementById("rounds-add").hidden = done;
    document.getElementById("rounds-end").hidden = done || !rounds.length;
    const doneBox = document.getElementById("rounds-done");
    doneBox.hidden = !done;
    doneBox.innerHTML = !done ? '' : `<p class="round-conflict-text"><strong>Noche terminada:</strong> ${plural(rounds.length, 'ronda', 'rondas')} · ${this.recordText(record)} · ${record.w * 3 + record.d} pts. Ahora sube la captura de la tabla para tu puesto y los puntos oficiales, o guarda el torneo si no la tienes.</p>`
      + `<div class="btn-row"><button class="btn btn-primary" type="button" onclick="Arena.pickNightScreenshot()">Subir la captura</button><button class="btn btn-secondary" type="button" onclick="Arena.reopenNight()">Agregar otra ronda</button></div>`;
    document.getElementById("rounds-next").textContent = rounds.length
      ? `Ronda ${rounds.length + 1} (vas ${this.recordText(record)}):`
      : 'Ronda 1:';
    const editor = document.getElementById("rounds-editor");
    const round = rounds[this._roundEdit];
    editor.hidden = !round;
    if (round) {
      document.getElementById("round-edit-title").textContent = `Ronda ${this._roundEdit + 1}:`;
      document.getElementById("round-vs-label").textContent = `Mazo del rival en la ronda ${this._roundEdit + 1}`;
      // A bye has no rival: the field goes while the round is one.
      document.getElementById("round-vs").closest(".field").hidden = round.r === 'B';
      const input = document.getElementById("round-vs");
      if (document.activeElement !== input) input.value = round.vs;
      editor.querySelectorAll(".js-round-result").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.r === round.r)));
      document.getElementById("round-vs-list").innerHTML = this.opponentDecks().map(name => `<option value="${esc(name)}"></option>`).join('');
    }
    this.renderVsPicks(round && document.activeElement === document.getElementById("round-vs") ? document.getElementById("round-vs").value : '');
  },
});
