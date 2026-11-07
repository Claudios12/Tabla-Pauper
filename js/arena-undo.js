// Arena: confirmations, undo and deleting tournaments or decks.
/* global State, Analytics, League, plural, deckInfo, isStoreNight, Arena, Gemini */

Object.assign(Arena, {
  // ─────────────────────────────────────────────────────────────
  // UNDO + CONFIRMATION
  // ─────────────────────────────────────────────────────────────
  snapshot() {
    return {
      historic: JSON.parse(JSON.stringify(State.historic)), deleted: State.deletedDecks.slice(),
      seasonEnds: { ...State.seasonEnds }, seasonTop: { ...State.seasonTop }, profile: { ...State.profile },
      nameLinks: JSON.parse(JSON.stringify(State.nameLinks))
    };
  },

  restoreSnapshot(snap) {
    State.historic = snap.historic;
    State.deletedDecks = snap.deleted;
    State.seasonEnds = snap.seasonEnds;
    State.saveSeasonEnds();
    State.seasonTop = snap.seasonTop || {};
    State.saveSeasonTop();
    State.profile = snap.profile || State.profile;
    State.saveProfile();
    if (snap.nameLinks) {
      State.nameLinks = snap.nameLinks;
      State.saveNameLinks();
    }
    League.identify(State.profile.name);
    State.saveDeletedDecks();
    State.syncDecksList();
    State.save();
    this.populateDeckPickers();
    this.refreshAll();
  },

  // A named confirmation for actions that cannot be undone quietly. Esc and Cancel keep everything as is.
  confirmDialog({ title, body, confirmLabel, danger = true }) {
    const dlg = document.getElementById("confirm-dialog");
    if (!dlg || typeof dlg.showModal !== 'function') return Promise.resolve(window.confirm(`${title}\n\n${body}`));
    document.getElementById("dlg-title").textContent = title;
    document.getElementById("dlg-body").textContent = body;
    const ok = document.getElementById("dlg-ok");
    ok.textContent = confirmLabel;
    ok.className = 'btn ' + (danger ? 'btn-danger-solid' : 'btn-primary');
    return new Promise(resolve => {
      dlg.returnValue = '';
      const onClose = () => { dlg.removeEventListener('close', onClose); resolve(dlg.returnValue === 'ok'); };
      dlg.addEventListener('close', onClose);
      dlg.showModal();
    });
  },

  deleteTournament(globalIdx, btn) {
    const item = State.historic[globalIdx];
    if (!item) return;
    // Where the delete button sits in its list, so keyboard focus stays in the list afterwards.
    const host = btn && btn.closest("#full-history-list, #deck-detail-content");
    const hostId = host ? host.id : null;
    const pos = host ? [...host.querySelectorAll(".js-delete-tournament")].indexOf(btn) : -1;

    const before = this.snapshot();
    State.historic.splice(globalIdx, 1);
    State.save();
    this.refreshAll();
    this.refocusList(hostId, pos);
    const store = isStoreNight(item);
    this.notify(store ? `Noche del ${item.date} creada con la tabla de la tienda eliminada.` : `Torneo del ${item.date} con ${deckInfo(item.deck).name} eliminado.`, {
      action: { label: 'Deshacer', run: () => { this.restoreSnapshot(before); this.refocusList(hostId, pos); this.notify(store ? 'Noche restaurada.' : 'Torneo restaurado.'); } }
    });
  },

  // After a row disappears (or comes back), focus moves to the row now in its place instead of the page top.
  // With no rows left it falls back to the page heading, the same place a tab change puts it.
  refocusList(hostId, pos) {
    const host = hostId && document.getElementById(hostId);
    if (!host || pos < 0) return;
    const buttons = host.querySelectorAll(".js-delete-tournament");
    const target = buttons[pos] || buttons[buttons.length - 1] || document.getElementById("page-title");
    if (target) target.focus({ preventScroll: true });
  },

  async deleteDeck(deckName) {
    if (!deckName) return;
    const name = deckInfo(deckName).name;
    const key = deckName.trim().toLowerCase();
    const all = State.historic.filter(i => i.deck && i.deck.trim().toLowerCase() === key);
    // The page shows one season; the deletion reaches all of them. Say both numbers.
    const inSeason = this.currentFilterSeason === 'all' ? null : all.filter(i => i.season === this.currentFilterSeason).length;
    const scope = (inSeason !== null && inSeason !== all.length) ? ` (${inSeason} en ${this.currentFilterSeason})` : '';
    let body;
    if (all.length === 0) body = 'Este mazo no tiene torneos registrados. Podrás deshacerlo unos segundos después.';
    else if (all.length === 1) body = 'Se borrará también su único torneo del historial. Podrás deshacerlo unos segundos después.';
    else body = `Se borrarán también sus ${all.length} torneos de todas las temporadas${scope}. Podrás deshacerlo unos segundos después.`;

    const ok = await this.confirmDialog({
      title: `Eliminar el mazo «${name}»`,
      body,
      confirmLabel: 'Eliminar mazo'
    });
    if (!ok) return;

    const before = this.snapshot();
    State.deleteDeck(deckName);
    this.populateDeckPickers();
    this.refreshAll();
    this.switchTab('pg-decks');
    this.notify(`Mazo «${name}» eliminado.`, {
      action: { label: 'Deshacer', run: () => { this.restoreSnapshot(before); this.notify(`Mazo «${name}» restaurado.`); } }
    });
  },

  toggleOcrAccordion() {
    const content = document.getElementById("ocr-content");
    const trigger = document.getElementById("ocr-trigger");
    if (!content || !trigger) return;
    const open = trigger.getAttribute("aria-expanded") === "true";
    trigger.setAttribute("aria-expanded", String(!open));
    content.hidden = open;
  },

  // What the scan asks Gemini for: one row per player, in the order the screen lists them, nothing invented.
  STANDINGS_PROMPT: 'Extract the MTG tournament leaderboard from this Companion app screenshot. Return ONLY a valid '
    + 'JSON array of objects, in the order the screen lists them, without any markdown formatting. Each object must '
    + 'have these exact keys: "rank" (integer, the player’s place on the screen, or null if not shown), "name" '
    + '(string, the player’s full name), "points" (integer, or null if not shown), and "wld" (string, format '
    + '"W-L-D", or "" if not shown). Ignore the date, event title, header row or footer text: only player rows.',

  // "W-L-D" as League.parseLine's record cell (draws default to 0 when Gemini gives only "W-L"), or '' when there is none to read.
  standingsRecord(wld) {
    const match = /^\s*(\d{1,2})\s*-\s*(\d{1,2})(?:\s*-\s*(\d{1,2}))?\s*$/.exec(String(wld ?? ''));
    return match ? `${match[1]}-${match[2]}-${match[3] ?? '0'}` : '';
  },

  // One row of what Gemini returned, as the text League.parseLine already knows how to read: "{rank} {name} {W-L-D} {points}".
  // Built this way, instead of handed straight to League.extend, so Gemini's reading goes through the very same cross-checks a
  // local OCR reading did (League.review): a record with more rounds than the event had, points or places out of order.
  standingsLine(row, index) {
    // Collapsed, not just trimmed: a newline inside a Gemini-returned name would otherwise survive into the
    // line this builds and let it split into more than one row once League.parseText reads it back.
    const name = String((row && row.name) || '').replace(/\s+/g, ' ').trim();
    if (!name) return '';
    const rank = Number.isInteger(row.rank) ? row.rank : index + 1;
    const record = this.standingsRecord(row && row.wld);
    const points = Number.isInteger(row.points) ? row.points : null;
    return [rank, name, record, points].filter(part => part !== null && part !== '').join(' ');
  },

  // Reads one or more pictures as ONE table: each is sent to Gemini on its own and its rows are added to `rows`, what is
  // already held (nothing at first), with League.extend. So two pictures of one night are one tournament: a player seen
  // in both is one row, and points are never added up. `recovered` stays empty: that was a local-OCR artifact (a coloured
  // band hiding a row from a whole-page read), which does not apply to a model reading the whole picture at once.
  async readPictures(files, rows) {
    const known = this.knownPlayers();
    const total = { added: 0, same: 0, filled: 0, conflicts: 0 };
    let scan = { rows };
    try {
      for (let i = 0; i < files.length; i++) {
        this._ocrPart = files.length > 1 ? ` ${i + 1} de ${files.length}` : '';
        this.setStatus(`Leyendo la imagen con Gemini${this._ocrPart}…`, "var(--color-brand)");
        const parsed = await Gemini.read([files[i]], this.STANDINGS_PROMPT, note => {
          this.setStatus(note, "var(--color-brand)");
        });
        const list = Array.isArray(parsed) ? parsed : [];
        const text = list.map((row, idx) => this.standingsLine(row, idx)).filter(Boolean).join('\n');
        scan = League.extend(scan.rows, text, known);
        for (const key of Object.keys(total)) total[key] += scan[key];
      }
      return { scan, recovered: [], images: files.length, ...total };
    } finally {
      this._ocrPart = '';
    }
  },

  // No read starts without a key: an alert says so and opens the dialog to add one, rather than failing silently mid-scan.
  requireApiKey() {
    if (Gemini.key()) return true;
    alert('Agrega tu clave de Gemini en «Clave de Gemini» antes de leer una captura.');
    this.openApiKeyDialog();
    return false;
  },

  async processOcrScreenshot() {
    if (this._ocrRunning) {
      this.setStatus("Espera a que termine la lectura que está en curso.", "var(--color-bad)");
      return;
    }
    const fileInput = document.getElementById("ocr-file");
    if (!fileInput || !fileInput.files || !fileInput.files[0]) {
      this.setStatus("Selecciona un archivo de imagen primero.", "var(--color-bad)");
      return;
    }
    if (!this.requireApiKey()) return;

    this._ocrRunning = true;
    // Choosing another image, discarding the table or saving while this read runs makes its result out of date.
    const run = ++this._scanRun;
    try {
      const result = await this.readPictures([...fileInput.files], []);
      if (run !== this._scanRun) {
        this.setStatus("La imagen cambió mientras se leía, así que se descartó esa lectura. Pulsa «Leer imagen» otra vez.", "var(--text-secondary)");
        return;
      }
      this.applyScan(result.scan, result.recovered, { images: result.images });
    } catch (err) {
      console.error("Error OCR:", err);
      this.setStatus(`Error al procesar imagen: ${err.message}`, "var(--color-bad)");
    } finally {
      this._ocrRunning = false;
    }
  },

  // More pictures of the table already read (the second half of it, say), added to it as one table. What the person already
  // checked and edited stays as it is; only what is new comes in.
  async addScreenshots(input) {
    const files = [...(input.files || [])];
    input.value = '';
    if (!files.length || !this._scanned.length) return;
    if (this._ocrRunning) {
      this.setStatus("Espera a que termine la lectura que está en curso.", "var(--color-bad)");
      return;
    }
    if (!this.requireApiKey()) return;
    this._ocrRunning = true;
    const run = ++this._scanRun;
    try {
      // A copy, so a read that fails or is dropped half way leaves the table exactly as it was.
      const result = await this.readPictures(files, this._scanned.map(row => ({ ...row, flags: [...row.flags] })));
      if (run !== this._scanRun) {
        this.setStatus("La tabla cambió mientras se leía, así que se descartó esa lectura. Agrega la captura otra vez.", "var(--text-secondary)");
        return;
      }
      this.applyScan(result.scan, result.recovered, { ...result, adding: true });
    } catch (err) {
      console.error("Error OCR:", err);
      this.setStatus(`Error al procesar imagen: ${err.message}`, "var(--color-bad)");
    } finally {
      this._ocrRunning = false;
    }
  },

  // What a scan gives the form (your own row) and the review list (everyone's). One reading feeds both, so the figures
  // you save for yourself and the ones the league table adds up can never disagree. options: how many pictures there were,
  // and, when they were added to a table already read (adding), what they brought (added, filled, conflicts).
  applyScan(scan, recovered = [], options = {}) {
    const { images = 1, adding = false, added = 0, filled = 0, conflicts = 0 } = options;
    this.setScannedStandings(scan);
    const rows = scan.rows;
    if (!rows.length) {
      this.setStatus("No pude leer ninguna fila de jugadores en la imagen. Prueba con una captura más nítida o ingresa tus datos a mano.", "var(--text-secondary)");
      this.renderLogPreview();
      return;
    }
    const doubtful = rows.filter(row => row.flags.length).length;
    const places = scan.missingPlaces || [];
    const startsAt = this.startsAt(rows, places);
    let absent = '';
    if (startsAt) absent = `; empieza en el puesto ${startsAt}: parece la segunda parte de una tabla, agrega la otra captura`;
    else if (places.length) absent = `; ${places.length === 1 ? 'falta' : 'faltan'} ${this.describePlaces(places)}`;
    else if (scan.missing) absent = `; parece que ${scan.missing === 1 ? 'falta 1 fila' : `faltan ${scan.missing} filas`}`;
    const found = recovered.length ? ` Leí aparte ${this.describePlaces(recovered)}, que la primera lectura se había saltado.` : '';
    const together = !adding && images > 1 ? ` Las ${images} capturas se leyeron juntas: cuentan como un solo torneo.` : '';
    const plus = !adding ? '' : (added
      ? ` Sumé ${plural(added, 'jugador', 'jugadores')} de ${images === 1 ? 'la captura' : `las ${images} capturas`}.`
      : ' Esa captura no trae jugadores que la tabla no tuviera ya.')
      + (filled ? ` Completé ${plural(filled, 'dato', 'datos')} que faltaban.` : '')
      + (conflicts ? ` ${plural(conflicts, 'jugador tiene', 'jugadores tienen')} puntos distintos en otra captura: se dejó lo que ya había y quedó marcado.` : '');
    const table = `${plus}${together} Tabla: ${plural(rows.length, 'jugador', 'jugadores')}${doubtful ? `, ${doubtful} por revisar` : ''}${absent}.${found}`;
    // More than one row can look like the person's name (a lone first name beside the full one): the first is used, and the
    // person is told, so a different player's row never fills the form without their knowing.
    const mine = rows.filter(row => League.isMyName(row.name));
    const me = mine[0];
    if (!me) {
      const unnamed = !State.profile.name;
      const saved = this.scanTarget();
      if (saved) {
        this.setStatus(`Esta tabla se suma a tu torneo del ${saved.date}, que ya tienes guardado: no se agrega otro torneo.${table}${unnamed ? ' Dime tu nombre para que encuentre tu fila.' : ' No encontré tu fila: revisa tu nombre.'}`, "var(--text-secondary)");
        this.toggleIdentify(true);
        this.renderLogPreview();
        return;
      }
      this.setStatus(unnamed
        ? `Aún no sé cuál de estas filas eres: dime tu nombre y la encuentro sola. Mientras, ingresa tus datos a mano.${table}`
        : `No encontré tu fila. Revisa tu nombre o ingresa tus datos a mano.${table}`, "var(--text-secondary)");
      this.toggleIdentify(true);
      this.renderLogPreview();
      return;
    }
    this.toggleIdentify(false);

    // A table for a tournament the person already saved is not a result to save again: the form stays as it is, and the table is
    // added to that tournament (their own place, record and points are not read into anything).
    const alike = mine.length > 1 ? ` ${mine.length} filas podrían ser tuyas (${mine.map(row => row.name).join(', ')}): se usó la primera, revisa que sea la tuya.` : '';
    const target = this.scanTarget();
    if (target) {
      const warn = (me.flags.length ? ' Tu fila tiene avisos: revísala en la lista.' : '') + alike;
      this.setStatus(`Esta tabla se suma a tu torneo del ${target.date}, que ya tienes guardado: tus números no cambian y no se agrega otro torneo.${table}${warn} Pulsa «Sumar la tabla al torneo».`, doubtful ? "var(--text-primary)" : "var(--color-good)");
      this.renderLogPreview();
      return;
    }

    const record = this.fillFormFromRow(me, adding);
    const parts = this.myRowParts(me, record);
    const missing = [];
    if (!me.rank) missing.push('posición');
    if (!record) missing.push('récord W-L-D');
    if (me.pts === null) missing.push('puntos');
    const closing = missing.length ? ` Ingresa a mano: ${missing.join(', ')}.` : ' Verifica y guarda.';
    const warn = (me.flags.length ? ' Tu fila tiene avisos: revísala en la lista.' : '') + alike;
    this.setStatus(`Detectado: ${parts.join(', ') || 'tu fila'}.${table}${warn}${closing}`, doubtful ? "var(--text-primary)" : "var(--color-good)");
    this.renderLogPreview();
  },

  // Puts the place, record and points of the person's own row in the form. Adding a picture never overwrites what is already
  // there: it only fills what is empty. Returns the record, parsed, or null.
  fillFormFromRow(me, adding = false) {
    const put = (id, value) => {
      const field = document.getElementById(id);
      if (field && (!adding || field.value === '')) field.value = value;
    };
    const record = Analytics.parseWLD(me.wl);
    if (me.rank) put("log-rank", me.rank);
    if (record) {
      put("log-w", record.w);
      put("log-l", record.l);
      put("log-d", record.d);
    }
    if (me.pts !== null) put("log-pts", me.pts);
    else if (record && !adding) this.autoCalculatePointsFromRecord();
    return record;
  },

  // What the row said, in words: "Puesto 8°", "Récord 3-2-0", "9 pts".
  myRowParts(me, record) {
    const parts = [];
    if (me.rank) parts.push(`Puesto ${me.rank}°`);
    if (record) parts.push(`Récord ${record.w}-${record.l}-${record.d}`);
    if (me.pts !== null) parts.push(`${me.pts} pts`);
    return parts;
  },

  // The person says who they are after a table was read: their row, if it is there, fills what the form still lacks.
  fillFormFromScan() {
    const me = this._scanned.find(row => League.isMyName(row.name));
    this.toggleIdentify(!me && this._scanned.length > 0);
    if (!me) {
      if (this._scanned.length) {
        this.setStatus(State.profile.name
          ? 'No encontré tu fila con ese nombre. Revísalo o ingresa tus datos a mano.'
          : 'Aún no sé cuál de estas filas eres: dime tu nombre y la encuentro sola. Mientras, ingresa tus datos a mano.', "var(--text-secondary)");
      }
      return false;
    }
    // The table belongs to a tournament already saved: its row is not read into the form.
    if (this.scanTarget()) {
      this.renderLogPreview();
      return true;
    }
    const record = this.fillFormFromRow(me, true);
    this.setStatus(`Detectado: ${this.myRowParts(me, record).join(', ') || 'tu fila'}. Verifica y guarda.`, "var(--color-good)");
    this.renderLogPreview();
    return true;
  },

  // The button under the scan's status that opens "Tu liga", shown while the table read has no row the page knows as the person's.
  toggleIdentify(show) {
    const button = document.getElementById("scan-identify");
    if (!button) return;
    button.hidden = !show;
    button.textContent = State.profile.name ? 'Revisar mi nombre' : 'Decir mi nombre';
  },

  setStatus(msg, color = 'var(--color-brand)') {
    const el = document.getElementById("scan-status");
    if (el) {
      el.style.color = color;
      el.textContent = msg;
    }
  },
});
