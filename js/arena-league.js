// Arena: the General tab (how the league is going and where you stand) and the table the scan reads.
/* global CONFIG, State, Analytics, League, nf0, nf1, plural, esc, seasonOf, deckInfo, isStoreNight, TRASH_ICON, Arena */

Object.assign(Arena, {
  // The standings the scan read, held until the tournament is saved: [{ name, pts, wl, flags }], and what it noted about them.
  _scanned: [],
  _scanNotes: { missing: 0, places: [] },
  // Counts every time the scan is dropped or replaced, so a read that finishes late can tell it is out of date.
  _scanRun: 0,
  // Which picture is being read when there are several (" 1 de 2"), for the progress line.
  _ocrPart: '',

  // ─────────────────────────────────────────────────────────────
  // GENERAL TAB
  // ─────────────────────────────────────────────────────────────
  // The league is counted per season: with every season on screen, it shows today's.
  leagueSeason() {
    return this.currentFilterSeason === 'all' ? CONFIG.CURRENT_SEASON : this.currentFilterSeason;
  },

  // Building the table is the costliest thing the app does, so it is only built while the tab is on screen: switching to
  // the tab builds it, and every redraw after a change while the tab is open builds it again.
  renderLeague() {
    if (!document.getElementById("pg-league")?.classList.contains("is-active")) return;
    const season = this.leagueSeason();
    const entries = State.historic.filter(item => item.season === season);
    const table = League.standings(entries, State.topFor(season));
    const outlook = this.leagueOutlook(season, table);
    // Who is already decided goes on the players, so the summary, the card and the table all read the same marks.
    if (outlook.marks) table.players.forEach((player, i) => { player.mark = outlook.marks[i]; });
    this.renderLeagueSummary(season, entries, table);
    this.renderLeagueAsk(season);
    this.renderLeagueRisk(season, table, outlook);
    this.renderMonth();
    this.renderLeagueBoard(season, table);
  },

  // The sentence that answers "how am I doing", and the four numbers under it.
  renderLeagueSummary(season, entries, table) {
    const top = table.top;
    const { me } = table;
    const mine = Analytics.getAllDeckStats(entries).filter(d => d.count > 0);
    // What the store counts for the person is their nights and the retos (side quests) it gave them on those nights. A night that
    // exists only as the store's table (the person saved no tournament that day) brings its points through the table.
    const myRetos = me ? me.retoPts : 0;
    const myPts = mine.reduce((sum, d) => sum + d.totalPts, 0) + (me ? me.storePts : 0) + myRetos;
    const myCount = mine.reduce((sum, d) => sum + d.count, 0) + (me ? me.storeNights : 0);
    const inside = !!me && table.cutPts !== null && me.rank <= top;
    // Tied on the line with others for the last places: the table cannot say who gets them.
    const onLine = inside && table.tied && me.pts === table.cutPts;

    // Distance to the cut line: what is missing from outside it, or what is spare inside it.
    let cutLabel = `Para el top ${top}`, cutValue = '—', cutNote = 'Aún sin tu puesto en la tabla', cutClass = 'dash';
    if (me && table.cutPts === null) {
      cutNote = `Hacen falta ${top} jugadores en la tabla`;
    } else if (me && inside) {
      cutLabel = `Sobre el top ${top}`;
      if (onLine) {
        cutValue = '0 pts';
        cutNote = 'empatado en la línea: decide el desempate';
        cutClass = '';
      } else if (table.nextPts !== null) {
        cutValue = `+${nf0.format(me.pts - table.nextPts)} pts`;
        cutNote = `de ventaja sobre quien queda fuera (${nf0.format(table.nextPts)} pts)`;
        cutClass = 'win-rate-good';
      } else {
        cutNote = `Hay justo ${top} jugadores en la tabla`;
      }
    } else if (me) {
      cutValue = `${nf0.format(table.cutPts - me.pts)} pts`;
      cutNote = `te faltan · el ${top}° tiene ${nf0.format(table.cutPts)}`;
      cutClass = '';
    }

    const kpi = (label, value, note, cls) =>
      `<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value ${cls || ''}">${value}</div><div class="kpi-note">${note}</div></div>`;
    const kpis = document.getElementById("league-kpis");
    if (kpis) {
      kpis.innerHTML =
        kpi('Tu puesto', me ? `${me.rank}°` : '—',
          me ? `de ${plural(table.players.length, 'jugador', 'jugadores')}` : (table.players.length ? 'No aparece tu nombre' : 'Sin tabla guardada'),
          me ? '' : 'dash') +
        kpi('Tus puntos', myCount ? nf0.format(myPts) : '—',
          myCount ? `${plural(myCount, 'torneo', 'torneos')} · ${nf1.format((myPts - myRetos) / myCount)} por torneo${myRetos ? ` · ${nf0.format(myRetos)} de retos` : ''}` : 'Sin torneos',
          myCount ? '' : 'dash') +
        kpi(cutLabel, cutValue, cutNote, cutClass) +
        this.seasonCountdownCard();
    }

    const sub = document.getElementById("league-sub");
    if (!sub) return;
    let html;
    if (!table.players.length) {
      html = `Aún no hay una tabla de la liga en ${esc(season)}: por ahora ves solo tus números.`;
    } else if (!me) {
      html = `La tabla de ${esc(season)} tiene ${plural(table.players.length, 'jugador', 'jugadores')}, pero no encuentro tu nombre entre ellos. ${State.profile.name ? 'Revísalo' : 'Escríbelo'} en «Tu liga», dentro de Historial.`;
    } else if (table.cutPts === null) {
      html = `Vas <strong class="emphasis">${me.rank}°</strong> con <strong class="emphasis">${nf0.format(me.pts)} pts</strong> entre ${plural(table.players.length, 'jugador', 'jugadores')}. El top ${top} se marca cuando la tabla tenga ${top}.`;
    } else if (inside) {
      html = `Vas <strong class="emphasis">${me.rank}°</strong> con <strong class="emphasis">${nf0.format(me.pts)} pts</strong>: ${onLine ? 'empatado en la línea del' : 'dentro del'} top ${top} de ${esc(season)}.`;
    } else {
      html = `Vas <strong class="emphasis">${me.rank}°</strong> con <strong class="emphasis">${nf0.format(me.pts)} pts</strong>, a <strong class="emphasis">${nf0.format(table.cutPts - me.pts)} pts</strong> del top ${top} de ${esc(season)}.`;
    }
    if (me && me.mark === 'in') html += ` Ya estás asegurado: nadie puede dejarte fuera.`;
    if (me && me.mark === 'out') html += ` Ya no alcanzas el top ${top}, ni ganando todo lo que queda.`;
    if (this.currentFilterSeason === 'all') html += ` Con todas las temporadas a la vista, aquí se muestra la actual.`;
    sub.innerHTML = html;
  },

  renderLeagueBoard(season, table) {
    const el = document.getElementById("league-board");
    if (!el) return;
    if (!table.players.length) {
      el.innerHTML = `<div class="card card-pad first-run"><h2 class="first-run-title">Aún no hay tabla en ${esc(season)}</h2><p class="first-run-text">En Registrar, abre «Opcional: escanear captura de standings» y sube la captura del torneo, o sube las capturas de la tabla del mes de la tienda en la tarjeta de arriba. La app guarda los puntos de todos los jugadores y los suma por temporada.</p><button class="btn btn-primary" type="button" onclick="Arena.switchTab('pg-logger')">Registrar un torneo</button></div>`;
      return;
    }

    const top = table.top;
    const row = (p) => {
      const sub = [plural(p.nights, 'torneo', 'torneos'), p.withRecord ? `${p.w}-${p.l}-${p.d}` : '', p.retoPts ? `${nf0.format(p.retoPts)} de retos` : ''].filter(Boolean).join(' · ');
      const decided = p.mark === 'in' ? '<span class="pill good">Clasificado</span>' : (p.mark === 'out' ? '<span class="pill good">Eliminado</span>' : '');
      return `<li class="board-row js-board-row ${p.isMe ? 'is-me' : ''} ${p.mark === 'in' ? 'is-clinched' : (p.mark === 'out' ? 'is-out' : '')}"${p.isMe ? ' aria-current="true"' : ''}>`
        + `<span class="board-rank">${p.rank}°</span>`
        + `<div class="board-main"><div class="board-name"><span class="title-text">${esc(p.name)}</span>${p.isMe ? '<span class="pill">Tú</span>' : ''}${decided}</div><div class="board-sub">${sub}</div></div>`
        + `<b class="board-pts">${nf0.format(p.pts)}<small class="board-unit"> pts</small></b></li>`;
    };
    const list = (players, cls = '') => `<ol class="board ${cls}">${players.map(row).join('')}</ol>`;
    const cut = table.cutPts !== null;
    // The line falls after the last place within the cut, so players tied on it are all above it, as the summary says.
    const above = table.players.filter(p => p.rank <= top);
    const below = table.players.filter(p => p.rank > top);
    // What the table adds up: the person's tournaments that have a table, and the nights made from the store's monthly table.
    const own = table.nights - table.stored;
    const sum = [own ? `${plural(own, 'torneo', 'torneos')} con tabla guardada` : '', table.stored ? `${plural(table.stored, 'noche creada', 'noches creadas')} con la tabla del mes de la tienda` : ''].filter(Boolean).join(' y ');
    const covered = table.captured >= table.played
      ? `Suma ${sum}.`
      : `Suma ${sum}, de ${table.played} que jugaste. Los demás no traen captura y no cuentan aquí.`;

    const anyDecided = table.players.some(p => p.mark);
    el.innerHTML = `<section class="card board-card" aria-labelledby="h-board">`
      + `<div class="card-head"><h2 id="h-board">Tabla de la liga</h2><span class="sec-meta">${esc(season)} · ${plural(table.players.length, 'jugador', 'jugadores')} · clasifican ${top}</span></div>`
      + `<p class="board-note">${covered}</p>`
      + (anyDecided ? `<p class="board-note">En verde, los que ya están decididos: «Clasificado», nadie puede dejarlo fuera; «Eliminado», no entra ni ganando todo lo que queda.</p>` : '')
      + (cut
        ? list(above, 'in-top') + `<p class="board-cut"><span>Top ${top} · clasificados</span></p>` + (below.length ? list(below) : '')
        : list(table.players))
      + `</section>`;
  },

  // ─────────────────────────────────────────────────────────────
  // THE TABLE THE SCAN READ (held in the Registrar form until the tournament is saved)
  // ─────────────────────────────────────────────────────────────
  // The players the season's table already has, for the season of the tournament being logged: a scan is checked against them.
  knownPlayers() {
    const iso = (document.getElementById("log-date")?.value ?? '');
    const season = /^\d{4}-\d{2}/.test(iso) ? seasonOf(Number(iso.slice(0, 4)), Number(iso.slice(5, 7))) : CONFIG.CURRENT_SEASON;
    return League.standings(State.historic.filter(item => item.season === season)).players.map(player => player.name);
  },

  // What each warning on a scanned row tells the person who reads it.
  FLAG_TEXT: {
    noname: () => 'Escribe el nombre y los puntos de este jugador.',
    nopts: () => 'No se pudieron leer sus puntos. Escríbelos o quita la fila.',
    estimated: () => 'Sus puntos se deducen de las filas vecinas, que tienen los mismos. Compruébalos.',
    mismatch: (row) => `La captura dice ${row.pts} pts, pero con su récord serían ${row.calcPts}. Puede ser un evento con puntuación especial.`,
    order: () => 'Sus puntos no encajan con los de las filas vecinas: la lista va de más a menos.',
    rank: () => 'Su puesto baja respecto al de la fila de arriba: puede faltar un dígito.',
    record: () => 'Su récord suma más partidas que rondas tiene el torneo y se descartó.',
    short: () => 'Su récord suma menos partidas que las rondas del torneo (¿se retiró?) y sus puntos salen de ese récord. Compruébalos.',
    new: () => 'La liga no había visto este nombre: puede ser un jugador nuevo o un nombre mal leído.',
    conflict: (row) => `Otra captura da ${row.otherPts} pts a este jugador; se dejó lo que ya había. Revisa cuál es el correcto.`,
    place: () => 'Otro jugador aparece con este mismo puesto en otra captura: revisa que sean del mismo torneo.'
  },

  setScannedStandings(scan) {
    this._scanned = scan.rows.map(row => ({ ...row, flags: [...row.flags] }));
    this._scanNotes = { missing: scan.missing, places: scan.missingPlaces || [] };
    // Anything doubtful opens the list by itself: a table is never saved on trust.
    this.renderScanned(this._scanned.some(row => row.flags.length) || scan.missing > 0);
  },

  // A row that can be added up needs a name and points.
  scannedRowIsComplete(row) {
    return row.pts !== null && League.nameKey(row.name) !== '';
  },

  // What the save bar says about the table: how many players go with the tournament, and how many still need a look.
  scannedSummary() {
    if (!this._scanned.length) return '';
    const usable = this._scanned.filter(row => this.scannedRowIsComplete(row)).length;
    const doubtful = this._scanned.filter(row => row.flags.length).length;
    return `tabla de ${plural(usable, 'jugador', 'jugadores')}${doubtful ? `, ${doubtful} por revisar` : ''}`;
  },

  // A copy of the table read, to put it back.
  keepScanned() {
    return { rows: this._scanned.map(row => ({ ...row, flags: [...row.flags] })), notes: { ...this._scanNotes, places: [...(this._scanNotes.places || [])] } };
  },

  // Puts a kept table back (Deshacer), and opens the list so the person sees it.
  restoreScanned(kept) {
    this._scanRun++;
    this._scanned = kept.rows.map(row => ({ ...row, flags: [...row.flags] }));
    this._scanNotes = { ...kept.notes };
    this.renderScanned(true);
    this.renderLogPreview();
    this.notify('Tabla recuperada.');
  },

  // reason: why the table goes. true = the person pressed "Descartar la tabla" (so say what the tournament will carry instead);
  // 'file' = they chose another picture. Either way what they checked can be had back with Deshacer. With no reason the caller
  // keeps its own copy (saving the tournament, adding the table to a saved one).
  clearScannedStandings(reason) {
    this._scanRun++;
    this.toggleIdentify(false);
    if (!this._scanned.length) return;
    const kept = reason ? this.keepScanned() : null;
    this._scanned = [];
    this._scanNotes = { missing: 0, places: [] };
    this.renderScanned();
    this.renderLogPreview();
    if (reason === true) this.setStatus('Tabla descartada: el torneo se guardará solo con tu resultado.', 'var(--text-secondary)');
    if (kept) {
      const what = `la tabla leída de ${plural(kept.rows.length, 'jugador', 'jugadores')}`;
      this.notify(reason === 'file' ? `Elegiste otra captura: se descartó ${what}.` : `Se descartó ${what}.`, {
        action: { label: 'Deshacer', run: () => this.restoreScanned(kept) }
      });
    }
  },

  // button: where the row sat in the list on screen, so focus stays in the list afterwards (the list shows doubtful rows first).
  removeScannedPlayer(index, button) {
    const at = [...document.querySelectorAll("#ocr-found-list .js-remove-scanned")].indexOf(button);
    const kept = this.keepScanned();
    const name = this._scanned[index] ? this._scanned[index].name : '';
    this._scanned.splice(index, 1);
    this.renderScanned();
    this.renderLogPreview();
    const buttons = document.querySelectorAll("#ocr-found-list .js-remove-scanned");
    const next = buttons[at] || buttons[buttons.length - 1] || document.getElementById("ocr-trigger");
    if (next) next.focus({ preventScroll: true });
    this.notify(`Se quitó ${name ? `a ${name}` : 'una fila'} de la tabla leída.`, {
      action: { label: 'Deshacer', run: () => this.restoreScanned(kept) }
    });
  },

  // A name or a figure the person typed replaces what the scan read, and the row's warnings go: they have looked at it.
  // The only warning that stays is a missing figure, because a row without points cannot be saved.
  editScanned(index, field, input) {
    const row = this._scanned[index];
    const item = input.closest(".ocr-row");
    if (!row || !item) return;
    if (field === 'name') {
      const name = League.cleanName(input.value);
      if (!League.nameKey(name)) {
        input.value = row.name;
        return;
      }
      row.name = name;
      input.value = name;
      item.querySelector(".ocr-input-pts").setAttribute("aria-label", `Puntos de ${name}`);
      item.querySelector(".js-remove-scanned").setAttribute("aria-label", `Quitar a ${name} de la tabla leída`);
    } else {
      const text = input.value.trim();
      const n = Number(text);
      const valid = text !== '' && Number.isInteger(n) && n >= 0 && n <= League.MAX_PTS;
      row.pts = valid ? n : null;
      row.calculated = false;
      if (valid) input.removeAttribute("aria-invalid");
      else input.setAttribute("aria-invalid", "true");
    }
    row.flags = !League.nameKey(row.name) ? ['noname'] : (row.pts === null ? ['nopts'] : []);
    item.classList.toggle("is-flagged", row.flags.length > 0);
    const why = row.flags.map(flag => this.FLAG_TEXT[flag](row)).join(' ');
    // The warning is tied to both fields of the row, so a screen reader says why when it lands on either.
    const note = item.querySelector(".ocr-flag");
    const fields = item.querySelectorAll(".ocr-input");
    if (!row.flags.length) {
      if (note) note.remove();
      fields.forEach(field => field.removeAttribute("aria-describedby"));
    } else if (note) {
      note.textContent = why;
    } else {
      item.insertAdjacentHTML('beforeend', `<p class="ocr-flag" id="ocr-flag-${index}">${why}</p>`);
      fields.forEach(field => field.setAttribute("aria-describedby", `ocr-flag-${index}`));
    }
    this.updateScanSummary();
    this.renderLogPreview();
  },

  // A player the scan could not find: the person adds the row by hand, with a name and points.
  addScannedRow() {
    if (this._scanned.length >= 100) return;
    this._scanned.push({ name: '', rank: null, pts: null, wl: '', flags: ['noname'] });
    this.renderScanned(true);
    this.renderLogPreview();
    const added = document.querySelector(`[name="ocr-name-${this._scanned.length - 1}"]`);
    if (added) {
      added.scrollIntoView({ block: 'center' });
      added.focus({ preventScroll: true });
    }
  },

  // Takes the person to the table the scan read: the panel opens and focus lands on the first row that needs a look.
  openScanReview() {
    if (document.getElementById("ocr-trigger").getAttribute("aria-expanded") !== "true") this.toggleOcrAccordion();
    document.getElementById("ocr-review").open = true;
    const input = document.querySelector("#ocr-found-list .ocr-row.is-flagged .ocr-input") || document.querySelector("#ocr-found-list .ocr-input");
    if (input) {
      input.scrollIntoView({ block: 'center' });
      input.focus({ preventScroll: true });
    }
  },

  // "el puesto 5", "los puestos 1 a 17", "los puestos 4, 7 a 9 y 12": places in words, runs of places joined.
  describePlaces(places) {
    const runs = [];
    [...places].sort((a, b) => a - b).forEach(place => {
      const last = runs[runs.length - 1];
      if (last && place === last[1] + 1) last[1] = place;
      else runs.push([place, place]);
    });
    const parts = runs.map(([from, to]) => (from === to ? String(from) : (to === from + 1 ? `${from} y ${to}` : `${from} a ${to}`)));
    const text = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}` : parts[0];
    return `${places.length === 1 ? 'el puesto' : 'los puestos'} ${text}`;
  },

  // The place a table starts at when it is plainly the second part of one: the places before it are all missing, and
  // there are three or more of them. Zero when it is not.
  startsAt(rows, places) {
    const ranks = rows.map(row => row.rank).filter(rank => rank !== null);
    if (!ranks.length) return 0;
    const lowest = Math.min(...ranks);
    const before = places.filter(place => place < lowest);
    return lowest > 3 && before.length === lowest - 1 ? lowest : 0;
  },

  // What to say about places the table lacks. A table that starts at place 18 is the second half of one: what it needs is the
  // other picture, not a player added by hand.
  missingNote(places) {
    const lowest = this.startsAt(this._scanned, places);
    const rest = lowest ? places.filter(place => place > lowest) : places;
    const restNote = rest.length ? ` ${rest.length === 1 ? 'Falta' : 'Faltan'} ${this.describePlaces(rest)}: agrégal${rest.length === 1 ? 'o' : 'os'} con «Agregar jugador» o con otra captura que ${rest.length === 1 ? 'lo' : 'los'} muestre.` : '';
    if (lowest) {
      return `Esta captura empieza en el puesto ${lowest}: parece la segunda parte de una tabla. Agrega la captura que trae ${this.describePlaces(places.filter(place => place < lowest))} con «Agregar otra captura»; si no, esos jugadores no cuentan en la tabla.${restNote}`;
    }
    return `${places.length === 1 ? 'Falta' : 'Faltan'} ${this.describePlaces(places)} en la captura. Agrega ${places.length === 1 ? 'a ese jugador' : 'a esos jugadores'} con «Agregar jugador», o con otra captura que ${places.length === 1 ? 'lo' : 'los'} muestre: si no, sus puntos no cuentan en la tabla.`;
  },

  // The tournament already saved for the day in the form, if there is one: a table that is the rest of it must go to it and
  // not be saved as another night. When more than one is saved for the day, the one that already has a table.
  sameDayTournament() {
    const iso = document.getElementById("log-date")?.value ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    const season = seasonOf(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)));
    const same = State.historic.filter(item => item.isoDate === iso && item.season === season && item.deck && item.deck !== "No participó");
    return same.find(item => Array.isArray(item.playerResults) && item.playerResults.length) || same[0] || null;
  },

  // Says so in the review list when the day already has a saved tournament, and offers to add the table to it.
  renderSameDay() {
    const box = document.getElementById("ocr-same");
    if (!box) return;
    const entry = this._scanned.length ? this.sameDayTournament() : null;
    box.hidden = !entry;
    if (!entry) return;
    const n = Array.isArray(entry.playerResults) ? entry.playerResults.length : 0;
    document.getElementById("ocr-same-text").textContent = `Ya guardaste un torneo el ${entry.date} (${deckInfo(entry.deck).name}${n ? `, con una tabla de ${plural(n, 'jugador', 'jugadores')}` : ', sin tabla'}). Si estas capturas son parte de ese mismo torneo, súmalas a él: así el día cuenta una sola vez. Si son de otro torneo, guárdalo como uno nuevo.`;
  },

  // Adds the table read to the tournament already saved for that day, as one night: a player who is already there is not
  // added again, and nothing is added up. It is a tournament of its own only if the person saves it as one.
  async mergeIntoSaved() {
    const entry = this.sameDayTournament();
    if (!entry || !this._scanned.length) return;
    if (!(await this.confirmDoubtfulRows())) return;
    const incoming = this._scanned.filter(row => this.scannedRowIsComplete(row)).map(row => (row.wl ? { name: row.name, pts: row.pts, wl: row.wl } : { name: row.name, pts: row.pts }));
    if (!incoming.length) {
      this.setStatus("No hay filas con nombre y puntos para sumar.", "var(--color-bad)");
      return;
    }
    const before = this.snapshot();
    const kept = { rows: this._scanned.map(row => ({ ...row, flags: [...row.flags] })), notes: { ...this._scanNotes } };
    const merged = League.mergeStored(entry.playerResults || [], incoming);
    entry.playerResults = merged.rows;
    // A night made from the store's table for this day gives way to the tournament's own table, and brings what it lacks.
    const madeNight = State.historic.find(item => isStoreNight(item) && item.isoDate === entry.isoDate);
    if (madeNight) {
      entry.playerResults = League.absorb(entry.playerResults, madeNight.playerResults).rows;
      State.historic.splice(State.historic.indexOf(madeNight), 1);
    }
    State.save();
    this.clearScannedStandings();
    this.refreshAll();
    const moved = merged.added ? `Se sumaron ${plural(merged.added, 'jugador', 'jugadores')} al torneo del ${entry.date}` : `Esas filas ya estaban en el torneo del ${entry.date}`;
    const clash = merged.conflicts ? ` ${plural(merged.conflicts, 'jugador tenía', 'jugadores tenían')} otros puntos y se dejó lo guardado.` : '';
    this.notify(`${moved}; su tabla ahora tiene ${plural(merged.rows.length, 'jugador', 'jugadores')}.${clash}`, {
      action: {
        label: 'Deshacer',
        run: () => {
          this.restoreSnapshot(before);
          this._scanned = kept.rows;
          this._scanNotes = kept.notes;
          this.renderScanned();
          this.renderLogPreview();
          this.notify('Deshecho: la tabla volvió a la lista, sin sumarse.');
        }
      }
    });
  },

  updateScanSummary() {
    const rows = this._scanned;
    const doubtful = rows.filter(row => row.flags.length).length;
    document.getElementById("ocr-found-title").textContent = `Revisar la tabla leída: ${plural(rows.length, 'jugador', 'jugadores')}${doubtful ? ` · ${doubtful} por revisar` : ''}`;
    const notes = [];
    const { missing, places } = this._scanNotes;
    if (places.length) notes.push(this.missingNote(places));
    else if (missing) notes.push(`Parece que ${missing === 1 ? 'falta 1 fila' : `faltan ${missing} filas`}: el último puesto leído es mayor que las filas leídas. Lo que falte no cuenta en la tabla.`);
    const calculated = rows.filter(row => row.calculated).length;
    if (calculated) notes.push(`En ${plural(calculated, 'fila', 'filas')} la captura no trae los puntos y se calcularon con el récord: 3 por victoria, 1 por empate.`);
    const el = document.getElementById("ocr-found-notes");
    el.textContent = notes.join(' ');
    el.hidden = notes.length === 0;
  },

  renderScanned(open = false) {
    const box = document.getElementById("ocr-found");
    if (!box) return;
    const rows = this._scanned;
    box.hidden = rows.length === 0;
    if (!rows.length) return;
    this.updateScanSummary();
    this.renderSameDay();
    // The rows that need a look come first, so they are never down a scroll; the rest keep the order of the screen.
    const order = rows.map((row, i) => i).sort((a, b) => (rows[b].flags.length > 0) - (rows[a].flags.length > 0) || a - b);
    document.getElementById("ocr-found-list").innerHTML = order.map((i) => {
      const row = rows[i];
      const flagged = row.flags.length > 0;
      return `<li class="ocr-row ${flagged ? 'is-flagged' : ''}">`
        + `<input class="input-ctrl ocr-input" name="ocr-name-${i}" type="text" value="${esc(row.name)}" placeholder="Nombre" maxlength="60" autocomplete="off" spellcheck="false" onchange="Arena.editScanned(${i}, 'name', this)" aria-label="Nombre del jugador ${i + 1}"${flagged ? ` aria-describedby="ocr-flag-${i}"` : ''}>`
        + `<input class="input-ctrl ocr-input ocr-input-pts" name="ocr-pts-${i}" type="number" value="${row.pts === null ? '' : row.pts}" min="0" max="${League.MAX_PTS}" inputmode="numeric" autocomplete="off" onchange="Arena.editScanned(${i}, 'pts', this)" aria-label="Puntos de ${esc(row.name) || 'este jugador'}"${row.pts === null ? ' aria-invalid="true"' : ''}${flagged ? ` aria-describedby="ocr-flag-${i}"` : ''}>`
        + `<button class="btn-icon-del js-remove-scanned" type="button" onclick="Arena.removeScannedPlayer(${i}, this)" aria-label="Quitar a ${esc(row.name) || 'este jugador'} de la tabla leída">${TRASH_ICON.replace('<svg ', '<svg class="row-delete-icon" ')}</button>`
        + (flagged ? `<p class="ocr-flag" id="ocr-flag-${i}">${row.flags.map(flag => this.FLAG_TEXT[flag](row)).join(' ')}</p>` : '')
        + `</li>`;
    }).join('');
    if (open) document.getElementById("ocr-review").open = true;
  },
});
