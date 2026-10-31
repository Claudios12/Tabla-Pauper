// Arena: who the person is (name and league day), the welcome a first visit sees, and the sample league.
/* global State, League, weekdayName, cleanProfile, Arena */

Object.assign(Arena, {
  // ─────────────────────────────────────────────────────────────
  // TU LIGA: the name the person appears under on the standings screens, and the weekday their league plays
  // ─────────────────────────────────────────────────────────────
  openLeagueDialog() {
    const dialog = document.getElementById("league-dialog");
    const select = document.getElementById("lg-day");
    if (!dialog || !select || typeof dialog.showModal !== 'function') return;
    this._leagueOpener = document.activeElement;
    if (!select.options.length) {
      // The week starts on Monday here. "Automático" lets the page take the day most of the person's tournaments fell on.
      select.append(new Option('Automático: el día de la mayoría de mis torneos', ''));
      [1, 2, 3, 4, 5, 6, 0].forEach(day => {
        const name = weekdayName(day);
        select.append(new Option(name.charAt(0).toUpperCase() + name.slice(1), String(day)));
      });
    }
    const input = document.getElementById("lg-name");
    input.value = State.profile.name;
    input.removeAttribute("aria-invalid");
    // Hidden is not empty: the field points at this text, so an error left from an earlier try would still be read out.
    const error = document.getElementById("lg-name-error");
    error.textContent = '';
    error.hidden = true;
    select.value = State.profile.leagueDay === null ? '' : String(State.profile.leagueDay);
    this.syncLeagueDayHint();
    dialog.showModal();
  },

  // What the day field means for what is chosen: a day is used as it is; "Automático" says which day that would be today.
  syncLeagueDayHint() {
    const hint = document.getElementById("lg-day-hint");
    if (!hint) return;
    if (document.getElementById("lg-day").value !== '') {
      hint.textContent = 'Con este día se cuentan las fechas que quedan de la temporada.';
      return;
    }
    const inferred = State.inferredLeagueDay();
    hint.textContent = inferred === null
      ? 'Todavía no hay torneos para deducirlo: elige un día para que se puedan contar las fechas que quedan.'
      : `Hoy sería el ${weekdayName(inferred)}, porque es el día en que más torneos has jugado.`;
  },

  saveLeague(event) {
    event.preventDefault();
    const input = document.getElementById("lg-name");
    const error = document.getElementById("lg-name-error");
    const name = input.value.replace(/\s+/g, ' ').trim();
    // Blank is allowed (no name, no "your row"); anything else has to be a name, so it needs letters.
    const problem = name && !/\p{L}/u.test(name) ? 'Escribe tu nombre con letras, por ejemplo «Ana Pérez».' : '';
    error.hidden = !problem;
    error.textContent = problem;
    if (problem) {
      input.setAttribute("aria-invalid", "true");
      input.focus();
      return;
    }
    input.removeAttribute("aria-invalid");
    const day = document.getElementById("lg-day").value;
    const before = this.snapshot();
    State.profile = cleanProfile({ name, leagueDay: day === '' ? null : Number(day) });
    State.saveProfile();
    League.identify(State.profile.name);
    document.getElementById("league-dialog").close();
    this.refreshAll();
    // A table already read may hold the person's row now that the page knows the name.
    const found = this.fillFormFromScan();
    const said = [State.profile.name || 'sin nombre', State.leagueDay() === null ? 'sin día de liga' : weekdayName(State.leagueDay())].join(' · ');
    this.notify(`Tu liga: ${said}.${found ? ' Encontré tu fila en la tabla leída.' : ''}`, {
      action: { label: 'Deshacer', run: () => { this.restoreSnapshot(before); this.notify('Valores anteriores restaurados.'); } }
    });
    // The redraw may have replaced the button that opened the dialog: focus goes back to it, or to the page heading.
    const opener = this._leagueOpener && document.contains(this._leagueOpener) ? this._leagueOpener : document.getElementById("page-title");
    if (opener) opener.focus({ preventScroll: true });
  },

  // What the page knows about the person, in "Tu liga y copia de seguridad".
  renderLeagueSettings() {
    const el = document.getElementById("league-summary");
    if (!el) return;
    const day = State.leagueDay();
    const automatic = !Number.isInteger(State.profile.leagueDay);
    const dayText = day === null ? 'sin elegir' : `${weekdayName(day)}${automatic ? ' (el día de la mayoría de tus torneos)' : ''}`;
    el.textContent = `Nombre: ${State.profile.name || 'sin escribir'}. Día de la liga: ${dayText}.`;
  },

  // ─────────────────────────────────────────────────────────────
  // FIRST VISIT AND THE SAMPLE LEAGUE
  // ─────────────────────────────────────────────────────────────
  // Nothing is saved yet, so the Comparador says where to start. It goes away by itself with the first tournament.
  renderWelcome() {
    const el = document.getElementById("welcome");
    if (el) el.hidden = State.historic.length > 0;
  },

  // The buttons that switch the test mode on and off sit where they are about to disappear, so focus goes to the page heading.
  startDemo() {
    const toggle = document.getElementById("test-mode-toggle");
    if (!toggle || toggle.checked) return;
    toggle.checked = true;
    this.toggleTestMode();
    document.getElementById("page-title")?.focus({ preventScroll: true });
  },

  stopDemo() {
    const toggle = document.getElementById("test-mode-toggle");
    if (!toggle || !toggle.checked) return;
    toggle.checked = false;
    this.toggleTestMode();
    document.getElementById("page-title")?.focus({ preventScroll: true });
  }
});
