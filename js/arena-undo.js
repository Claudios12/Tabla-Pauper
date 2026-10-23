// Arena: confirmations, undo and deleting tournaments or decks.
/* global CONFIG, State, Analytics, deckInfo, Arena, Tesseract */

Object.assign(Arena, {
  // ─────────────────────────────────────────────────────────────
  // UNDO + CONFIRMATION
  // ─────────────────────────────────────────────────────────────
  snapshot() {
    return { historic: JSON.parse(JSON.stringify(State.historic)), deleted: State.deletedDecks.slice(), seasonEnds: { ...State.seasonEnds } };
  },

  restoreSnapshot(snap) {
    State.historic = snap.historic;
    State.deletedDecks = snap.deleted;
    State.seasonEnds = snap.seasonEnds;
    State.saveSeasonEnds();
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
    this.notify(`Torneo del ${item.date} con ${deckInfo(item.deck).name} eliminado.`, {
      action: { label: 'Deshacer', run: () => { this.restoreSnapshot(before); this.refocusList(hostId, pos); this.notify('Torneo restaurado.'); } }
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
    this.switchTab('pg-decks', document.querySelectorAll('.js-nav-link')[0]);
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

  async processOcrScreenshot() {
    if (this._ocrRunning) return;
    const fileInput = document.getElementById("ocr-file");
    if (!fileInput || !fileInput.files || !fileInput.files[0]) {
      this.setStatus("Selecciona un archivo de imagen primero.", "var(--color-bad)");
      return;
    }

    this._ocrRunning = true;
    this.setStatus("Inicializando motor OCR…", "var(--color-brand)");
    let worker = null;
    try {
      await this.loadOcrEngine();
      worker = await Tesseract.createWorker('eng+spa', 1, {
        logger: m => {
          if (m.status === 'recognizing text') {
            const pct = Math.round((m.progress || 0) * 100);
            this.setStatus(`Escaneando imagen… ${pct}%`, "var(--color-brand)");
          }
        }
      });

      const ret = await worker.recognize(fileInput.files[0]);
      await worker.terminate();
      worker = null;

      const text = ret.data.text;
      const extracted = this.extractMyRowFromText(text);

      if (extracted) {
        if (extracted.rank) document.getElementById("log-rank").value = extracted.rank;
        if (extracted.w !== undefined) document.getElementById("log-w").value = extracted.w;
        if (extracted.l !== undefined) document.getElementById("log-l").value = extracted.l;
        if (extracted.d !== undefined) document.getElementById("log-d").value = extracted.d;
        if (extracted.pts !== undefined) document.getElementById("log-pts").value = extracted.pts;
        else this.autoCalculatePointsFromRecord();

        const parts = [];
        if (extracted.rank) parts.push(`Puesto ${extracted.rank}`);
        if (extracted.w !== undefined) parts.push(`Récord ${extracted.w}-${extracted.l}-${extracted.d}`);
        if (extracted.pts !== undefined) parts.push(`${extracted.pts} pts`);
        const missing = [];
        if (!extracted.rank) missing.push('posición');
        if (extracted.w === undefined) missing.push('récord W-L-D');
        const missingNote = missing.length ? ` · Ingresa manualmente: ${missing.join(', ')}.` : ' Verifica y guarda.';
        this.setStatus(`Detectado: ${parts.join(', ')}.${missingNote}`, "var(--color-good)");
        this.renderLogPreview();
      } else {
        this.setStatus("Texto leído pero no se detectó tu fila. Ingresa los valores manualmente.", "var(--text-secondary)");
      }
    } catch (err) {
      console.error("Error OCR:", err);
      this.setStatus(`Error al procesar imagen: ${err.message}`, "var(--color-bad)");
      if (worker) await worker.terminate().catch(() => {});
    } finally {
      this._ocrRunning = false;
    }
  },

  extractMyRowFromText(rawText) {
    const lines = rawText.split('\n');
    const myAliases = ["christian", "cristian", "chris", "donado"];

    for (const line of lines) {
      const lower = line.toLowerCase();
      const isMe = myAliases.some(alias => lower.includes(alias)) && !lower.includes("machado");
      if (isMe) {
        // Find rank
        const rankMatch = line.match(/#?(\d{1,2})[\.\s°º\-:]+/);
        const rank = rankMatch ? `${rankMatch[1]}°` : "";

        // Find W-L-D — only include in result when actually matched
        const wldMatch = line.match(/(\d{1,2})\s*[-–—:/]\s*(\d{1,2})\s*[-–—:/]\s*([0-9Oo])\b/);
        const result = { rank };
        if (wldMatch) {
          result.w = parseInt(wldMatch[1], 10);
          result.l = parseInt(wldMatch[2], 10);
          result.d = parseInt(wldMatch[3].replace(/[Oo]/g, '0'), 10);
          result.pts = Analytics.calculatePoints(result.w, result.d);
        }

        // Points override when explicitly labeled
        const ptsMatch = line.match(/\b(\d{1,2})\s*(?:pts|puntos)\b/i);
        if (ptsMatch) {
          result.pts = parseInt(ptsMatch[1], 10);
        }

        return result;
      }
    }
    return null;
  },

  setStatus(msg, color = 'var(--color-brand)') {
    const el = document.getElementById("scan-status");
    if (el) {
      el.style.color = color;
      el.textContent = msg;
    }
  },
});
