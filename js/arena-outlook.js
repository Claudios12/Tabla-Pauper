// Arena: on the General tab, what the season has already decided and the chance of missing the top.
/* global CONFIG, State, Analytics, League, Outlook, nf0, nf1, plural, esc, localIsoDate, weekdayName, isIsoDate, Arena */

Object.assign(Arena, {
  // ─────────────────────────────────────────────────────────────
  // FOLDING CARDS: every card of the General tab but the league table can be closed, and stays as the person left it
  // ─────────────────────────────────────────────────────────────
  // Closed is the default, so the table is near the top; a closed card still says its figure in its header (`peek`), so it
  // can be read without opening it. Which ones are open is a convenience of this device and this browser: it is not league
  // data, so it is never in State, a backup or the undo, and a browser that refuses storage simply starts them closed.
  FOLD_KEY: 'pauper_arena_folds',

  folds() {
    try { return JSON.parse(localStorage.getItem(this.FOLD_KEY)) || {}; } catch (err) { return {}; }
  },

  isFoldOpen(id) {
    return this.folds()[id] === true;
  },

  rememberFold(details) {
    const id = details.dataset.fold;
    const all = this.folds();
    if (all[id] === details.open) return;
    all[id] = details.open;
    try { localStorage.setItem(this.FOLD_KEY, JSON.stringify(all)); } catch (err) { /* only a convenience */ }
    // A chart drawn while its card was closed had no width to draw in.
    if (id === 'progress' && details.open) this.drawProgress();
  },

  // One card that folds: its heading and a short figure in the summary, which is the button that opens and closes it.
  foldCard(id, { title, peek = '', meta = '', body, cls = '' }) {
    return `<details class="card fold ${cls}" data-fold="${id}"${this.isFoldOpen(id) ? ' open' : ''} ontoggle="Arena.rememberFold(this)">`
      + `<summary class="fold-head"><span class="fold-text"><h2 class="fold-title" id="h-${id}">${title}</h2>${peek ? `<span class="fold-peek">${peek}</span>` : ''}</span>`
      + `${meta ? `<span class="sec-meta fold-meta">${meta}</span>` : ''}<svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary>`
      + `${body}</details>`;
  },

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
    // The most a night can give: what the league is known to give, or more if the results show it, and on top of that the
    // biggest reto seen. The best night and the best reto need not have fallen on one player yet, so the two are added:
    // taking the best single night seen would call someone safe whom a full night with a reto can still pass.
    const maxNight = Math.max(CONFIG.LEAGUE.MAX_NIGHT_PTS, 3 * table.maxRounds, table.maxBasePts) + table.maxReto;
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
    const card = (body, meta = '', peek = '') => this.foldCard('risk', { title: `Riesgo de quedar fuera del top ${top}`, peek, meta, cls: 'risk-card', body: `<div class="risk-body">${body}</div>` });
    // A card that cannot give a figure says, closed, what it is missing.
    const say = (text, button = '', peek = 'falta un dato para calcularlo') => card(`<p class="risk-note">${text}</p>${button}`, '', peek);
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
      el.innerHTML = say(`La temporada terminó y estás empatado en la línea del top ${top}: lo decide el desempate.`, '', 'empatado en la línea');
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
      exact ? 'seguro' : 'estimación', `${shown}&nbsp;% · ${label}`);
  },

  // ─────────────────────────────────────────────────────────────
  // WHAT YOU NEED: the risk turned into a target, points per night
  // ─────────────────────────────────────────────────────────────
  // Where the line of the top is likely to end (an estimate, played out like the risk), and so how many points a night the
  // person needs to reach it if they play every night left, set against what they make a night now. Says nothing when the
  // season cannot be judged (the risk card says why) or when it is already settled either way.
  renderLeagueNeed(table, outlook) {
    const el = document.getElementById("league-need");
    if (!el) return;
    const { me, top } = table;
    if (outlook.blocked || !me || me.mark || !outlook.nightsLeft) { el.innerHTML = ''; return; }
    const cut = Outlook.finalCut(table.players, { top, nightsLeft: outlook.nightsLeft, captured: table.nights });
    if (!cut) { el.innerHTML = ''; return; }
    const left = outlook.nightsLeft;
    const nights = `${left} ${weekdayName(State.leagueDay(), left)}`;
    const pace = me.nights ? me.pts / me.nights : 0;
    const need = (mark) => Math.max(0, mark - me.pts);
    const perNight = (mark) => Math.ceil(need(mark) / left);
    const likely = perNight(cut.likely);
    let value, label, tone, note;
    if (!need(cut.likely)) {
      value = '0'; label = 'Ya tienes esa marca'; tone = 'is-low';
      note = `Con ${nf0.format(me.pts)} pts ya superas los ${nf0.format(cut.likely)} en que probablemente termine el ${top}°: mantén el ritmo.`;
    } else if (likely > outlook.maxNight) {
      value = nf0.format(likely); label = 'Más de lo que da una fecha'; tone = 'is-high';
      note = `Te faltan ${nf0.format(need(cut.likely))} pts en ${nights}, y una fecha da hasta ${outlook.maxNight}: necesitas que los de arriba sumen menos de lo normal.`;
    } else {
      const reach = likely <= pace;
      value = nf0.format(likely); label = reach ? 'A tu ritmo, llegas' : 'Tienes que subir el ritmo'; tone = reach ? 'is-low' : 'is-mid';
      note = `El ${top}° terminaría en unos ${nf0.format(cut.likely)} pts y tienes ${nf0.format(me.pts)}: te faltan ${nf0.format(need(cut.likely))} en ${nights}, si juegas todas. Ahora sumas ${nf1.format(pace)} por fecha.`
        + (cut.safe > cut.likely ? ` Para entrar con margen (unos ${nf0.format(cut.safe)} pts) serían ${perNight(cut.safe)} por fecha.` : '');
    }
    const help = `<details class="how-to"><summary class="how-to-toggle">¿De dónde sale?<svg class="how-to-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary>`
      + `<ul class="how-to-list"><li class="how-to-item">Es una estimación: se juegan miles de veces las fechas que quedan, como en el riesgo, y se mira con cuántos puntos termina el ${top}°. La cifra es la del caso del medio.</li>`
      + `<li class="how-to-item">Cuenta que vas a todas las fechas que quedan. Los retos de la tienda también suman.</li></ul></details>`;
    el.innerHTML = this.foldCard('need', {
      title: 'Lo que necesitas por fecha', meta: 'estimación', cls: 'risk-card need-card', peek: `${value}&nbsp;pts por fecha · ${label}`,
      body: `<div class="risk-body"><div class="risk-figure"><b class="risk-value ${tone}">${value}&nbsp;pts</b><span class="risk-label">${label}</span></div>`
        + `<p class="risk-note">${note}</p>${help}</div>`
    });
  },

  // ─────────────────────────────────────────────────────────────
  // YOUR RIVALS: the players around you, and what the last night changed
  // ─────────────────────────────────────────────────────────────
  // The two above and the two below, and the two on either side of the line of the top when it is further away. For each,
  // the gap to the person now and what the last night did to it, set against the table as it stood the night before.
  renderLeagueRivals(entries, table) {
    const el = document.getElementById("league-rivals");
    if (!el) return;
    const { me, top, players } = table;
    if (!me || players.length < 2) { el.innerHTML = ''; return; }
    const at = players.indexOf(me);
    const shown = new Set(players.slice(Math.max(0, at - 2), at + 3));
    const lastIn = players.filter(p => p.rank <= top).pop();
    const firstOut = players.find(p => p.rank > top);
    if (players.length > top) [lastIn, firstOut].forEach(p => { if (p) shown.add(p); });
    const rows = players.filter(p => shown.has(p));

    // The table the night before the last one, to say what that night changed.
    const days = [...new Set(table.nightDates.filter(Boolean))].sort();
    const lastDay = days[days.length - 1], prevDay = days[days.length - 2];
    const before = prevDay ? League.standings(entries.filter(entry => isIsoDate(entry.isoDate) && entry.isoDate <= prevDay), top) : null;
    const same = (a, b) => a.members.some(m => b.members.some(n => n.key === m.key));
    const then = (p) => (before ? before.players.find(q => same(p, q)) || null : null);
    const meThen = before ? then(me) : null;
    const day = (iso) => new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(Analytics.parseDate(iso));

    const line = (p) => {
      if (p === me) {
        const gained = meThen ? me.pts - meThen.pts : null;
        return { gap: 'Tú', moved: gained === null ? '' : (gained ? `+${nf0.format(gained)} pts esta fecha` : 'no sumaste esta fecha') };
      }
      const diff = p.pts - me.pts;
      const gap = diff > 0 ? `${nf0.format(diff)} más que tú` : (diff < 0 ? `${nf0.format(-diff)} menos que tú` : 'empatado contigo');
      const old = then(p);
      if (!before) return { gap, moved: '' };
      if (!old || !meThen) return { gap, moved: 'primera fecha' };
      // What the person gained on this player last night: positive, they closed in on someone above or pulled away from someone below.
      const gain = (me.pts - meThen.pts) - (p.pts - old.pts);
      return { gap, moved: !gain ? 'igual que antes' : (gain > 0 ? `le sacaste ${nf0.format(gain)}` : `te sacó ${nf0.format(-gain)}`), tone: gain > 0 ? 'up' : (gain < 0 ? 'down' : '') };
    };
    let html = '';
    rows.forEach((p, i) => {
      if (i > 0 && rows[i - 1].rank !== p.rank - 1 && players.indexOf(p) - players.indexOf(rows[i - 1]) > 1) html += `<li class="rival-gap" aria-hidden="true">⋯</li>`;
      const { gap, moved, tone } = line(p);
      html += `<li class="board-row${p === me ? ' is-me' : ''}">`
        + `<span class="board-rank">${p.rank}°</span>`
        + `<button class="board-main" type="button" data-key="${esc(p.members[0].key)}" onclick="Arena.openPlayer(this.dataset.key, this)" aria-haspopup="dialog"><span class="board-name"><span class="title-text">${esc(p.name)}</span>${p === me ? '<span class="pill">Tú</span>' : ''}</span>`
        + `<span class="board-sub">${p === me ? '' : esc(gap)}${moved ? `${p === me ? '' : ' · '}<span class="rival-move${tone ? ` is-${tone}` : ''}">${esc(moved)}</span>` : ''}</span></button>`
        + `<b class="board-pts">${nf0.format(p.pts)}<small class="board-unit"> pts</small></b></li>`;
      if (p === lastIn && firstOut && rows[i + 1] === firstOut) html += `<li class="board-cut"><span>Top ${top} · clasificados</span></li>`;
    });
    // Closed, it names the nearest player above and below.
    const above = players[at - 1], below = players[at + 1];
    const peek = [above ? `${esc(above.name)} a ${nf0.format(above.pts - me.pts)} arriba` : 'nadie arriba', below ? `${esc(below.name)} a ${nf0.format(me.pts - below.pts)} abajo` : ''].filter(Boolean).join(' · ');
    el.innerHTML = this.foldCard('rivals', {
      title: 'Tus rivales', cls: 'rivals-card', peek, meta: lastDay ? `fecha del ${esc(day(lastDay))}` : '',
      body: (before ? `<p class="board-note">Lo que cambió la última fecha, frente a la tabla del ${esc(day(prevDay))}.</p>` : '')
        + `<ol class="board rivals">${html}</ol>`
    });
  },

  // ─────────────────────────────────────────────────────────────
  // THE CLIMB: the person's points after each night of the season, against the points the last place of the top had then
  // ─────────────────────────────────────────────────────────────
  // One scale (points), two lines: theirs, and the top's line, so "how far from the top" is the gap between them. Their place
  // that night is written on each of their dots; every figure is also in a table under the chart.
  renderLeagueProgress(season, entries, table) {
    const el = document.getElementById("league-progress");
    if (!el) return;
    this._progress = null;
    this._progressWidth = 0;
    if (!table.me) { el.innerHTML = ''; return; }
    const steps = League.progress(entries, table.top).filter(step => step.pts !== null);
    const top = table.top;
    const now = steps[steps.length - 1];
    const card = (body) => this.foldCard('progress', {
      title: `Tu camino al top ${top}`, cls: 'progress-card', meta: 'tras cada fecha', body,
      peek: steps.length > 1 ? `vas ${now.rank}° (empezaste ${steps[0].rank}°)${now.cut === null ? '' : ` · ${now.pts >= now.cut ? `${nf0.format(now.pts - now.cut)} sobre` : `a ${nf0.format(now.cut - now.pts)} de`} la línea`}` : ''
    });
    if (steps.length < 2) {
      el.innerHTML = card(`<p class="risk-note progress-note">${steps.length ? 'Con la próxima fecha guardada verás aquí cómo suben tus puntos y tu puesto, fecha a fecha.' : 'Aún no hay fechas con tu nombre en la tabla.'}</p>`);
      return;
    }
    const day = (iso) => new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(Analytics.parseDate(iso));
    const rows = steps.map(step => {
      const gap = step.cut === null ? '—' : (step.pts >= step.cut ? `+${nf0.format(step.pts - step.cut)}` : `−${nf0.format(step.cut - step.pts)}`);
      return `<tr><th scope="row">${esc(day(step.iso))}</th><td>${step.rank}°</td><td>${nf0.format(step.pts)}</td><td>${step.cut === null ? '—' : nf0.format(step.cut)}</td><td>${gap}</td></tr>`;
    }).join('');
    el.innerHTML = card(
      `<div class="legend chart-legend" aria-hidden="true"><span class="legend-item"><i class="legend-mark me"></i>Tus puntos (y tu puesto)</span><span class="legend-item"><i class="legend-mark ref"></i>Puntos del ${top}° (la línea del top)</span></div>`
      + `<div class="chart-wrap progress-wrap" id="progress-chart"></div>`
      + `<details class="progress-table"><summary class="how-to-toggle">Ver las cifras en una tabla<svg class="how-to-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary>`
      + `<div class="table-wrap" role="region" aria-label="Tu puesto y tus puntos tras cada fecha" tabindex="0"><table class="month-grid"><caption>Tu puesto y tus puntos tras cada fecha de ${esc(season)}, y los puntos del ${top}°</caption>`
      + `<thead><tr><th scope="col">Fecha</th><th scope="col">Puesto</th><th scope="col">Tus puntos</th><th scope="col">${top}°</th><th scope="col">Diferencia</th></tr></thead><tbody>${rows}</tbody></table></div></details>`);
    this._progress = { steps, top };
    this.drawProgress();
    const wrap = document.getElementById("progress-chart");
    // One watcher at a time: the card is drawn again with every change, and its chart with it.
    if (this._progressObserver) this._progressObserver.disconnect();
    if ('ResizeObserver' in window && wrap) {
      this._progressObserver = new ResizeObserver(() => this.drawProgress());
      this._progressObserver.observe(wrap);
    }
  },

  drawProgress() {
    const wrap = document.getElementById("progress-chart");
    if (!wrap || !this._progress) return;
    const W = wrap.clientWidth;
    if (!W || W === this._progressWidth && wrap.firstChild) return;
    this._progressWidth = W;
    const { steps, top } = this._progress;
    const n = steps.length;
    const H = 210, L = 28, R = 44, T = 26, B = 24;
    const iw = W - L - R, ih = H - T - B;
    const max = steps.reduce((most, step) => Math.max(most, step.pts, step.cut || 0), 0);
    let step = 5;
    for (const s of [5, 10, 15, 20, 25, 50, 100]) { step = s; if (Math.ceil(Math.max(max, 1) / s) <= 4) break; }
    const ceiling = Math.max(Math.ceil(max / step), 1) * step;
    const x = (i) => L + (i * iw) / (n - 1);
    const y = (v) => T + ih - (v / ceiling) * ih;
    const day = (iso) => new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(Analytics.parseDate(iso));

    let grid = '';
    for (let t = 0; t <= ceiling; t += step) {
      grid += `<line class="${t === 0 ? 'ch-base' : 'ch-grid'}" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/>`;
      grid += `<text class="ch-tick" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${t}</text>`;
    }
    // The top's line: only where the table had enough players to have one.
    const cutPath = steps.map((s, i) => (s.cut === null ? null : `${x(i).toFixed(1)},${y(s.cut).toFixed(1)}`));
    let cut = '', run = [];
    cutPath.concat(null).forEach(point => {
      if (point) run.push(point);
      else { if (run.length > 1) cut += `<polyline class="progress-cut" points="${run.join(' ')}"/>`; run = []; }
    });
    const lastCut = [...steps.keys()].reverse().find(i => steps[i].cut !== null);
    if (lastCut !== undefined) cut += `<text class="ch-tick" x="${(x(lastCut) + 8).toFixed(1)}" y="${(y(steps[lastCut].cut) + 4).toFixed(1)}">Top ${top}</text>`;
    const mine = `<polyline class="progress-me" points="${steps.map((s, i) => `${x(i).toFixed(1)},${y(s.pts).toFixed(1)}`).join(' ')}"/>`;
    // The place over each dot when there is room for it; otherwise over the first, the best and the last.
    const room = iw / (n - 1) >= 30;
    const best = steps.reduce((at, s, i) => (s.rank < steps[at].rank ? i : at), 0);
    const dots = steps.map((s, i) => {
      const label = room || i === 0 || i === n - 1 || i === best
        ? `<text class="progress-rank${i === n - 1 ? ' is-now' : ''}" x="${x(i).toFixed(1)}" y="${(y(s.pts) - 10).toFixed(1)}" text-anchor="middle">${s.rank}°</text>` : '';
      return `<circle class="progress-dot" cx="${x(i).toFixed(1)}" cy="${y(s.pts).toFixed(1)}" r="4"/>${label}`;
    }).join('');
    const count = Math.min(n, W < 420 ? 4 : 6);
    let labels = '';
    for (let k = 0; k < count; k++) {
      const i = count === 1 ? 0 : Math.round((k * (n - 1)) / (count - 1));
      const anchor = k === 0 ? 'start' : (k === count - 1 ? 'end' : 'middle');
      const lx = k === 0 ? x(0) - 4 : (k === count - 1 ? x(n - 1) + 4 : x(i));
      labels += `<text class="ch-tick" x="${lx.toFixed(1)}" y="${H - 6}" text-anchor="${anchor}">${esc(day(steps[i].iso))}</text>`;
    }
    const first = steps[0], now = steps[n - 1];
    const said = `Tus puntos fecha a fecha: de ${first.pts} tras el ${day(first.iso)} a ${now.pts} tras el ${day(now.iso)}; vas ${now.rank}°${now.cut === null ? '' : ` y el ${top}° tiene ${now.cut}`}. Las cifras están en la tabla de abajo.`;
    // A column per night catches the pointer, so the tooltip finds the night wherever the finger lands.
    const hits = steps.map((s, i) => `<rect class="progress-hit" data-i="${i}" x="${(x(i) - iw / (2 * (n - 1))).toFixed(1)}" y="${T}" width="${(iw / (n - 1)).toFixed(1)}" height="${ih}"/>`).join('');
    wrap.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(said)}">${grid}<line class="progress-cross" x1="0" x2="0" y1="${T}" y2="${T + ih}" hidden/>${cut}${mine}${dots}${labels}${hits}</svg>`
      + `<div class="progress-tip" hidden aria-hidden="true"></div>`;
    const svg = wrap.querySelector('svg'), tip = wrap.querySelector('.progress-tip'), cross = wrap.querySelector('.progress-cross');
    const show = (event) => {
      const box = svg.getBoundingClientRect();
      const i = Math.max(0, Math.min(n - 1, Math.round(((event.clientX - box.left) - L) / (iw / (n - 1)))));
      const s = steps[i];
      const gap = s.cut === null ? '' : (s.pts >= s.cut ? `<span>${nf0.format(s.pts - s.cut)} sobre el ${top}°</span>` : `<span>te faltaban ${nf0.format(s.cut - s.pts)} para el ${top}°</span>`);
      tip.innerHTML = `<b>${esc(day(s.iso))}</b><span>${s.rank}° · ${nf0.format(s.pts)} pts</span>${gap}`;
      tip.hidden = false;
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.removeAttribute('hidden');
      const left = Math.min(Math.max(x(i) - tip.offsetWidth / 2, 0), W - tip.offsetWidth);
      tip.style.setProperty('--x', `${left}px`);
    };
    const hide = () => { tip.hidden = true; cross.setAttribute('hidden', ''); };
    svg.addEventListener('pointermove', show);
    svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointerleave', hide);
  },
});
