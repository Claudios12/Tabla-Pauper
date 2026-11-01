// Arena: confirmations, undo and deleting tournaments or decks.
/* global CONFIG, State, Analytics, League, plural, deckInfo, isStoreNight, Arena, Tesseract, createImageBitmap */

Object.assign(Arena, {
  // ─────────────────────────────────────────────────────────────
  // UNDO + CONFIRMATION
  // ─────────────────────────────────────────────────────────────
  snapshot() {
    return {
      historic: JSON.parse(JSON.stringify(State.historic)), deleted: State.deletedDecks.slice(),
      seasonEnds: { ...State.seasonEnds }, seasonTop: { ...State.seasonTop }, profile: { ...State.profile }
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
    // Opening the panel is the first sign the engine will be needed: start fetching it now.
    if (!open) this.loadOcrEngine().catch(() => {});
  },

  // The engine is large and rarely used, so the page does not load it up front. Only the pinned version
  // with the hash in CONFIG is accepted; a changed file on the CDN is refused by the browser.
  loadOcrEngine() {
    if (window.Tesseract) return Promise.resolve();
    if (!this._ocrLoading) {
      this._ocrLoading = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = CONFIG.OCR_ENGINE.src;
        script.integrity = CONFIG.OCR_ENGINE.integrity;
        script.crossOrigin = "anonymous";
        script.onload = () => resolve();
        script.onerror = () => {
          script.remove();
          this._ocrLoading = null;
          reject(new Error("No se pudo cargar el motor OCR. Revisa tu conexión e inténtalo de nuevo."));
        };
        document.head.appendChild(script);
      });
    }
    return this._ocrLoading;
  },

  // How much a picture is enlarged before it is read. A small one (a screenshot passed through a chat is) is brought to a short
  // side of about CONFIG.OCR_TARGET_SIDE, never more than 3 times: the engine misreads small text. A bigger one is read as it
  // is. Either way the long side never goes past CONFIG.OCR_MAX_SIDE, because a phone runs out of memory on a huge photo.
  screenshotScale(width, height) {
    const short = Math.min(width, height), long = Math.max(width, height);
    const wanted = short >= CONFIG.OCR_SMALL_SIDE ? 1 : Math.min(3, CONFIG.OCR_TARGET_SIDE / short);
    return Math.min(wanted, CONFIG.OCR_MAX_SIDE / long);
  },

  // The picture decoded the way it was taken (rotation included), or null when the browser cannot decode it.
  async decodeScreenshot(file) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (err) {
      return null;
    }
  },

  // A canvas of the stretch of the picture from sy for sh pixels (the whole picture by default), at the scale it is read at.
  screenshotCanvas(bitmap, scale, sy = 0, sh = bitmap.height) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, sy, bitmap.width, sh, 0, 0, canvas.width, canvas.height);
    return canvas;
  },

  // One read of the picture. The whole page goes first; then, for every place that read skipped, just the stretch where that
  // row sits is read alone: a row with a coloured band across it (the player's own, say) vanishes in the whole-page read but
  // reads fine by itself. Returns the text in screen order and the places that were recovered.
  async readStandings(worker, file) {
    const bitmap = await this.decodeScreenshot(file);
    if (!bitmap) return { text: (await worker.recognize(file)).data.text, recovered: [] };
    // A decoded picture is held in memory until it is closed, so it is closed whatever happens to the reading.
    try {
      const scale = this.screenshotScale(bitmap.width, bitmap.height);
      const page = (await worker.recognize(this.screenshotCanvas(bitmap, scale))).data;
      const lines = (page.lines || []).map(line => ({ y0: line.bbox.y0, y1: line.bbox.y1, text: line.text.trim() })).filter(line => line.text);
      lines.forEach(line => { line.row = League.parseLine(line.text); });
      const recovered = [];
      try {
        for (const gap of League.gaps(lines)) {
          this.setStatus("Buscando las filas que la primera lectura se saltó…", "var(--color-brand)");
          const crop = this.screenshotCanvas(bitmap, scale, gap.y0 / scale, (gap.y1 - gap.y0) / scale);
          // Only what reads as a player on one of the missing places is taken; anything else in the stretch is ignored.
          const found = (await worker.recognize(crop)).data.text.split('\n').map(text => text.trim())
            .map(text => ({ text, row: League.parseLine(text) }))
            .filter(item => item.row && (item.row.rank === null || gap.places.includes(item.row.rank)));
          found.slice(0, gap.places.length).forEach((item, i) => {
            const place = item.row.rank === null ? gap.places[i] : item.row.rank;
            lines.push({ y0: gap.y0 + i, y1: gap.y0 + i, text: item.row.rank === null ? `${place} ${item.text}` : item.text });
            recovered.push(place);
          });
        }
      } catch (err) {
        console.warn("No se pudieron recuperar las filas que faltaban:", err);
      }
      lines.sort((a, b) => a.y0 - b.y0);
      return { text: lines.map(line => line.text).join('\n'), recovered };
    } finally {
      bitmap.close();
    }
  },

  // Reads one or more pictures as ONE table: each is read on its own (the page, then the gaps in it), and its rows are added to
  // `rows`, what is already held (nothing at first), with League.extend. So two pictures of one night are one tournament:
  // a player seen in both is one row, and points are never added up.
  async readPictures(files, rows) {
    await this.loadOcrEngine();
    const worker = await Tesseract.createWorker('eng+spa', 1, {
      logger: m => {
        if (m.status === 'recognizing text') this.setStatus(`Escaneando imagen${this._ocrPart}… ${Math.round((m.progress || 0) * 100)}%`, "var(--color-brand)");
      }
    });
    try {
      const known = this.knownPlayers();
      const recovered = [];
      const total = { added: 0, same: 0, filled: 0, conflicts: 0 };
      let scan = { rows };
      for (let i = 0; i < files.length; i++) {
        this._ocrPart = files.length > 1 ? ` ${i + 1} de ${files.length}` : '';
        const read = await this.readStandings(worker, files[i]);
        recovered.push(...read.recovered);
        scan = League.extend(scan.rows, read.text, known);
        for (const key of Object.keys(total)) total[key] += scan[key];
      }
      return { scan, recovered, images: files.length, ...total };
    } finally {
      this._ocrPart = '';
      await worker.terminate().catch(() => {});
    }
  },

  async processOcrScreenshot() {
    if (this._ocrRunning) return;
    const fileInput = document.getElementById("ocr-file");
    if (!fileInput || !fileInput.files || !fileInput.files[0]) {
      this.setStatus("Selecciona un archivo de imagen primero.", "var(--color-bad)");
      return;
    }

    this._ocrRunning = true;
    // Choosing another image, discarding the table or saving while this read runs makes its result out of date.
    const run = ++this._scanRun;
    this.setStatus("Inicializando motor OCR…", "var(--color-brand)");
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
    if (!files.length || this._ocrRunning || !this._scanned.length) return;
    this._ocrRunning = true;
    const run = ++this._scanRun;
    this.setStatus("Inicializando motor OCR…", "var(--color-brand)");
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
