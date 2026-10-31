// Arena: on the General tab, what the season has already decided and the chance of missing the top.
/* global CONFIG, State, Analytics, Outlook, plural, esc, localIsoDate, weekdayName, Arena */

Object.assign(Arena, {
  // ─────────────────────────────────────────────────────────────
  // NIGHTS LEFT, WHO IS DECIDED, THE RISK
  // ─────────────────────────────────────────────────────────────
  // The nights left in a season, by its closing date: the league nights still to come, today's included until its table is saved.
  // Null when the season has no closing date, or the weekday the league plays is not known.
  nightsLeft(season) {
    const end = State.seasonEnds[season];
    const day = State.leagueDay();
    if (!end || day === null) return null;
    const today = localIsoDate();
    if (end < today) return 0;
    const savedToday = State.historic.some(item => item.season === season && item.isoDate === today && Array.isArray(item.playerResults) && item.playerResults.length);
    return Analytics.getRemainingDates(end, new Date(), day) + (new Date().getDay() === day && !savedToday ? 1 : 0);
  },

  // What can be said about the rest of the season, or why nothing can: no table yet, no closing date, no league day, or a
  // night the person played that has no table (everyone else's points would be short, and so would any claim about who is safe).
  leagueOutlook(season, table) {
    if (!table.players.length) return { blocked: 'empty' };
    if (!State.seasonEnds[season]) return { blocked: 'no-end' };
    if (State.leagueDay() === null) return { blocked: 'no-day' };
    const nightsLeft = this.nightsLeft(season);
    if (table.captured < table.played) return { blocked: 'incomplete', gap: table.played - table.captured };
    // The most a night can give: what the league is known to give, or more if the results show it.
    const maxNight = Math.max(CONFIG.LEAGUE.MAX_NIGHT_PTS, 3 * table.maxRounds, table.maxNightPts);
    return { nightsLeft, maxNight, marks: Outlook.decided(table.players, table.top, nightsLeft, maxNight) };
  },

  // In words, how hard the top is to miss.
  riskVerdict(chance) {
    if (chance < 0.1) return 'Casi seguro que entras';
    if (chance < 0.35) return 'Vas bien';
    if (chance < 0.65) return 'Está reñido';
    if (chance < 0.9) return 'Cuesta arriba';
    return 'Muy difícil';
  },

  // Asks how many qualify while the season on screen has not said: until it does, the usual number is used.
  renderLeagueAsk(season) {
    const el = document.getElementById("league-ask");
    if (!el) return;
    const asked = !!State.seasonTop[season];
    el.hidden = asked;
    el.innerHTML = asked ? '' : `<p class="league-ask-text">No has dicho cuántos clasifican en ${esc(season)}: mientras tanto se usa el top ${State.topFor(season)}.</p>`
      + `<button class="btn btn-secondary league-ask-button" type="button" onclick="Arena.openSeasonDialog('${esc(season)}')">Definir clasificados</button>`;
  },

  // The card for the chance of ending outside the top. "Ya clasificado" and "Ya eliminado" are arithmetic and say so;
  // anything in between is an estimate and is labelled as one.
  renderLeagueRisk(season, table, outlook) {
    const el = document.getElementById("league-risk");
    if (!el) return;
    const { me, top } = table;
    const card = (body, meta = '') => `<section class="card risk-card" aria-labelledby="h-risk"><div class="card-head"><h2 id="h-risk">Riesgo de quedar fuera del top ${top}</h2>${meta}</div><div class="risk-body">${body}</div></section>`;
    const say = (text, button = '') => card(`<p class="risk-note">${text}</p>${button}`);
    if (outlook.blocked === 'empty') {
      el.innerHTML = '';
      return;
    }
    if (outlook.blocked === 'no-end') {
      el.innerHTML = say('Para calcularlo hace falta saber cuántas fechas de liga quedan. Define cuándo termina la temporada.',
        `<button class="btn btn-secondary risk-button" type="button" onclick="Arena.openSeasonDialog('${esc(season)}')">Definir el fin de temporada</button>`);
      return;
    }
    if (outlook.blocked === 'no-day') {
      el.innerHTML = say('Para calcularlo hace falta saber qué día de la semana juega tu liga: así se cuentan las fechas que quedan.',
        `<button class="btn btn-secondary risk-button" type="button" onclick="Arena.openLeagueDialog()">Elegir el día de mi liga</button>`);
      return;
    }
    if (outlook.blocked === 'incomplete') {
      el.innerHTML = say(`Faltan las tablas de ${plural(outlook.gap, 'fecha', 'fechas')} que jugaste. Sin ellas los puntos de los demás están incompletos y no se puede decir quién está seguro ni calcular tu riesgo.`);
      return;
    }
    if (!me) {
      const unnamed = !State.profile.name;
      el.innerHTML = say(unnamed ? 'Todavía no sé cuál de estos jugadores eres, así que no puedo calcular tu riesgo.' : 'No encuentro tu nombre en la tabla, así que no puedo calcular tu riesgo.',
        `<button class="btn btn-secondary risk-button" type="button" onclick="Arena.openLeagueDialog()">${unnamed ? 'Decir mi nombre' : 'Revisar mi nombre'}</button>`);
      return;
    }

    const { nightsLeft, maxNight } = outlook;
    const left = `${nightsLeft} ${weekdayName(State.leagueDay(), nightsLeft)}`;
    const tiedNow = nightsLeft === 0 && table.tied && me.rank <= top && me.pts === table.cutPts;
    if (tiedNow) {
      el.innerHTML = say(`La temporada terminó y estás empatado en la línea del top ${top}: lo decide el desempate.`);
      return;
    }
    let shown, label, note, tone, exact = true;
    if (me.mark === 'in') {
      shown = 0; label = 'Ya clasificado'; tone = 'is-low';
      note = nightsLeft ? `Nadie puede dejarte fuera, pase lo que pase en los ${left} que quedan.` : `La temporada terminó y estás dentro del top ${top}.`;
    } else if (me.mark === 'out') {
      shown = 100; label = 'Ya eliminado'; tone = 'is-high';
      note = nightsLeft ? `Aunque ganes todo lo que queda, no alcanzas el top ${top}.` : `La temporada terminó y quedaste fuera del top ${top}.`;
    } else {
      exact = false;
      const chance = Outlook.risk(table.players, me, { top, nightsLeft, captured: table.nights });
      shown = Math.min(99, Math.max(1, Math.round(chance * 100)));
      label = this.riskVerdict(chance);
      tone = shown <= 25 ? 'is-low' : (shown >= 75 ? 'is-high' : 'is-mid');
      note = `Quedan ${left}, y cada uno da hasta ${maxNight} pts.`;
    }
    const help = `<details class="how-to"><summary class="how-to-toggle">¿Cómo se calcula?<svg class="how-to-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary>`
      + `<ul class="how-to-list">`
      + `<li class="how-to-item">«Ya clasificado» y «Ya eliminado» no son estimaciones: se calculan con los puntos que quedan por jugar. Si nadie puede alcanzar a un jugador, ni dejarlo atrás, ya está decidido.</li>`
      + `<li class="how-to-item">El porcentaje de en medio sí es una estimación: se juegan miles de veces las fechas que quedan. Cada jugador va a una fecha tan seguido como ha ido hasta ahora y suma puntos como los ha sumado, con sus propias fechas y, si tiene pocas, con las de toda la liga.</li>`
      + `<li class="how-to-item">Los empates en la línea cuentan a tu favor, como en la tabla. Solo usa las tablas guardadas: si faltan fechas, la cuenta se equivoca.</li></ul></details>`;
    el.innerHTML = card(
      `<div class="risk-figure"><b class="risk-value ${tone}">${shown}&nbsp;%</b><span class="risk-label">${label}</span></div>`
      + `<div class="risk-bar" role="img" aria-label="${shown} % de probabilidad de quedar fuera del top ${top}"><span class="risk-fill ${tone}" style="--w:${shown}%"></span></div>`
      + `<p class="risk-note">${note}</p>${help}`,
      `<span class="sec-meta">${exact ? 'seguro' : 'estimación'}</span>`);
  },
});
