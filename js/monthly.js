// The store's table for a month (night points, side-quest "reto" points, total), read from a picture (Gemini) and checked.
/* global CONFIG, League, isIsoDate, seasonOf, isStoreNight */
/* exported Monthly */

// ══════════════════════════════════════════════════════════════════
// MONTHLY TABLE
// The picture is a poster, read once by Gemini into named rows and figures. The one thing it guarantees (on every row, the
// nights and the retos add up to the total) still judges the result the same way a local OCR reading was judged: it derives
// a single figure Gemini could not read from the total, and flags a row that does not add up. Nothing is guessed beyond that.
// ══════════════════════════════════════════════════════════════════
const Monthly = {
  // The most one night, one reto or one total can be: anything above is not a real figure for this table.
  MAX_CELL: 60,
  MAX_TOTAL: 999,
  MONTHS: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],

  // "ALBERT LOAIZA" -> "Albert Loaiza", with the little words of a name left small.
  titleCase(name) {
    const small = ['de', 'del', 'la', 'las', 'los', 'y', 'da', 'van', 'von'];
    return String(name ?? '').toLowerCase().split(/\s+/).filter(Boolean)
      .map((word, i) => (i > 0 && small.includes(word) ? word : word.charAt(0).toUpperCase() + word.slice(1))).join(' ');
  },

  // A name read, set against the players the person already has: the same letters with the spaces lost, or one letter off, is
  // that player ("SAMUELURUETA" is Samuel Urueta). Returns the name as the person has it, or the one read when none fits.
  // Only the first is certain: one letter off is a guess (`guessed`), which could as well be another player, so it is flagged.
  snapName(name, known) {
    const squeeze = (text) => League.nameKey(text).replace(/ /g, '');
    const key = squeeze(name);
    if (key.length < 8) return { name, snapped: false, guessed: false };
    const exact = known.filter(other => squeeze(other) === key);
    const near = exact.length ? exact : known.filter(other => !League.isTruncated(other) && League.editDistance(squeeze(other), key, 1) <= 1);
    return near.length === 1 ? { name: near[0], snapped: true, guessed: !exact.length } : { name, snapped: false, guessed: false };
  },

  // The table Gemini read: { ok, nights: [{ day }], month, rows: [{ name, read, nights, retos, total, flags, how }], flags }.
  // data: { month: 1-12|null, columns: [{ day }], rows: [{ name, nights: [...], retos: [...], total }] }, exactly the shape the
  // monthly prompt asks Gemini for. known: the players the person already has, to tell a name a letter off from theirs (snapName).
  // { ok: false, reason } when the response does not even look like a table.
  fromRows(data, known = []) {
    const fail = (reason) => ({ ok: false, reason });
    if (!data || !Array.isArray(data.columns) || !data.columns.length || !Array.isArray(data.rows)) {
      return fail('Gemini no devolvió una tabla con columnas y filas: prueba con una captura más nítida de la tabla del mes.');
    }
    const count = data.columns.length;
    const clampInt = (v, max) => (Number.isInteger(v) && v >= 0 && v <= max ? v : null);
    const nights = data.columns.map(col => ({ day: clampInt(col && col.day, 31) }));

    const rows = data.rows.map(raw => {
      // One array, night/reto pairs then the total, so the one thing the poster guarantees (they add up) can judge it: it
      // derives a single missing figure from the others, never more than one, and flags a row that still does not add up.
      const values = [];
      for (let n = 0; n < count; n++) {
        values.push(clampInt(Array.isArray(raw.nights) ? raw.nights[n] : null, this.MAX_CELL));
        values.push(clampInt(Array.isArray(raw.retos) ? raw.retos[n] : null, this.MAX_CELL));
      }
      values.push(clampInt(raw && raw.total, this.MAX_TOTAL));
      const last = values.length - 1;
      const how = values.map(() => 'read');
      const flags = [];
      const sumOthers = (skip) => values.reduce((sum, v, k) => (k === skip || k === last || v === null ? sum : sum + v), 0);
      const missing = values.map((v, i) => (v === null ? i : -1)).filter(i => i >= 0);
      if (missing.length === 1) {
        const i = missing[0];
        const worked = i === last ? sumOthers(-1) : (values[last] === null ? null : values[last] - sumOthers(i));
        if (worked !== null && worked >= 0 && worked <= (i === last ? this.MAX_TOTAL : this.MAX_CELL)) {
          values[i] = worked;
          how[i] = 'derived';
          flags.push('derived');
        }
      }
      if (values.some(v => v === null)) flags.push('missing');
      else if (sumOthers(-1) !== values[last]) flags.push('unbalanced');

      const read = this.titleCase(String((raw && raw.name) || '').trim().slice(0, 60));
      const snap = read ? this.snapName(read, known) : { name: '', snapped: false, guessed: false };
      if (!read) flags.push('noname');
      else if (snap.guessed) flags.push('snapped');

      return {
        name: snap.name,
        read,
        nights: Array.from({ length: count }, (_, n) => values[n * 2]),
        retos: Array.from({ length: count }, (_, n) => values[n * 2 + 1]),
        total: values[last],
        flags,
        how
      };
    });

    const flags = [];
    const month = clampInt(data.month, 12);
    if (nights.some(n => n.day === null) || month === null) flags.push('dates');
    return { ok: true, nights, month, rows, flags };
  },

  // A row adds up when its nights and retos make its total and every figure is there.
  balanced(row) {
    if (row.nights.some(n => n === null) || row.retos.some(n => n === null) || row.total === null) return false;
    return row.nights.reduce((a, b) => a + b, 0) + row.retos.reduce((a, b) => a + b, 0) === row.total;
  },

  // A row nothing doubts: it adds up, and no figure or name in it is a guess or in dispute.
  clean(row) {
    return this.balanced(row) && !row.flags.some(flag => ['noname', 'snapped', 'conflict'].includes(flag))
      && !(row.how || []).some(how => how === 'derived');
  },

  // ─────────────────────────────────────────────────────────────
  // SEVERAL PICTURES, ONE TABLE
  // ─────────────────────────────────────────────────────────────
  // A month's table often comes in several pictures (ten players each). The store ranks by points, so the picture whose best
  // player has the most points comes first, whatever order the files were chosen in. Ties keep the order given.
  order(tables) {
    // Only the totals that add up count: a glued digit ("92" read as "920") must not put a page first.
    const top = (table) => Math.max(-1, ...table.rows.filter(row => this.balanced(row)).map(row => row.total));
    return tables.map((table, i) => ({ table, i })).sort((a, b) => (top(b.table) - top(a.table)) || (a.i - b.i)).map(item => item.table);
  },

  // The pictures, each read on its own (its layout is its own), as ONE table: the first is the base and the rest add the players it
  // lacks. Nothing is added up: a player seen in two pictures is one row. `names` label each picture ("7.jpg") in the reasons and
  // on the rows (`table.sources`). { ok: false, reason } when they cannot be one table (another number of nights, another month,
  // or nights whose days they cannot agree on).
  //
  // Who is the same player is decided carefully, because a wrong merge makes a real player vanish: only players of the pictures
  // before can be the same as a player of this one (never one of the same picture), a row of the table is merged with at most one
  // incoming row, an exact name wins over a close one, and where two rows claim one the lot are kept as players of their own.
  // What happens to a player in two pictures whose figures differ:
  //   the held row does not add up and the new one does   the new one is taken (`filled`)
  //   both add up                                         the held one stays and is flagged `conflict`, with the other beside it
  //   the held row is the person's (`touched`), or already in conflict, or the new one does not add up   the held one stays (`kept`)
  // Returns { ok, table, added, same, filled, kept, conflicts }; `table.pictures` counts the pictures behind it, and each row's
  // `from` says which one it is on (0 is the first).
  join(tables, names = []) {
    const label = (i) => `«${names[i] || `captura ${i + 1}`}»`;
    const base = tables[0];
    const count = base.nights.length;
    const nightsOf = (n) => `${n} ${n === 1 ? 'noche' : 'noches'}`;
    for (let i = 1; i < tables.length; i++) {
      if (tables[i].nights.length !== count) return { ok: false, reason: `La captura ${label(i)} tiene ${nightsOf(tables[i].nights.length)} y la ${label(0)}, ${nightsOf(count)}: ¿son del mismo mes? Sube solo las de un mes.` };
    }
    const months = [...new Set(tables.map(table => table.month).filter(month => month !== null))];
    if (months.length > 1) return { ok: false, reason: `Las capturas son de meses distintos (${months.map(month => this.MONTHS[month - 1]).join(' y ')}): sube solo las de un mes.` };

    // Each night's day: what the pictures that could read it agree on (a table that stands for several pictures counts for them all);
    // where they split evenly nobody is believed and the person says. Pictures that disagree on the days of several nights are not
    // one month's table at all.
    const first = base.pictures || 1;
    let disputed = 0;
    const nights = Array.from({ length: count }, (_, n) => {
      const tally = new Map();
      tables.forEach((table, i) => { const day = table.nights[n].day; if (day !== null) tally.set(day, (tally.get(day) || 0) + (i === 0 ? first : 1)); });
      const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
      if (ranked.length > 1) disputed++;
      return { day: ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1]) ? ranked[0][0] : null };
    });
    if (disputed >= 2) return { ok: false, reason: `Las capturas leen días distintos en ${disputed} de las noches: ¿son del mismo mes? Sube solo las de un mes.` };

    const copy = (row, from) => ({ ...row, nights: [...row.nights], retos: [...row.retos], flags: [...row.flags], how: [...(row.how || [])], from: row.from === undefined ? from : row.from });
    const figures = (row) => JSON.stringify([row.nights, row.retos, row.total]);
    const rows = base.rows.map(row => copy(row, 0));
    const total = { added: 0, same: 0, filled: 0, kept: 0, conflicts: 0 };
    tables.slice(1).forEach((table, k) => {
      const from = first + k;
      const before = rows.slice();
      const claims = table.rows.map(row => League.matchPlayer(row.name, before, { close: false }));
      const claimants = new Map();
      claims.forEach((claim, i) => { if (claim.at >= 0) claimants.set(claim.at, [...(claimants.get(claim.at) || []), i]); });
      // incoming row -> the held row it is the same player as, when that is clear
      const merges = new Map();
      claimants.forEach((list, at) => {
        const exact = list.filter(i => claims[i].how === 'exact');
        const one = exact.length ? (exact.length === 1 ? exact[0] : -1) : (list.length === 1 ? list[0] : -1);
        if (one >= 0) merges.set(one, at);
      });
      table.rows.forEach((row, i) => {
        if (!merges.has(i)) { rows.push(copy(row, from)); total.added++; return; }
        const at = merges.get(i);
        const mine = rows[at];
        if (figures(mine) === figures(row)) total.same++;
        else if (mine.touched || mine.flags.includes('conflict')) total.kept++;
        else if (!this.balanced(mine) && this.balanced(row)) { rows[at] = copy(row, from); total.filled++; }
        else if (this.balanced(mine) && this.balanced(row)) {
          mine.flags.push('conflict');
          mine.other = { nights: [...row.nights], retos: [...row.retos], total: row.total, from };
          total.conflicts++;
        } else total.kept++;
      });
    });
    const sources = [...(base.sources || [names[0] || 'captura 1']), ...tables.slice(1).map((_, k) => names[k + 1] || `captura ${first + k + 1}`)];
    const flags = nights.some(night => night.day === null) || !months.length ? ['dates'] : [];
    return { ok: true, table: { ok: true, nights, month: months.length ? months[0] : null, rows, flags, pictures: first + tables.length - 1, sources }, ...total };
  },

  // ─────────────────────────────────────────────────────────────
  // AGAINST WHAT THE PERSON SAVED
  // ─────────────────────────────────────────────────────────────
  // The night saved for a day, if any. The person's own tournament with a table comes first, then a night made from the store's
  // table (a day's table that nobody scanned), then a tournament of theirs that has no table. A night the person skipped is none.
  // "Has a table" is the league's own test (a row it can read), so this and the league never disagree about which night counts.
  entryFor(iso, entries) {
    const here = (entries || []).filter(item => item && item.isoDate === iso);
    const own = here.filter(item => item.deck && item.deck !== 'No participó');
    const store = here.filter(isStoreNight);
    const withTable = (item) => League.cleanRows(item.playerResults).length > 0;
    return own.find(withTable) || store.find(withTable) || own[0] || null;
  },

  // The person's own tournament on a day, whatever else is saved for it: the one with a table first.
  ownFor(iso, entries) {
    const own = (entries || []).filter(item => item && item.isoDate === iso && item.deck && item.deck !== 'No participó');
    return own.find(item => League.cleanRows(item.playerResults).length > 0) || own[0] || null;
  },

  // The date of a column of the poster, which says the day and the month and never the year: the latest one that is not in the
  // future (this year's, or last year's for a day that has not come yet). A night saved on that day in another year is not a
  // reason to take that year: the date is always shown, and the person can change it. Null when it is not a real date.
  isoFor(day, month, today = new Date()) {
    if (!day || !month) return null;
    for (let year = today.getFullYear(), tries = 0; tries < 8; year--, tries++) {
      const date = new Date(year, month - 1, day);
      // that day does not exist that year (a Feb 29): an earlier year; or it has not come yet: last year's
      if (date.getMonth() !== month - 1 || date > today) continue;
      const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return isIsoDate(iso) ? iso : null;
    }
    return null;
  },

  // The days of a month on which the league plays, for when the header's days could not be read, as dates: the days of that weekday in
  // the month (the year as isoFor takes it) that have come, but only when there are exactly as many as the poster has night columns
  // and they do not contradict a day that WAS read. A proposal, never a reading: null when it cannot be made safely.
  guessDays(month, nights, weekday, today = new Date()) {
    if (!month || weekday === null || weekday === undefined || !nights.length) return null;
    let year = today.getFullYear();
    if (new Date(year, month - 1, 1) > today) year -= 1;
    const days = [];
    for (let day = 1; day <= new Date(year, month, 0).getDate(); day++) {
      const date = new Date(year, month - 1, day);
      if (date.getDay() === weekday && date <= today) days.push(day);
    }
    if (days.length !== nights.length) return null;
    if (!nights.every((night, n) => night.day === null || night.day === days[n])) return null;
    return days.map(day => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  },

  // Each night of the poster against the night the person saved for that date. For every player of the poster, on every night:
  //   same     the person's table has them with the same points
  //   differs  it has them with other points (store, mine, and where: at)
  //   absent   it does not have them, and the store gave them something that night
  //   rest     it does not have them, and the store gave nothing: they were not there
  //   unsure   the name fits more than one row (or one row fits more than one player): nothing is touched
  //   none     there is nothing to compare with: no date, no saved night, or no table for it (the night's state says which)
  // The person's rows are read the way the league reads them (a backup can put anything in a saved table); `at` is where the row
  // sits in what is stored. Two columns on one date cannot both be that night: neither is compared (state 'clash').
  compare(table, dates, entries) {
    const used = new Map();
    dates.forEach(iso => { if (iso) used.set(iso, (used.get(iso) || 0) + 1); });
    const nights = dates.map((iso, n) => {
      const entry = iso ? this.entryFor(iso, entries) : null;
      const own = iso ? this.ownFor(iso, entries) : null;
      const stored = League.cleanRowsAt(entry && entry.playerResults);
      const rows = stored.rows;
      const state = !iso ? 'no-date' : (used.get(iso) > 1 ? 'clash' : (!entry ? 'no-entry' : (rows.length ? 'ok' : 'no-table')));
      const found = table.rows.map(row => (state === 'ok' ? League.matchPlayer(row.name, rows) : { at: -1, how: null }));
      // A row of the person's table that two players of the poster point at belongs to neither for sure.
      const claims = new Map();
      found.forEach(match => { if (match.at >= 0) claims.set(match.at, (claims.get(match.at) || 0) + 1); });
      const checks = table.rows.map((row, r) => {
        const store = { pts: row.nights[n], reto: row.retos[n] };
        if (state !== 'ok') return { kind: 'none', store };
        // A figure that was not read cannot be compared, and is never written over what the person has.
        if (store.pts === null || store.reto === null) return { kind: 'unsure', store };
        const { at, how } = found[r];
        if (at === -2 || (at >= 0 && claims.get(at) > 1)) return { kind: 'unsure', store };
        if (at === -1) return store.pts > 0 || store.reto > 0 ? { kind: 'absent', store } : { kind: 'rest', store };
        const mine = rows[at].pts;
        return { kind: mine === store.pts ? 'same' : 'differs', store, mine, mineReto: rows[at].reto || 0, at: stored.at[at], how };
      });
      const count = (kind) => checks.filter(check => check.kind === kind).length;
      return { iso, entry, own, state, checks, same: count('same') + count('rest'), exact: count('same'), differs: count('differs'), absent: count('absent'), unsure: count('unsure') };
    });
    // The month's total of each player as the person's tables give it (night points and the retos saved with them), to set against
    // the store's. Null where a night could not be compared: nothing is added up from a guess.
    const totals = table.rows.map((row, r) => {
      let mine = 0;
      for (const night of nights) {
        const check = night.checks[r];
        if (check.kind === 'same' || check.kind === 'differs') mine += check.mine + check.mineReto;
        else if (check.kind !== 'rest') return { store: row.total, mine: null };
      }
      return { store: row.total, mine };
    });
    return { nights, totals };
  },

  // A night where most of the players both tables have differ in their points: more likely the wrong date (a different night)
  // than that many misreadings, so nothing should be written there without asking.
  mismatched(night) {
    return night.state === 'ok' && night.differs >= 2 && night.differs > night.exact;
  },

  // How a night's points are called in the person's tournaments: good, bad or normal.
  typeOf(pts) {
    const bench = CONFIG.BENCHMARKS;
    return pts >= bench.TYPE_GOOD_PTS ? 'good' : (pts <= bench.TYPE_BAD_PTS ? 'bad' : 'normal');
  },

  // The nights the poster has and the person lacks, and what it would take to give them. Only nights with a date that is not shared
  // are looked at: where there is no tournament at all, a night is made from the store's table; where the person saved a tournament
  // without a table, the store's table goes to that tournament (and, if the poster gives the person other points than they wrote
  // for it, their tournament follows the poster: `mine`, only when exactly one row of the poster is the person's); and where the
  // same table was already made on another date (the poster read again with a date corrected), that night is moved to the right
  // date, so the day never counts twice. The rows of a night are the players who were there, with the points and the reto the store
  // gave them (a player with 0 and 0 was not there). `table.rows` are the rows to use; `entries` the person's history.
  plan(report, table, entries = []) {
    const make = [], attach = [], move = [];
    const same = (a, b) => a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
    const fingerprint = (rows) => League.cleanRows(rows).map(row => `${League.nameKey(row.name)}|${row.pts}|${row.reto || 0}`).sort();
    // A night made earlier from this same table can be the one to move only if no column of this poster already stands on its date,
    // it lies within a month of the date it is moved to, and no other column takes it.
    const taken = new Set(report.nights.map(night => night.iso).filter(Boolean));
    const used = new Set();
    const near = (a, b) => Math.abs(new Date(a) - new Date(b)) <= 31 * 86400000;
    report.nights.forEach((night, n) => {
      if (night.state !== 'no-entry' && night.state !== 'no-table') return;
      const rows = table.rows
        .map(row => ({ name: row.name, pts: row.nights[n], reto: row.retos[n] }))
        .filter(row => row.pts > 0 || row.reto > 0)
        .map(row => (row.reto > 0 ? row : { name: row.name, pts: row.pts }));
      if (!rows.length) return;
      if (night.state === 'no-entry') {
        const wanted = fingerprint(rows);
        const twin = entries.find(entry => isStoreNight(entry) && !used.has(entry) && !taken.has(entry.isoDate) && near(entry.isoDate, night.iso) && same(fingerprint(entry.playerResults), wanted));
        if (twin) { used.add(twin); move.push({ n, iso: night.iso, entry: twin }); }
        else make.push({ n, iso: night.iso, rows });
        return;
      }
      // The person's own points on that night, from the poster, when it is clear which row is theirs and what their tournament said.
      const mine = rows.filter(row => League.isMyName(row.name));
      const said = night.entry.pts;
      const own = typeof said === 'number' || (typeof said === 'string' && said.trim() !== '' && said !== '—') ? Number(said) : NaN;
      const sync = !isStoreNight(night.entry) && mine.length === 1 && Number.isFinite(own) && own !== mine[0].pts ? { from: own, to: mine[0].pts } : null;
      attach.push({ n, iso: night.iso, entry: night.entry, rows, mine: sync });
    });
    return { make, attach, move };
  },

  // Does what a plan says, in the person's history (`entries`, changed in place): the nights are added, the tables go to the
  // tournaments that lacked one, and a night made on another date is moved to this one. Returns what was done.
  create(plan, entries) {
    const done = { made: 0, attached: 0, synced: 0, moved: 0, players: 0 };
    const label = (iso) => {
      const [year, month, day] = iso.split('-').map(Number);
      return { date: `${day} ${CONFIG.MONTHS_ABBR[month - 1]}`, isoDate: iso, season: seasonOf(year, month) };
    };
    plan.make.forEach(item => {
      entries.push({
        ...label(item.iso),
        deck: 'No participó',
        rank: '—',
        pts: '—',
        wl: '—',
        type: 'none',
        notes: 'Noche creada con la tabla del mes de la tienda',
        source: 'store',
        playerResults: item.rows.map(row => ({ ...row }))
      });
      done.made++;
      done.players += item.rows.length;
    });
    plan.move.forEach(item => {
      Object.assign(item.entry, label(item.iso));
      done.moved++;
    });
    plan.attach.forEach(item => {
      item.entry.playerResults = item.rows.map(row => ({ ...row }));
      done.attached++;
      done.players += item.rows.length;
      if (item.mine) {
        item.entry.pts = item.mine.to;
        item.entry.type = this.typeOf(item.mine.to);
        done.synced++;
      }
    });
    return done;
  },

  // Writes into the saved nights. Always: the retos of every player the person's table has (a reto of 0 clears one). Only when
  // asked (points): the store's night points where the person's differ, and the players the person's table lacks, with the points
  // the store gave them. The person's own tournament follows their own row. Returns what changed.
  apply(report, table, { points = false } = {}) {
    const changed = { retos: 0, points: 0, added: 0 };
    report.nights.forEach((night, n) => {
      if (night.state !== 'ok') return;
      const rows = night.entry.playerResults;
      night.checks.forEach((check, r) => {
        const store = table.rows[r];
        const reto = store.retos[n];
        if (check.kind === 'same' || check.kind === 'differs') {
          const mine = rows[check.at];
          if (reto > 0 && mine.reto !== reto) { mine.reto = reto; changed.retos++; }
          else if (reto === 0 && mine.reto) { delete mine.reto; changed.retos++; }
          if (points && check.kind === 'differs') {
            mine.pts = store.nights[n];
            changed.points++;
            // The person's own tournament follows their own row: the entry compared, or (when that is a night made from the store's
            // table, which is nobody's tournament) their tournament of that day, if they saved one.
            const tournament = isStoreNight(night.entry) ? night.own : night.entry;
            if (League.isMyName(mine.name) && tournament) {
              tournament.pts = store.nights[n];
              tournament.type = this.typeOf(tournament.pts);
            }
          }
        } else if (check.kind === 'absent' && points) {
          // Two rows of the poster that came out with one name are one player, not two; and a name the night already holds in a way
          // the league counts as the same player is not added again.
          if (League.matchPlayer(store.name, rows).at !== -1) return;
          const row = { name: store.name, pts: store.nights[n] };
          if (reto > 0) row.reto = reto;
          rows.push(row);
          changed.added++;
        }
      });
    });
    return changed;
  }
};
