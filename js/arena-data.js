// Arena: season end dates and the backup export and import.
/* global CONFIG, State, plural, localIsoDate, nextSeason, seasonEndBounds, isIsoDate,
         cleanSeasonEnds, longDate, Arena */

Object.assign(Arena, {
  // ─────────────────────────────────────────────────────────────
  // SEASON END (the date the Fechas restantes card counts down to)
  // ─────────────────────────────────────────────────────────────
  openSeasonDialog() {
    const dialog = document.getElementById("season-dialog");
    const select = document.getElementById("sd-season");
    if (!dialog || !select || typeof dialog.showModal !== 'function') return;
    const current = CONFIG.CURRENT_SEASON;
    const next = nextSeason(current);
    const seasons = new Set([next, current, ...this.knownSeasons(), ...Object.keys(State.seasonEnds)]);
    select.innerHTML = '';
    [...seasons].sort().reverse().forEach(season => {
      const option = document.createElement("option");
      option.value = season;
      option.textContent = `Temporada ${season}${season === current ? ' (actual)' : (season === next ? ' (próxima)' : '')}`;
      select.append(option);
    });
    // Opens on the season being counted down; with none ahead, on the first of this and the next that has no date yet.
    const today = localIsoDate();
    const ahead = Object.entries(State.seasonEnds).filter(([, date]) => date >= today).sort((a, b) => a[1].localeCompare(b[1]))[0];
    select.value = ahead ? ahead[0] : ([current, next].find(season => !State.seasonEnds[season]) || current);
    this.syncSeasonDialog();
    dialog.showModal();
  },

  // The date field follows the chosen season: its saved date, the range it accepts, and whether there is one to remove.
  syncSeasonDialog() {
    const season = document.getElementById("sd-season").value;
    const input = document.getElementById("sd-date");
    const [min, max] = seasonEndBounds(season);
    input.min = min;
    input.max = max;
    input.value = State.seasonEnds[season] || '';
    input.removeAttribute("aria-invalid");
    document.getElementById("sd-error").hidden = true;
    document.getElementById("sd-hint").textContent = `Entre el ${longDate(min)} y el ${longDate(max)}.`;
    document.getElementById("sd-remove").hidden = !State.seasonEnds[season];
  },

  saveSeasonEnd(event) {
    event.preventDefault();
    const season = document.getElementById("sd-season").value;
    const input = document.getElementById("sd-date");
    const date = input.value;
    const [min, max] = seasonEndBounds(season);
    let problem = '';
    if (!date) problem = 'Escribe la fecha en que termina la temporada.';
    else if (!isIsoDate(date)) problem = 'Esa fecha no existe. Revisa el día y el mes.';
    else if (date < min || date > max) problem = `Esa fecha queda fuera del rango de la temporada ${season}, que se indica abajo.`;
    const error = document.getElementById("sd-error");
    if (problem) {
      input.setAttribute("aria-invalid", "true");
      error.textContent = problem;
      error.hidden = false;
      input.focus();
      return;
    }
    const before = this.snapshot();
    State.seasonEnds[season] = date;
    State.saveSeasonEnds();
    this.finishSeasonEdit(`Temporada ${season}: termina el ${longDate(date)}.`, before);
  },

  removeSeasonEnd() {
    const season = document.getElementById("sd-season").value;
    if (!State.seasonEnds[season]) return;
    const before = this.snapshot();
    delete State.seasonEnds[season];
    State.saveSeasonEnds();
    this.finishSeasonEdit(`Temporada ${season}: sin fecha de cierre.`, before);
  },

  // Closes the dialog, redraws the card and puts keyboard focus back on it (the redraw replaced the button that opened it).
  finishSeasonEdit(message, before) {
    document.getElementById("season-dialog").close();
    this.refreshAll();
    const card = document.querySelector(".js-season-end");
    if (card) card.focus({ preventScroll: true });
    this.notify(message, {
      action: { label: 'Deshacer', run: () => { this.restoreSnapshot(before); this.notify('Fecha anterior restaurada.'); } }
    });
  },

  // ─────────────────────────────────────────────────────────────
  // BACKUP IMPORT / EXPORT
  // ─────────────────────────────────────────────────────────────
  exportJSON() {
    const exportData = {
      version: CONFIG.DATA_VERSION,
      exportDate: new Date().toISOString(),
      historic: State.historic,
      decksList: State.decksList,
      deletedDecks: State.deletedDecks,
      seasonEnds: State.seasonEnds
    };
    const fileName = `pauper_decks_backup_${localIsoDate()}.json`;
    this.saveAsFile(JSON.stringify(exportData, null, 2), fileName);
    this.toast(`Copia exportada: ${plural(State.historic.length, 'torneo', 'torneos')} en ${fileName}.`);
  },

  importJSON(event) {
    const input = event.target;
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => this.toast(`No se pudo leer «${file.name}». Inténtalo de nuevo o elige otro archivo.`);
    reader.onload = async (e) => {
      let data;
      try {
        data = JSON.parse(e.target.result);
      } catch (err) {
        this.toast(`«${file.name}» no es un archivo JSON válido. Elige una copia exportada desde Historial.`);
        return;
      }
      // The current format and the older one are both accepted.
      const list = Array.isArray(data && data.historic) ? data.historic
        : (Array.isArray(data && data.fullHistoricData) ? data.fullHistoricData : null);
      if (!list) {
        this.toast(`«${file.name}» no parece una copia de Pauper Deck Arena: no trae el historial. Exporta una copia desde Historial y vuelve a intentarlo.`);
        return;
      }
      if (list.some(x => !x || typeof x !== 'object' || !('deck' in x))) {
        this.toast(`«${file.name}» tiene registros dañados y no se importó. Tus datos siguen intactos.`);
        return;
      }

      const exported = data.exportDate ? new Date(data.exportDate) : null;
      const exportedText = exported && !isNaN(exported) ? ` (exportada el ${new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', year: 'numeric' }).format(exported)})` : '';
      const ok = await this.confirmDialog({
        title: "Reemplazar tus datos con esta copia",
        body: `Ahora tienes ${plural(State.historic.length, 'torneo', 'torneos')} y la copia trae ${plural(list.length, 'torneo', 'torneos')}${exportedText}. Se reemplazará todo lo que hay ahora. Podrás deshacerlo unos segundos después.`,
        confirmLabel: "Reemplazar datos"
      });
      if (!ok) return;

      const before = this.snapshot();
      if (Array.isArray(data.deletedDecks)) {
        State.deletedDecks = data.deletedDecks;
        State.saveDeletedDecks();
      }
      // Older copies carry no closing dates: the ones set here stay.
      const importedEnds = cleanSeasonEnds(data.seasonEnds);
      if (importedEnds) {
        State.seasonEnds = importedEnds;
        State.saveSeasonEnds();
      }
      State.historic = list;
      State.syncDecksList();
      State.save();
      this.populateDeckPickers();
      this.refreshAll();
      this.notify(`Copia restaurada: ${plural(list.length, 'torneo', 'torneos')}.`, {
        action: { label: 'Deshacer', run: () => { this.restoreSnapshot(before); this.notify('Tus datos anteriores volvieron.'); } }
      });
    };
    reader.readAsText(file);
    input.value = "";
  }
});
