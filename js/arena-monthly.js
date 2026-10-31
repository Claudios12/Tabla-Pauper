// Arena: the store's monthly table (with its side-quest "reto" points): reading the picture, checking it, saving the retos.
/* global CONFIG, State, League, Monthly, Analytics, Tesseract, plural, esc, seasonOf, weekdayName, Arena */

Object.assign(Arena, {
  // The month's table as read, held (with the dates the person confirms) until they save it or throw it away.
  _month: null,
  // The table held, and any reading still going, belong to the data they were set against: when that is replaced (the test league,
  // a wipe, a backup) both go, and a reading that finishes afterwards is dropped, not applied to the other data.
  dropMonth() {
    this._month = null;
    this._monthRun++;
  },

  // Which picture is being read (1, 2, …), for the progress line.
  _monthPart: 0,
  // Counts the readings, so one that was overtaken (the table was discarded or replaced while it ran) is dropped, not applied.
  _monthRun: 0,

  // ─────────────────────────────────────────────────────────────
  // READING THE PICTURES
  // ─────────────────────────────────────────────────────────────
  // A canvas seen as "how white is it" (the lowest of red, green and blue): the digits of a poster are white, and the art and the
  // coloured bands behind them are not, so this sees what a read of the colours misses. Changed in place.
  whiten(canvas, threshold) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = image.data;
    for (let i = 0; i < px.length; i += 4) {
      const lowest = Math.min(px[i], px[i + 1], px[i + 2]);
      px[i] = px[i + 1] = px[i + 2] = lowest <= threshold ? 255 : Math.max(0, 255 - Math.round((lowest - threshold) * 255 / (255 - threshold)));
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  },

  whiteCanvas(bitmap, scale, threshold) {
    return this.whiten(this.screenshotCanvas(bitmap, scale), threshold);
  },

  // Just one piece of the picture (in the picture's own coordinates), enlarged by `scale` and seen the same way.
  whiteCrop(bitmap, x, y, width, height, scale, threshold) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, x, y, width, height, 0, 0, canvas.width, canvas.height);
    return this.whiten(canvas, threshold);
  },

  // The words of one recognition in the picture's own coordinates (what was read was enlarged by k, and may be a crop at ox, oy).
  wordsOf(data, k, ox = 0, oy = 0) {
    return (data.words || []).map(w => ({ t: w.text, c: w.confidence, x0: ox + w.bbox.x0 / k, y0: oy + w.bbox.y0 / k, x1: ox + w.bbox.x1 / k, y1: oy + w.bbox.y1 / k }));
  },

  // One picture, read with an engine that is already running. First the whole page, four ways: it holds the figures, the header and
  // the title, and one read of such a poster misses cells that the others cover. Then, with the rows located, each row's name area
  // and figures on their own (readMonthCrops).
  async readMonthlyPicture(worker, file) {
    const bitmap = await this.decodeScreenshot(file);
    if (!bitmap) throw new Error(`No se pudo abrir la imagen «${file.name}».`);
    try {
      await worker.setParameters({ tessedit_pageseg_mode: '6' });
      const base = this.screenshotScale(bitmap.width, bitmap.height);
      const fit = (k) => Math.min(k, CONFIG.OCR_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      const plan = [{ k: base, white: 0 }, { k: base, white: 170 }, { k: fit(base * 2), white: 170 }, { k: base, white: 150 }];
      const reads = [];
      for (const { k, white } of plan) {
        const { data } = await worker.recognize(white ? this.whiteCanvas(bitmap, k, white) : this.screenshotCanvas(bitmap, k));
        reads.push({ words: this.wordsOf(data, k) });
      }
      const frame = Monthly.frame(reads);
      if (frame.ok) reads.push(...await this.readMonthCrops(worker, bitmap, frame));
      return reads;
    } finally {
      bitmap.close();
    }
  },

  // Each row's name area and figures read on their own, seen through the white view. This is what reads the names: the whole-page
  // read runs the two lines of a name into one word on a busy picture (measured on a real month: 14 of 31 rows came out clean that
  // way, and 5 names were wrong with nothing to say so), while the crops of the name area got all 31 right at every setting between
  // 150 and 200. The figures get one crop read too: one more vote for each cell. The crop is enlarged until a row is about 230 px high.
  async readMonthCrops(worker, bitmap, frame) {
    const k = Math.min(6, Math.max(1, 230 / frame.pitch));
    const within = ([a, b]) => [Math.max(0, a), Math.min(bitmap.width, b)];
    const settings = [
      { area: within(frame.names), white: 150, nameOnly: true },
      { area: within(frame.names), white: 170, nameOnly: true },
      { area: within(frame.names), white: 190, nameOnly: true },
      { area: within(frame.figures), white: 170, nameOnly: false }
    ];
    const reads = [];
    for (const { area, white, nameOnly } of settings) {
      const width = area[1] - area[0];
      if (width < 20) continue;
      const words = [];
      for (const y of frame.ys) {
        const top = Math.max(0, y - frame.pitch / 2);
        const height = Math.min(frame.pitch, bitmap.height - top);
        // A row cut off by the edge of the picture has nothing to read; and no crop is made larger than the engine is fed elsewhere.
        if (height < 12) continue;
        const scale = Math.min(k, CONFIG.OCR_MAX_SIDE / Math.max(width, height));
        const { data } = await worker.recognize(this.whiteCrop(bitmap, area[0], top, width, height, scale, white));
        words.push(...this.wordsOf(data, scale, area[0], top));
      }
      reads.push(nameOnly ? { nameOnly: true, words } : { crop: true, words });
    }
    return reads;
  },

  // Every picture read and parsed, one engine for all of them. Each comes back as { file, table }; a picture that is no table has
  // table.ok false and says why.
  async readMonthPictures(files) {
    await this.loadOcrEngine();
    const worker = await Tesseract.createWorker('eng+spa', 1, {
      logger: m => {
        // The text only changes from one picture to the next (it is a live region: every change is read out), never per percent.
        if (m.status === 'recognizing text') this.setMonthStatus(files.length > 1 ? `Leyendo la captura ${this._monthPart} de ${files.length}…` : 'Leyendo la tabla del mes…');
      }
    });
    try {
      const known = this.knownPlayers();
      const out = [];
      for (let i = 0; i < files.length; i++) {
        this._monthPart = i + 1;
        const reads = await this.readMonthlyPicture(worker, files[i]);
        out.push({ file: files[i], table: Monthly.parse(reads, known) });
      }
      return out;
    } finally {
      this._monthPart = 0;
      await worker.terminate().catch(() => {});
    }
  },

  setMonthStatus(message, tone = '') {
    const el = document.getElementById("month-status");
    if (!el) return;
    // A live region reads out what is written to it, even the same words again: only a change is written.
    if (el.textContent !== message) el.textContent = message;
    el.classList.toggle('is-bad', tone === 'bad');
  },

  // For a screen reader only: what the comparison now says, after the person changed something.
  announceMonth(text) {
    const el = document.getElementById("month-announce");
    if (el) el.textContent = text;
  },

  // The buttons under the table are drawn again with it, so the one that was used is gone: focus goes back to the one that saves
  // (or, when that one is off, to the button that brings a picture), never to the top of the page.
  focusMonthAction(...ids) {
    const target = [...ids, 'month-pick'].map(id => document.getElementById(id)).find(el => el && !el.disabled);
    if (target) target.focus();
  },

  // The pictures the person chose, read as ONE table (a month often comes in several, ten players each). Fresh: they become the table,
  // in place of the one held. `adding`: they join the table held, which keeps everything the person has corrected, and only the
  // players it lacks come in. All or nothing: a picture that cannot be read stops the lot and is named, so a page of players is
  // never quietly missing.
  async readMonthFiles(input, adding = false) {
    const files = [...(input.files || [])];
    input.value = '';
    if (!files.length || (adding && !this._month)) return;
    if (this._ocrRunning) {
      this.setMonthStatus('Espera a que termine la lectura que está en curso.', 'bad');
      return;
    }
    // A table the person has already corrected is theirs: reading others in its place would lose those corrections.
    if (!adding && this._month && this._month.edited) {
      const ok = await this.confirmDialog({
        title: 'Leer otras capturas',
        body: 'Ya leíste una tabla del mes y le hiciste cambios. Si lees otras capturas en su lugar, esos cambios se pierden. Para sumar capturas a esta tabla usa «Agregar otra captura de esta tabla».',
        confirmLabel: 'Leer en su lugar',
        danger: false
      });
      if (!ok) return;
    }
    this._ocrRunning = true;
    const run = ++this._monthRun;
    this.setMonthStatus('Inicializando motor OCR…');
    try {
      const read = await this.readMonthPictures(files);
      if (run !== this._monthRun || (adding && !this._month)) {
        this.setMonthStatus('La tabla cambió mientras se leía, así que se descartó esa lectura. Súbela otra vez.', 'bad');
        return;
      }
      const failed = read.find(item => !item.table.ok);
      if (failed) {
        this.setMonthStatus(files.length === 1 ? failed.table.reason : `La captura «${failed.file.name}» no se pudo leer: ${failed.table.reason} Quítala o prueba con otra, y sube las capturas otra vez.`, 'bad');
        return;
      }
      // Whatever the person is in the middle of typing into the table held is committed before that table is joined and redrawn.
      const typing = document.activeElement;
      if (adding && typing && typing.closest && typing.closest('#month-result') && typeof typing.blur === 'function') typing.blur();
      const ordered = Monthly.order(read.map(item => item.table));
      const names = ordered.map(table => read.find(item => item.table === table).file.name);
      const joined = Monthly.join(adding ? [this._month.table, ...ordered] : ordered, adding ? ['la tabla que ya tenías', ...names] : names);
      if (!joined.ok) {
        this.setMonthStatus(joined.reason, 'bad');
        return;
      }
      const table = joined.table;
      // Each column of the poster is a date, as the poster writes it (day and month, so the year is the latest that fits); the dates
      // the person already set stay.
      const before = adding ? (this._month.guessed || []) : [];
      const cleared = adding ? (this._month.cleared || []) : [];
      // A date the person set stays, and so does one they emptied; so does an earlier proposal, unless these pictures can now read
      // that column's day (and when they cannot give a date after all, the held one stays).
      const dates = table.nights.map((night, n) => {
        const held = adding ? this._month.dates[n] : null;
        if (!held && cleared.includes(n)) return null;
        if (held && !(before.includes(n) && night.day !== null)) return held;
        return Monthly.isoFor(night.day, table.month) || held || null;
      });
      // A header that could not be read: the nights of the league's weekday in that month are proposed (and said to be a proposal).
      const weekday = State.leagueDay();
      const guess = Monthly.guessDays(table.month, table.nights, weekday);
      const guessed = [];
      if (guess) table.nights.forEach((night, n) => { if (!dates[n] && !cleared.includes(n)) { dates[n] = guess[n]; guessed.push(n); } });
      const kept = before.filter(n => dates[n] === (this._month ? this._month.dates[n] : null) && table.nights[n].day === null);
      this._month = { table, dates, guessed: [...new Set([...kept, ...guessed])], cleared: cleared.filter(n => !dates[n]), weekday: guessed.length || kept.length ? weekday : (adding ? this._month.weekday : null), edited: adding ? this._month.edited : false };
      this.setMonthStatus('');
      this.renderMonth(true);
      // The button that brought these pictures was drawn again with the table: focus goes back to it, unless the person went elsewhere.
      if (adding && document.activeElement === document.body) this.focusMonthAction('month-more', 'month-save');
      // The progress line only ever said "reading": this says it is done, for whoever is not looking at the page.
      this.notify(this.monthReadNote(joined, files.length, adding));
    } catch (err) {
      console.error("Error OCR:", err);
      this.setMonthStatus(`Error al procesar la imagen (${err.message}). Prueba de nuevo, o con otra captura.`, 'bad');
    } finally {
      this._ocrRunning = false;
    }
  },

  // What reading the pictures came to, in a sentence: how many players, and what was repeated or in dispute between pictures.
  monthReadNote(joined, pictures, adding) {
    const { table } = joined;
    const parts = [adding
      ? `Se agregaron ${plural(joined.added, 'jugador', 'jugadores')} a la tabla del mes (ahora ${plural(table.rows.length, 'jugador', 'jugadores')}).`
      : `Tabla del mes leída: ${plural(table.nights.length, 'fecha', 'fechas')} y ${plural(table.rows.length, 'jugador', 'jugadores')}${pictures > 1 ? ` en ${plural(pictures, 'captura', 'capturas')}` : ''}.`];
    if (joined.same) parts.push(`${plural(joined.same, 'jugador salía', 'jugadores salían')} en más de una captura con las mismas cifras y se contó una vez.`);
    if (joined.filled) parts.push(`${plural(joined.filled, 'jugador se completó', 'jugadores se completaron')} con otra captura donde se leía mejor.`);
    if (joined.kept) parts.push(`${plural(joined.kept, 'jugador salía', 'jugadores salían')} en dos capturas con cifras distintas y se dejó la primera lectura (corregida por ti, en disputa o dudosa la otra).`);
    if (joined.conflicts) parts.push(`${plural(joined.conflicts, 'jugador tiene', 'jugadores tienen')} cifras distintas en dos capturas: míralo${joined.conflicts === 1 ? '' : 's'} en «Filas por revisar».`);
    else parts.push('Revísala más abajo.');
    return parts.join(' ');
  },

  // ─────────────────────────────────────────────────────────────
  // WHAT WAS READ, AND HOW IT COMPARES
  // ─────────────────────────────────────────────────────────────
  dayLabel(iso) {
    return iso ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(Analytics.parseDate(iso)) : '—';
  },

  // The rows that can be compared and saved: nothing wrong with them, and nothing read with a doubt the person has not cleared.
  monthRows() {
    return this._month.table.rows.filter(row => !this.monthRowProblem(row));
  },

  // "los jueves": the league's weekday the dates were proposed with (kept with the table, so it cannot change under it), or in general
  // the days the league plays when there is none to name.
  monthWeekdays() {
    const day = this._month && this._month.weekday !== null && this._month.weekday !== undefined ? this._month.weekday : State.leagueDay();
    return day === null || day === undefined ? 'los días de tu liga' : `los ${weekdayName(day, 2)}`;
  },

  // The column of the poster, in words after "de": its date, or its place when the date is not known.
  monthColumn(n) {
    const iso = this._month.dates[n];
    return iso ? `del ${this.dayLabel(iso)}` : `de la columna ${n + 1}`;
  },

  // Cells of a row (night, reto, night, reto, …, total) named in words, for the doubt a row carries.
  monthCells(row, cells) {
    const last = row.nights.length * 2;
    const named = cells.map(i => (i === last ? 'el total' : `${i % 2 ? 'el reto' : 'los puntos'} ${this.monthColumn(i >> 1)}`));
    return named.length > 1 ? `${named.slice(0, -1).join(', ')} y ${named[named.length - 1]}` : named[0];
  },

  // What is wrong with a row that needs the person's hand, in words. Figures that do not add up come first; after them, what the
  // row says because of a guess: a figure nobody read, a reading chosen so that it adds up, a name one letter off or poorly read.
  monthRowProblem(row) {
    if (!League.nameKey(row.name)) return 'Escribe el nombre.';
    if (row.nights.some(n => n === null) || row.retos.some(n => n === null) || row.total === null) return 'Falta alguna cifra: escríbela mirando la imagen.';
    const sum = row.nights.reduce((a, b) => a + b, 0) + row.retos.reduce((a, b) => a + b, 0);
    if (sum !== row.total) return `Las cifras suman ${sum} y la tienda dice ${row.total}: corrige la que se leyó mal.`;
    // Every doubt the row carries is said, all at once: "Está bien así" settles them together, so none may be left unseen.
    const how = row.how || [];
    const picked = (kind) => how.map((h, i) => (h === kind ? i : -1)).filter(i => i >= 0);
    const doubts = [];
    if (picked('derived').length) doubts.push(`No pude leer ${this.monthCells(row, picked('derived'))}: salió de la suma de la fila.`);
    if (picked('fixed').length) doubts.push(`Las cifras que leí no sumaban: cambié ${this.monthCells(row, picked('fixed'))} por otra lectura que sí.`);
    if (row.flags.includes('conflict')) doubts.push(row.other
      ? `Este jugador sale en dos capturas con cifras distintas: aquí el total es ${row.total} y en la captura ${this.monthSource(row.other.from)}, ${row.other.total}.`
      : 'Este jugador sale en dos capturas con cifras distintas.');
    if (row.flags.includes('snapped')) doubts.push(`Leí «${row.read}» y lo tomé por «${row.name}», que ya está en tus tablas: si es otra persona, escribe su nombre.`);
    if (row.flags.includes('name')) doubts.push('El nombre se leyó con poca seguridad.');
    return doubts.length ? `${doubts.join(' ')} Mira la imagen y corrige lo que haga falta, o confírmala si está bien.` : '';
  },

  // A picture in words after "la captura": the file it came from, or its number when the file is not known.
  monthSource(from) {
    const name = this._month && this._month.table.sources && this._month.table.sources[from];
    return name ? `«${name}»` : String(from + 1);
  },

  // A row that adds up and only needs the person's yes: what it says was read with a doubt.
  monthRowNeedsYes(row) {
    return !!League.nameKey(row.name) && Monthly.balanced(row) && !!this.monthRowProblem(row);
  },

  // The card: always on the General tab (a person with no table saved needs it most: the nights can be made from the store's table),
  // and always showing the same three things in order: what was read, how it compares with their nights, what can be done about it.
  renderMonth(open = false) {
    const card = document.getElementById("league-month");
    if (!card) return;
    if (open) card.open = true;
    const result = document.getElementById("month-result");
    if (!result) return;
    if (!this._month) {
      result.hidden = true;
      result.innerHTML = '';
      this.announceMonth('');
      return;
    }
    result.hidden = false;
    const { table, dates } = this._month;
    const guessed = this._month.guessed || [];

    // Dates first: everything below hangs on which saved night each column is.
    const dateFields = dates.map((iso, n) => `<div class="field"><label class="field-label" for="month-date-${n}">Columna ${n + 1}${table.nights[n].day ? ` (leí el ${table.nights[n].day})` : (guessed.includes(n) ? ' (propuesta)' : '')}</label>`
      + `<input class="input-ctrl" id="month-date-${n}" name="month-date-${n}" type="date" autocomplete="off" value="${esc(iso || '')}" onchange="Arena.editMonthDate(${n}, this)"></div>`).join('');
    const weekdays = this.monthWeekdays();
    const datesNote = guessed.length
      ? `<p class="ocr-help">No pude leer ${guessed.length === dates.length ? 'las fechas' : 'todas las fechas'} de la imagen: ${guessed.length === dates.length ? 'propuse' : 'propuse para las columnas sin fecha'} ${weekdays} de ese mes (el día de tu liga). Revisa que sean esas.</p>`
      : (table.flags.includes('dates') ? '<p class="ocr-help">No pude leer todas las fechas de la imagen: revisa las de abajo.</p>' : '');

    result.innerHTML = `<h3 class="month-title">${esc(this.monthTitle())}</h3>`
      + `<p class="month-summary" id="month-summary"></p>`
      + `<fieldset class="month-dates"><legend class="field-label">Fechas de la tabla</legend>${datesNote}<div class="month-date-fields">${dateFields}</div></fieldset>`
      + `<div id="month-compare"></div>`
      + `<div class="month-fix" id="month-fix" hidden></div>`
      + `<div id="month-table"></div>`
      + `<div class="btn-row month-actions" id="month-actions"></div>`;
    this.renderMonthFix();
    this.renderMonthReport();
  },

  // The rows that need the person's hand, each in its own editor. Redrawn when a date changes (the labels name the dates) or a row
  // is confirmed, never while typing, so a field keeps its place.
  renderMonthFix() {
    const host = document.getElementById("month-fix");
    if (!host || !this._month) return;
    const fixing = this._month.table.rows.map((row, i) => ({ row, i })).filter(({ row }) => this.monthRowProblem(row));
    host.hidden = !fixing.length;
    host.innerHTML = fixing.length
      ? `<h3 class="month-title">Filas por revisar</h3><p class="ocr-help">Estas filas no se leyeron del todo bien. Mira la imagen y corrige lo que haga falta, o confirma la fila si está bien como la leí: hasta entonces no se comparan ni se guardan.</p>${fixing.map(({ row, i }) => this.monthEditorHtml(row, i)).join('')}`
      : '';
  },

  monthTitle() {
    const { table } = this._month;
    const names = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return `${table.month ? names[table.month - 1].replace(/^./, c => c.toUpperCase()) : 'Tabla del mes'}: ${plural(table.nights.length, 'fecha', 'fechas')} y ${plural(table.rows.length, 'jugador', 'jugadores')}${table.pictures > 1 ? ` en ${plural(table.pictures, 'captura', 'capturas')}` : ''}`;
  },

  // Everything that depends on the figures and the dates, redrawn when either changes (the editors are not, so typing keeps its place).
  renderMonthReport() {
    if (!this._month) return;
    const { table, dates } = this._month;
    const rows = this.monthRows();
    const report = Monthly.compare({ rows }, dates, State.historic);
    this._month.report = report;
    const usable = { rows };
    // Nights the poster has and the person lacks (see Monthly.plan).
    const toMake = Monthly.plan(report, usable, State.historic);
    const canMake = toMake.make.length + toMake.attach.length + toMake.move.length > 0;

    let differences = 0, missingNights = 0;
    const nights = report.nights.map((night, n) => {
      const label = night.iso ? this.dayLabel(night.iso) : `columna ${n + 1}`;
      if (night.state === 'no-date') { missingNights++; return `<li><b>${esc(label)}</b>: elige su fecha arriba.</li>`; }
      if (night.state === 'clash') { missingNights++; return `<li><b>${esc(label)}</b>: otra columna tiene esta misma fecha, y las dos no pueden ser la misma noche: cambia una de las dos arriba.</li>`; }
      if (night.state === 'no-entry') { missingNights++; return `<li><b>${esc(label)}</b>: no tienes esa noche guardada, así que no hay con qué compararla. Puedes crearla con la tabla de la tienda (botón de abajo).</li>`; }
      if (night.state === 'no-table') { missingNights++; return `<li><b>${esc(label)}</b>: guardaste ese día, pero sin tabla de jugadores, así que no hay con qué compararla. Puedes ponerle la de la tienda (botón de abajo).</li>`; }
      const bits = [];
      night.checks.forEach((check, r) => {
        const name = esc(usable.rows[r].name);
        // A name that is not the very same spelling says which row of the person's table it was taken for.
        const paired = check.at !== undefined && check.how !== 'exact' ? ` (emparejado con «${esc(night.entry.playerResults[check.at].name)}»)` : '';
        if (check.kind === 'differs') bits.push(`<li>${name}${paired}: la tienda le da ${check.store.pts} y tu tabla ${check.mine}.</li>`);
        else if (check.kind === 'absent') bits.push(`<li>${name}: la tienda le da ${check.store.pts}${check.store.reto ? ` (y ${check.store.reto} de reto)` : ''} y no está en tu tabla.</li>`);
        else if (check.kind === 'unsure') bits.push(`<li>${name}: su nombre encaja con más de una fila, o falta una cifra: no se compara.</li>`);
        else if (check.kind === 'same' && paired) bits.push(`<li class="month-near">${name}${paired}.</li>`);
      });
      const bad = night.differs + night.absent + night.unsure;
      differences += bad;
      const verdict = bad ? `${plural(bad, 'diferencia', 'diferencias')}` : `todo coincide (${night.same} de ${night.checks.length})`;
      // Most of the players both tables have differ: that looks like the wrong date more than like misreadings.
      const odd = Monthly.mismatched(night) ? ' Casi nada coincide: revisa que la fecha de esta columna sea la de esa noche.' : '';
      return `<li><b>${esc(label)}</b>: ${verdict}.${odd}${bits.length ? `<ul class="month-details">${bits.join('')}</ul>` : ''}</li>`;
    });

    const exactTotals = report.totals.filter(total => total.mine !== null && total.mine === total.store).length;
    const comparable = report.totals.filter(total => total.mine !== null).length;
    const pendingRetos = report.nights.some(night => night.checks.some(check => (check.kind === 'same' || check.kind === 'differs') && check.store.reto > check.mineReto));
    const summary = document.getElementById("month-summary");
    if (summary) {
      const parts = [];
      if (!rows.length) parts.push('Ninguna fila se puede comparar todavía.');
      else {
        parts.push(differences ? `Hay ${plural(differences, 'diferencia', 'diferencias')} entre la tienda y tus tablas.` : (missingNights ? 'Lo que se pudo comparar coincide.' : 'Todo coincide con tus tablas.'));
        if (missingNights) parts.push(missingNights === 1 ? '1 fecha no se pudo comparar.' : `${missingNights} fechas no se pudieron comparar.`);
        parts.push(comparable
          ? `Totales del mes: coinciden ${exactTotals} de ${comparable}${pendingRetos ? '; faltan por guardar los retos' : ''}.`
          : 'Los totales del mes no se pueden comparar mientras falte la tabla de alguna fecha.');
        const waiting = table.rows.length - rows.length;
        if (waiting) parts.push(`${plural(waiting, 'fila espera', 'filas esperan')} tu revisión (más abajo) y no ${waiting === 1 ? 'cuenta' : 'cuentan'} todavía.`);
        if (canMake) parts.push('Puedes crear las noches que faltan con la tabla de la tienda.');
      }
      const said = parts.join(' ');
      summary.textContent = said;
      // The first drawing is announced by the toast that says the table was read. After that, whatever changes the summary (a date,
      // a figure, a row confirmed, a save) is said once more: nothing else tells a screen reader that the comparison has moved.
      if (this._month.said !== undefined && this._month.said !== said) this.announceMonth(said);
      this._month.said = said;
    }
    document.getElementById("month-compare").innerHTML = `<ul class="month-nights">${nights.join('')}</ul>`;

    // What was read, as a table: the night's points, and under them the reto, which is named for a screen reader (the size of the
    // figure says nothing to it). A figure that was not read is a "?", and says so.
    const unread = '?<span class="visually-hidden"> (no se leyó)</span>';
    const retoHtml = (reto) => (reto === 0 ? '' : `<span class="month-reto"><span class="visually-hidden"> reto </span>${reto === null ? '?' : `+${reto}`}</span>`);
    const head = dates.map((iso, n) => `<th scope="col">${esc(iso ? this.dayLabel(iso) : `Col. ${n + 1}`)}</th>`).join('');
    const body = table.rows.map((row, i) => {
      const bad = this.monthRowProblem(row);
      const usableAt = usable.rows.indexOf(row);
      const cells = row.nights.map((night, n) => {
        const check = usableAt >= 0 ? report.nights[n].checks[usableAt] : null;
        const differs = check && (check.kind === 'differs' || check.kind === 'absent');
        const shown = `${night === null ? unread : night}${retoHtml(row.retos[n])}`;
        return `<td class="${differs ? 'is-differs' : ''}">${shown}${differs ? `<span class="visually-hidden"> (no coincide con tu tabla)</span>` : ''}</td>`;
      }).join('');
      return `<tr class="${bad ? 'is-doubtful' : ''}"><th scope="row">${esc(row.name || `Fila ${i + 1}`)}${bad ? '<span class="visually-hidden"> (revisar)</span>' : ''}</th>${cells}<td class="num">${row.total === null ? unread : row.total}</td></tr>`;
    }).join('');
    document.getElementById("month-table").innerHTML = `<p class="table-hint">Desliza horizontalmente para ver todas las columnas.</p><div class="table-wrap month-table" role="region" aria-label="Lo que leí de la tabla de la tienda" tabindex="0"><table class="month-grid">`
      + `<caption>Lo que leí de la tabla de la tienda: los puntos de cada noche, con sus puntos de reto cuando los hay</caption>`
      + `<thead><tr><th scope="col">Jugador</th>${head}<th scope="col">Total</th></tr></thead><tbody>${body}</tbody></table></div>`;

    const needsPoints = report.nights.some(night => night.differs + night.absent > 0);
    // With nights to make, that is the action that matters (it brings their retos too); saving retos is only for the nights that exist.
    const showSave = !canMake || report.nights.some(night => night.state === 'ok');
    document.getElementById("month-actions").innerHTML = (canMake ? `<button class="btn btn-primary" id="month-make" type="button" onclick="Arena.makeMonthNights()">Crear las noches que faltan con la tabla de la tienda</button>` : '')
      + (showSave ? `<button class="btn ${canMake ? 'btn-secondary' : 'btn-primary'}" id="month-save" type="button" onclick="Arena.saveMonthRetos()"${rows.length ? '' : ' disabled'}>Guardar los retos</button>` : '')
      + (needsPoints ?`<button class="btn btn-secondary" id="month-points" type="button" onclick="Arena.useStorePoints()">Usar los puntos de la tienda donde no coinciden</button>` : '')
      + `<button class="btn btn-secondary" id="month-more" type="button" onclick="document.getElementById('month-more-file').click()">Agregar otra captura de esta tabla</button>`
      + `<button class="btn btn-danger" id="month-discard" type="button" onclick="Arena.discardMonth()">Descartar la tabla del mes</button>`;
  },

  // A row that needs the person's hand: the name and every figure, each in a field with its own label.
  monthEditorHtml(row, i) {
    const { dates } = this._month;
    const num = (value, id, label, field, n) => `<div class="field"><label class="record-input-label" for="${id}">${label}</label>`
      + `<input class="input-ctrl ocr-input" id="${id}" name="${id}" type="number" min="0" max="${field === 'total' ? 999 : 60}" inputmode="numeric" autocomplete="off" value="${value === null ? '' : value}" onchange="Arena.editMonthCell(${i}, '${field}', ${n}, this)"></div>`;
    // Each field says which night it is for ("13 ago: reto"), so it still makes sense read on its own.
    const day = (n) => esc(dates[n] ? this.dayLabel(dates[n]) : `Col. ${n + 1}`);
    const nights = row.nights.map((night, n) => `<div class="month-pair">${num(night, `month-${i}-n${n}`, `${day(n)}: puntos`, 'night', n)}${num(row.retos[n], `month-${i}-r${n}`, `${day(n)}: reto`, 'reto', n)}</div>`).join('');
    // With several pictures, a row says which one it is on (by its file), so it can be found on the right one.
    const where = this._month.table.pictures > 1 && row.from !== undefined ? ` (captura ${this.monthSource(row.from)})` : '';
    return `<fieldset class="month-fixrow" data-row="${i}" aria-describedby="month-${i}-note"><legend>Fila ${i + 1}${where}</legend>`
      + `<div class="field"><label class="record-input-label" for="month-${i}-name">Nombre</label><input class="input-ctrl ocr-input" id="month-${i}-name" name="month-${i}-name" type="text" maxlength="60" autocomplete="off" spellcheck="false" value="${esc(row.name)}" onchange="Arena.editMonthCell(${i}, 'name', 0, this)"></div>`
      + `<div class="month-fixgrid">${nights}</div>${num(row.total, `month-${i}-total`, 'Total que dice la tienda', 'total', 0)}`
      + `<p class="month-fixnote" id="month-${i}-note" role="status">${esc(this.monthRowProblem(row) || 'Ya suma.')}</p>`
      + `<button class="btn btn-secondary month-yes" id="month-${i}-yes" type="button" onclick="Arena.confirmMonthRow(${i})"${this.monthRowNeedsYes(row) ? '' : ' hidden'}>Está bien así<span class="visually-hidden"> (fila ${i + 1})</span></button></fieldset>`;
  },

  editMonthDate(n, input) {
    if (!this._month) return;
    this._month.dates[n] = /^\d{4}-\d{2}-\d{2}$/.test(input.value) ? input.value : null;
    // A date the person sets is theirs, no longer a proposal: its label says so, and the note goes when no proposal is left.
    this._month.guessed = (this._month.guessed || []).filter(i => i !== n);
    this._month.cleared = (this._month.cleared || []).filter(i => i !== n).concat(this._month.dates[n] ? [] : [n]);
    const label = document.querySelector(`label[for="month-date-${n}"]`);
    if (label) label.textContent = label.textContent.replace(' (propuesta)', '');
    if (!this._month.guessed.length) {
      const help = document.querySelector('.month-dates .ocr-help');
      if (help && help.textContent.includes('propuse')) help.remove();
    }
    this._month.edited = true;
    this.renderMonthFix();
    this.renderMonthReport();
  },

  editMonthCell(i, field, n, input) {
    const row = this._month && this._month.table.rows[i];
    if (!row) return;
    let refused = '';
    if (field === 'name') {
      row.name = League.cleanName(input.value);
      input.value = row.name;
      // Writing the name settles what was doubted about the name, and nothing else.
      row.flags = row.flags.filter(flag => !['name', 'noname', 'snapped'].includes(flag));
    } else {
      const text = input.value.trim();
      const value = text === '' ? null : Number(text);
      const ok = value === null || (Number.isInteger(value) && value >= 0 && value <= (field === 'total' ? 999 : 60));
      // A figure that cannot be one is not kept, and the note says why instead of only saying that one is missing.
      if (!ok) {
        input.value = '';
        refused = field === 'total' ? 'El total va de 0 a 999, sin decimales. ' : 'Los puntos y los retos van de 0 a 60, sin decimales. ';
      }
      const stored = ok ? value : null;
      if (field === 'night') row.nights[n] = stored;
      else if (field === 'reto') row.retos[n] = stored;
      else row.total = stored;
      // A figure the person typed is no longer a guess; the figures they have not touched stay as doubtful as they were. (A dispute
      // between two pictures is settled only by "Está bien así": it is about the whole row, not about the figure just typed.)
      const cell = field === 'night' ? n * 2 : (field === 'reto' ? n * 2 + 1 : row.nights.length * 2);
      row.how = Array.from({ length: row.nights.length * 2 + 1 }, (_, k) => (k === cell ? 'typed' : ((row.how && row.how[k]) || 'read')));
    }
    this._month.edited = true;
    row.touched = true;
    const note = document.getElementById(`month-${i}-note`);
    if (note) note.textContent = refused + (this.monthRowProblem(row) || 'Ya suma.');
    const yes = document.getElementById(`month-${i}-yes`);
    if (yes) yes.hidden = !this.monthRowNeedsYes(row);
    this.renderMonthReport();
  },

  // The person looked at the picture and the row is right as it was read: what was doubted about it stops counting against it.
  confirmMonthRow(i) {
    const row = this._month && this._month.table.rows[i];
    if (!row) return;
    row.how = (row.how || []).map(how => (how === 'derived' || how === 'fixed' ? 'confirmed' : how));
    row.flags = row.flags.filter(flag => !['name', 'snapped', 'conflict'].includes(flag));
    this._month.edited = true;
    row.touched = true;
    this.renderMonthFix();
    this.renderMonthReport();
    // The row's editor is gone: focus goes on to the next row to look at, or to the button that saves.
    const next = document.querySelector('#month-fix .month-fixrow .ocr-input');
    (next || document.querySelector('#month-actions .btn-primary'))?.focus();
    this.notify(`«${row.name}» confirmada: ya cuenta en la comparación.`);
  },

  // ─────────────────────────────────────────────────────────────
  // SAVING
  // ─────────────────────────────────────────────────────────────
  // Puts the retos of the rows that add up into the saved nights' tables. Nothing else changes: a night's points are only
  // ever replaced by the next button, which asks first.
  async saveMonthRetos() {
    if (!this._month) return;
    const rows = this.monthRows();
    const table = { rows };
    const odd = this.monthOddNights(Monthly.compare(table, this._month.dates, State.historic));
    if (odd && !(await this.confirmDialog({ title: '¿Es la fecha correcta?', body: odd, confirmLabel: 'Guardar de todos modos', danger: false }))) return;
    if (!this._month) return;
    const before = this.snapshot();
    const fresh = Monthly.compare(table, this._month.dates, State.historic);
    const changed = Monthly.apply(fresh, table);
    // A reto is kept on a player's row of that night, so one whose player the person's table lacks (or whose name fits several rows) is
    // not kept, and neither is any reto of a night with no table: say so, or the general list would be missing them without a word.
    const away = fresh.nights.reduce((sum, night) => sum + night.checks.filter(check => (check.kind === 'absent' || check.kind === 'unsure') && check.store.reto > 0).length, 0);
    const nightsLeft = fresh.nights.filter(night => night.state !== 'ok').length;
    State.save();
    this.refreshAll();
    const skipped = this._month.table.rows.length - rows.length;
    const rest = (skipped ? ` ${plural(skipped, 'fila quedó', 'filas quedaron')} sin guardar: ${skipped === 1 ? 'espera' : 'esperan'} tu revisión.` : '')
      + (away ? ` ${plural(away, 'reto no se guardó', 'retos no se guardaron')} porque su jugador no está en tus tablas o su nombre no se pudo emparejar (para agregarlos usa «Usar los puntos de la tienda…»).` : '')
      + (nightsLeft ? ` ${plural(nightsLeft, 'fecha quedó', 'fechas quedaron')} sin guardar: no hay tabla de jugadores de ${nightsLeft === 1 ? 'ese día' : 'esos días'}.` : '');
    const message = changed.retos
      ? `Retos guardados: ${plural(changed.retos, 'cambio', 'cambios')} en tus tablas.${rest}`
      : `Esos retos ya estaban guardados.${rest}`;
    this.notify(message, changed.retos ? { action: { label: 'Deshacer', run: () => { this.restoreSnapshot(before); this.renderMonth(); this.focusMonthAction('month-save'); this.notify('Retos quitados: tus tablas volvieron a como estaban.'); } } } : {});
    this.renderMonth();
    this.focusMonthAction('month-save');
  },

  // The nights where the store and the person's table mostly disagree, in words, or '': that looks more like the wrong date than
  // like many misreadings, so nothing is written there without asking.
  monthOddNights(report) {
    const odd = report.nights.filter(night => Monthly.mismatched(night));
    if (!odd.length) return '';
    const list = odd.map(night => `${this.dayLabel(night.iso)} (${night.differs} de ${night.differs + night.exact} puntajes distintos)`).join(', ');
    return `Estas noches casi no coinciden con tu tabla: ${list}. Si la fecha de alguna columna está mal, lo que guardes irá a otro día: revisa las fechas de arriba.`;
  },

  // Replaces the points of the nights where the store's differ, and adds the players the person's table lacks. Asks first, and
  // says how much it will touch.
  async useStorePoints() {
    if (!this._month) return;
    const rows = this.monthRows();
    const table = { rows };
    const report = Monthly.compare(table, this._month.dates, State.historic);
    const points = report.nights.reduce((sum, night) => sum + night.differs, 0);
    const added = report.nights.reduce((sum, night) => sum + night.absent, 0);
    if (!points && !added) return;
    // Who would come in, by name: a player the person has under another spelling would be counted twice.
    const names = [...new Set(report.nights.flatMap(night => night.checks.map((check, r) => (check.kind === 'absent' ? rows[r].name : null))).filter(Boolean))];
    const shown = names.length > 6 ? `${names.slice(0, 6).join(', ')} y ${names.length - 6} más` : names.join(', ');
    const odd = this.monthOddNights(report);
    const ok = await this.confirmDialog({
      title: 'Usar los puntos de la tienda',
      body: `${points ? `Se cambiarán ${plural(points, 'puntaje', 'puntajes')} de tus tablas por los de la tienda. ` : ''}${added ? `Se agregarán ${plural(added, 'jugador', 'jugadores')} que tu tabla no tenía (${shown}), con los puntos de la tienda. Si alguno ya está en tus tablas con otro nombre, cancela: se contaría dos veces. ` : ''}${odd ? `${odd} ` : ''}Los retos también se guardan. Podrás deshacerlo unos segundos después.`,
      confirmLabel: 'Usar los de la tienda',
      danger: false
    });
    if (!ok || !this._month) return;
    const before = this.snapshot();
    const changed = Monthly.apply(Monthly.compare(table, this._month.dates, State.historic), table, { points: true });
    State.save();
    this.refreshAll();
    this.notify(`Listo: ${plural(changed.points, 'puntaje cambiado', 'puntajes cambiados')}, ${plural(changed.added, 'jugador agregado', 'jugadores agregados')} y ${plural(changed.retos, 'reto guardado', 'retos guardados')}.`, {
      action: { label: 'Deshacer', run: () => { this.restoreSnapshot(before); this.renderMonth(); this.focusMonthAction('month-save'); this.notify('Tus tablas volvieron a como estaban.'); } }
    });
    this.renderMonth();
    this.focusMonthAction('month-save');
  },

  // Gives the person the nights the poster has and they lack (see Monthly.plan), so the general list can have the whole month without
  // a table scanned for each night. Asks first and says exactly what it will do (which nights, whose tournament changes, which rows are
  // left out), and can be undone. The nights come with their retos.
  async makeMonthNights() {
    if (!this._month) return;
    const rows = this.monthRows();
    const table = { rows };
    const plan = Monthly.plan(Monthly.compare(table, this._month.dates, State.historic), table, State.historic);
    if (!plan.make.length && !plan.attach.length && !plan.move.length) return;
    const day = (item) => this.dayLabel(item.iso);
    const listing = (items) => items.map(item => `${day(item)} (${plural(item.rows.length, 'jugador', 'jugadores')})`).join(', ');
    const parts = [];
    if (plan.make.length) parts.push(`Se ${plan.make.length === 1 ? 'creará' : 'crearán'} ${plural(plan.make.length, 'noche', 'noches')} en tu historial, que aparecen como «Noche de la liga» y no son torneos tuyos: ${listing(plan.make)}.`);
    if (plan.attach.length) parts.push(`${plural(plan.attach.length, 'torneo tuyo guardado sin tabla recibe', 'torneos tuyos guardados sin tabla reciben')} la de la tienda: ${listing(plan.attach)}.`);
    if (plan.move.length) parts.push(`${plural(plan.move.length, 'noche ya creada con esta misma tabla pasa', 'noches ya creadas con esta misma tabla pasan')} a su fecha: ${plan.move.map(item => `${this.dayLabel(item.entry.isoDate)} → ${day(item)}`).join(', ')}. Así ese día no cuenta dos veces.`);
    const synced = plan.attach.filter(item => item.mine);
    if (synced.length) parts.push(`${synced.map(item => `El ${day(item)} la tienda te da ${item.mine.to} puntos y tu torneo decía ${item.mine.from}`).join('; ')}: tu torneo queda con los de la tienda.`);
    const waiting = this._month.table.rows.filter(row => this.monthRowProblem(row)).map(row => row.name || 'sin nombre');
    if (waiting.length) parts.push(`${plural(waiting.length, 'fila espera', 'filas esperan')} tu revisión y no ${waiting.length === 1 ? 'entra' : 'entran'} en estas noches (${waiting.slice(0, 6).join(', ')}${waiting.length > 6 ? ` y ${waiting.length - 6} más` : ''}): revísa${waiting.length === 1 ? 'la' : 'las'} antes si quieres que ${waiting.length === 1 ? 'cuente' : 'cuenten'}.`);
    const proposed = (this._month.guessed || []).filter(n => plan.make.concat(plan.attach, plan.move).some(item => item.n === n));
    if (proposed.length) parts.push(`${proposed.map(n => this.dayLabel(this._month.dates[n])).join(', ')} ${proposed.length === 1 ? 'es una fecha propuesta' : 'son fechas propuestas'} (${this.monthWeekdays()} del mes), no leídas de la imagen: si alguna no es, cámbiala arriba antes de crear.`);
    parts.push('Los retos entran con las noches. Podrás deshacerlo unos segundos después, o quitar una noche creada desde el Historial.');
    const ok = await this.confirmDialog({ title: 'Crear las noches con la tabla de la tienda', body: parts.join(' '), confirmLabel: 'Crear las noches', danger: false });
    if (!ok || !this._month) return;
    const before = this.snapshot();
    const done = Monthly.create(plan, State.historic);
    State.syncDecksList();
    State.save();
    // Land where the new nights can be seen, even if the season filter would hide them.
    const seasons = [...new Set(plan.make.concat(plan.attach, plan.move).map(item => seasonOf(Number(item.iso.slice(0, 4)), Number(item.iso.slice(5, 7)))))];
    if (seasons.length === 1 && this.currentFilterSeason !== 'all' && this.currentFilterSeason !== seasons[0]) {
      this.currentFilterSeason = seasons[0];
      this.populateSeasonFilter();
      this.handleSeasonFilterChange();
    }
    this.refreshAll();
    this.notify(`Listo: ${[done.made ? plural(done.made, 'noche creada', 'noches creadas') : '', done.moved ? plural(done.moved, 'noche pasada a su fecha', 'noches pasadas a su fecha') : '', done.attached ? plural(done.attached, 'torneo completado', 'torneos completados') : ''].filter(Boolean).join(', ')} con la tabla de la tienda. Los retos ya cuentan en la liga.`, {
      action: { label: 'Deshacer', run: () => { this.restoreSnapshot(before); this.renderMonth(); this.focusMonthAction('month-make', 'month-save'); this.notify('Las noches volvieron a como estaban.'); } }
    });
    this.renderMonth();
    this.focusMonthAction('month-make', 'month-save');
  },

  discardMonth() {
    const kept = this._month;
    this._month = null;
    this.renderMonth();
    document.getElementById("month-pick")?.focus({ preventScroll: true });
    this.notify('Se descartó la tabla del mes.', { action: { label: 'Deshacer', run: () => { this._month = kept; this.renderMonth(true); this.focusMonthAction('month-save'); this.notify('Tabla del mes recuperada.'); } } });
  }
});
