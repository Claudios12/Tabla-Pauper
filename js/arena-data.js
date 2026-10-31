// Arena: season end dates and places that qualify, and the backup export and import.
/* global CONFIG, State, League, countEntries, isStoreNight, localIsoDate, nextSeason, seasonEndBounds, isIsoDate,
         cleanSeasonEnds, cleanSeasonTop, cleanProfile, longDate, weekdayName, Arena */

Object.assign(Arena, {
  // ─────────────────────────────────────────────────────────────
  // SEASON END (the date the Fechas restantes card counts down to)
  // ─────────────────────────────────────────────────────────────
  // season: open on this one (the General tab asks for the places that qualify in the season it shows).
  openSeasonDialog(season) {
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
    select.value = ahead ? ahead[0] : ([current, next].find(candidate => !State.seasonEnds[candidate]) || current);
    if (season && seasons.has(season)) select.value = season;
    this.syncSeasonDialog();
    dialog.showModal();
  },

  // The fields follow the chosen season: its saved date and the range it accepts, whether there is one to remove, and how
  // many qualify. A season that has not said how many asks: the last answer is only a hint, never filled in for the person.
  syncSeasonDialog() {
    const weekday = State.leagueDay();
    document.getElementById("sd-body").textContent = `La fecha cuenta ${weekday === null ? 'las fechas de tu liga' : `los ${weekdayName(weekday, 2)}`} que quedan en «Fechas restantes», y los clasificados marcan el top en la pestaña General. Para empezar otra temporada, elígela y completa los dos datos.`;
    const season = document.getElementById("sd-season").value;
    const input = document.getElementById("sd-date");
    const [min, max] = seasonEndBounds(season);
    input.min = min;
    input.max = max;
    input.value = State.seasonEnds[season] || '';
    input.removeAttribute("aria-invalid");
    // Hidden is not empty: the fields point at these texts, so errors left from an earlier try would still be read out.
    ["sd-error", "sd-top-error"].forEach(id => { document.getElementById(id).textContent = ''; });
    document.getElementById("sd-error").hidden = true;
    document.getElementById("sd-hint").textContent = `Entre el ${longDate(min)} y el ${longDate(max)}.`;
    document.getElementById("sd-remove").hidden = !State.seasonEnds[season];

    const top = document.getElementById("sd-top");
    const saved = State.seasonTop[season];
    const last = Object.keys(State.seasonTop).filter(other => other < season).sort().pop();
    top.value = saved || '';
    top.placeholder = String(last ? State.seasonTop[last] : State.topFor(season));
    top.removeAttribute("aria-invalid");
    document.getElementById("sd-top-error").hidden = true;
    document.getElementById("sd-top-hint").textContent = saved
      ? 'Los primeros puestos que pasan al cierre. Cada temporada puede clasificar una cantidad distinta.'
      : `Aún no lo defines para esta temporada${last ? `; en la ${last} clasificaron ${State.seasonTop[last]}` : ''}. Cada temporada puede clasificar una cantidad distinta.`;
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
    const topInput = document.getElementById("sd-top");
    const topText = topInput.value.trim();
    const top = Number(topText);
    let topProblem = '';
    if (!(topText !== '' && Number.isInteger(top) && top >= 1 && top <= CONFIG.LEAGUE.MAX_TOP)) topProblem = `Escribe cuántos clasifican: un número entero de 1 a ${CONFIG.LEAGUE.MAX_TOP}.`;
    const show = (field, errorId, message) => {
      const error = document.getElementById(errorId);
      error.hidden = !message;
      error.textContent = message;
      if (message) field.setAttribute("aria-invalid", "true");
      else field.removeAttribute("aria-invalid");
    };
    show(input, "sd-error", problem);
    show(topInput, "sd-top-error", topProblem);
    if (problem || topProblem) {
      (problem ? input : topInput).focus();
      return;
    }
    const before = this.snapshot();
    State.seasonEnds[season] = date;
    State.saveSeasonEnds();
    State.seasonTop[season] = top;
    State.saveSeasonTop();
    this.finishSeasonEdit(`Temporada ${season}: termina el ${longDate(date)} y clasifican ${top}.`, before);
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
    const card = document.querySelector(".js-tab-panel.is-active .js-season-end");
    if (card) card.focus({ preventScroll: true });
    this.notify(message, {
      action: { label: 'Deshacer', run: () => { this.restoreSnapshot(before); this.notify('Valores anteriores restaurados.'); } }
    });
  },

  // ─────────────────────────────────────────────────────────────
  // BACKUP IMPORT / EXPORT
  // ─────────────────────────────────────────────────────────────
  exportJSON() {
    // The nights made from the store's table travel in a field of their own, as they are saved: a copy read by an older release of the
    // app (the page rolled back to it) then brings tournaments only, and this release puts the nights back.
    const exportData = {
      version: CONFIG.DATA_VERSION,
      exportDate: new Date().toISOString(),
      historic: State.historic.filter(item => !isStoreNight(item)),
      storeNights: State.historic.filter(isStoreNight),
      decksList: State.decksList,
      deletedDecks: State.deletedDecks,
      seasonEnds: State.seasonEnds,
      seasonTop: State.seasonTop,
      profile: State.profile
    };
    const fileName = `pauper_decks_backup_${localIsoDate()}.json`;
    this.saveAsFile(JSON.stringify(exportData, null, 2), fileName);
    this.toast(`Copia exportada: ${countEntries(State.historic)} en ${fileName}.`);
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
      // The nights made from the store's table come in their own field (older copies have them among the tournaments, or none).
      const nights = Array.isArray(data.storeNights) ? data.storeNights : [];
      const everything = list.concat(nights);
      if (everything.some(x => !x || typeof x !== 'object' || !('deck' in x))) {
        this.toast(`«${file.name}» tiene registros dañados y no se importó. Tus datos siguen intactos.`);
        return;
      }

      const exported = data.exportDate ? new Date(data.exportDate) : null;
      const exportedText = exported && !isNaN(exported) ? ` (exportada el ${new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', year: 'numeric' }).format(exported)})` : '';
      const ok = await this.confirmDialog({
        title: "Reemplazar tus datos con esta copia",
        body: `Ahora tienes ${countEntries(State.historic)} y la copia trae ${countEntries(everything)}${exportedText}. Se reemplazará todo lo que hay ahora. Podrás deshacerlo unos segundos después.`,
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
      const importedTop = cleanSeasonTop(data.seasonTop);
      if (importedTop) {
        State.seasonTop = importedTop;
        State.saveSeasonTop();
      }
      // Older copies carry no name or league day: the ones set here stay.
      const importedProfile = cleanProfile(data.profile);
      if (importedProfile) {
        State.profile = importedProfile;
        State.saveProfile();
        League.identify(State.profile.name);
      }
      State.historic = State.fillIsoDates(everything);
      State.syncDecksList();
      State.save();
      this.dropMonth();
      this.populateDeckPickers();
      this.refreshAll();
      this.notify(`Copia restaurada: ${countEntries(everything)}.`, {
        action: { label: 'Deshacer', run: () => { this.restoreSnapshot(before); this.notify('Tus datos anteriores volvieron.'); } }
      });
    };
    reader.readAsText(file);
    input.value = "";
  }
});
