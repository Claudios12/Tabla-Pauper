// The store's table for a month (night points, side-quest "reto" points, total), read from a picture and checked.
/* global CONFIG, League, isIsoDate, seasonOf, isStoreNight */
/* exported Monthly */

// ══════════════════════════════════════════════════════════════════
// MONTHLY TABLE
// The picture is a poster: coloured art behind white digits, so one read of it misses cells. The page hands this module several
// reads (words with their boxes, in picture coordinates). They are merged by position, each cell is taken by vote, and the one
// thing the poster guarantees (on every row, the nights and the retos add up to the total) judges the result: it picks between
// two readings of a cell, and fills in a single figure that no read saw, saying so. A row it cannot settle is flagged, never guessed.
// ══════════════════════════════════════════════════════════════════
const Monthly = {
  // The most one night, one reto or one total can be: anything above is a misread (two digits glued together).
  MAX_CELL: 60,
  MAX_TOTAL: 999,
  // Digits as an engine confuses them, accepted only as a whole short token that is a number's place in a table.
  LOOKALIKES: { O: '0', o: '0', D: '0', Q: '0', '©': '0', I: '1', l: '1', '|': '1', ']': '1', '!': '1' },
  MONTHS: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
  MONTH_CODES: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],

  // The number a word stands for in a table, or null.
  numberOf(text) {
    const t = String(text ?? '').trim();
    if (/^\d{1,3}$/.test(t)) return Number(t);
    if (!t || t.length > 2) return null;
    const digits = [...t].map(ch => (/\d/.test(ch) ? ch : (this.LOOKALIKES[ch] ?? null)));
    if (digits.some(d => d === null)) return null;
    const joined = digits.join('');
    // "OO" is one zero the engine doubled: no cell of this table is written 00.
    return /^0+$/.test(joined) ? 0 : Number(joined);
  },

  median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  },

  // Items on one axis, grouped: a new group starts where the gap to the previous item is more than `gap`.
  groups(items, key, gap) {
    const sorted = [...items].sort((a, b) => key(a) - key(b));
    const out = [];
    sorted.forEach(item => {
      const last = out[out.length - 1];
      if (last && key(item) - key(last.items[last.items.length - 1]) <= gap) last.items.push(item);
      else out.push({ items: [item] });
    });
    out.forEach(group => { group.center = this.median(group.items.map(key)); });
    return out;
  },

  // "ALBERT LOAIZA" -> "Albert Loaiza", with the little words of a name left small.
  titleCase(name) {
    const small = ['de', 'del', 'la', 'las', 'los', 'y', 'da', 'van', 'von'];
    return String(name ?? '').toLowerCase().split(/\s+/).filter(Boolean)
      .map((word, i) => (i > 0 && small.includes(word) ? word : word.charAt(0).toUpperCase() + word.slice(1))).join(' ');
  },

  // Every number-like word of every read, and where it sits. A read of the names alone (`nameOnly`) has no figures to give.
  tokens(reads) {
    const out = [];
    reads.forEach((read, r) => read.nameOnly || (read.words || []).forEach(w => {
      const n = this.numberOf(w.t);
      if (n !== null) out.push({ n, x: (w.x0 + w.x1) / 2, y: (w.y0 + w.y1) / 2, h: w.y1 - w.y0, c: w.c ?? 0, r });
    }));
    return out;
  },

  // The candidates for one cell: each value with the reads that saw it, best first. A value above what a cell can hold is a misread.
  candidates(tokens, max) {
    const byValue = new Map();
    tokens.forEach(t => {
      if (t.n > max) return;
      const found = byValue.get(t.n) || { n: t.n, reads: new Set(), c: 0 };
      found.reads.add(t.r);
      found.c = Math.max(found.c, t.c);
      byValue.set(t.n, found);
    });
    return [...byValue.values()].sort((a, b) => (b.reads.size - a.reads.size) || (b.c - a.c));
  },

  // One row's cells (night, reto, night, reto, …, total) from its candidates. Fills what it can and flags what it cannot:
  //   derived    one figure no read saw was worked out from the total (or the total from the figures)
  //   fixed      the readings did not add up and exactly one other combination of readings does
  //   unbalanced the figures do not add up and nothing fixes it
  //   missing    more than one figure was not seen
  solveRow(options) {
    const last = options.length - 1;
    const values = options.map(list => (list.length ? list[0].n : null));
    const how = options.map(list => (list.length ? 'read' : 'missing'));
    const flags = [];
    const sumOthers = (skip) => values.reduce((sum, v, k) => (k === skip || k === last || v === null ? sum : sum + v), 0);

    const missing = values.map((v, i) => (v === null ? i : -1)).filter(i => i >= 0);
    // A figure worked out from the others is only as good as they are: it takes two reads agreeing on every one of them, or a
    // second misread somewhere would be hidden by the figure that made the row add up.
    const sure = options.every((list, i) => i === missing[0] || (list.length && list[0].reads.size >= 2));
    if (missing.length === 1 && sure) {
      const i = missing[0];
      const worked = i === last ? sumOthers(-1) : values[last] - sumOthers(i);
      if (worked >= 0 && worked <= (i === last ? this.MAX_TOTAL : this.MAX_CELL)) {
        values[i] = worked;
        how[i] = 'derived';
        flags.push('derived');
      }
    }
    if (values.some(v => v === null)) {
      flags.push('missing');
      return { values, how, flags };
    }
    if (sumOthers(-1) === values[last]) return { values, how, flags };

    // Not adding up: look for the other readings that do. Only cells that more than one reading saw can change.
    const varying = options.map((list, i) => (list.length > 1 ? i : -1)).filter(i => i >= 0);
    const solutions = [];
    const walk = (k, chosen) => {
      if (k === varying.length) {
        const trial = values.map((v, i) => (varying.includes(i) ? options[i][chosen[varying.indexOf(i)]].n : v));
        if (trial.slice(0, last).reduce((a, b) => a + b, 0) === trial[last] && chosen.some(c => c > 0)) {
          const score = varying.reduce((sum, i, j) => sum + options[i][chosen[j]].reads.size, 0);
          solutions.push({ trial, score, chosen });
        }
        return;
      }
      for (let c = 0; c < options[varying[k]].length; c++) walk(k + 1, [...chosen, c]);
    };
    if (varying.length && varying.length <= 10) walk(0, []);
    solutions.sort((a, b) => b.score - a.score);
    if (solutions.length && (solutions.length === 1 || solutions[0].score > solutions[1].score)) {
      const best = solutions[0];
      best.trial.forEach((v, i) => { if (v !== values[i]) { values[i] = v; how[i] = 'fixed'; } });
      flags.push('fixed');
    } else {
      flags.push('unbalanced');
    }
    return { values, how, flags };
  },

  // The name on a row, from every read: the words in the name's place, top to bottom, left to right (a name may sit on two lines).
  // The reading most reads agree on wins (letters only); among the ones that agree, the one that kept the spaces; a tie goes to
  // the one the engine was surer of. A name only one read saw, and not surely, is doubtful: names are not covered by the checksum.
  rowNames(reads, zone, y0, y1) {
    // The name area read on its own, row by row, reads names far better than the whole page does (the page read runs a name's two
    // lines together on a busy picture): when such reads exist they are the ones that vote, and a row they found nothing for falls
    // back on the page reads.
    const crops = reads.filter(read => read.nameOnly);
    const named = crops.length ? this.votedName(crops, zone, y0, y1) : null;
    if (named && named.name) return named;
    const fallback = this.votedName(reads.filter(read => !read.nameOnly), zone, y0, y1);
    // The crops were there and gave this row nothing: a name from the page read alone is not to be trusted.
    return crops.length ? { ...fallback, doubtful: true } : fallback;
  },

  // The name on a row as the reads of `pool` agree on it (see rowNames).
  votedName(pool, zone, y0, y1) {
    const middle = (w) => (w.y0 + w.y1) / 2;
    const found = pool.map(read => {
      const inZone = (read.words || []).filter(w => {
        const cx = (w.x0 + w.x1) / 2, cy = middle(w);
        return cx >= zone[0] && cx <= zone[1] && cy >= y0 && cy < y1 && /^[\p{L}'.-]{2,}$/u.test(w.t.trim());
      });
      // Words share a line when their centres are less than half a word's height apart, whatever the size of the picture: the
      // lines are read top to bottom and each line left to right.
      const half = this.median(inZone.map(w => w.y1 - w.y0)) * 0.5;
      const lines = [];
      inZone.sort((a, b) => middle(a) - middle(b)).forEach(w => {
        const line = lines[lines.length - 1];
        if (line && middle(w) - middle(line[0]) <= half) line.push(w);
        else lines.push([w]);
      });
      const words = lines.flatMap(line => line.sort((a, b) => a.x0 - b.x0));
      return {
        name: words.map(w => w.t.trim().replace(/^[.'-]+|[.'-]+$/g, '')).join(' '),
        conf: words.length ? words.reduce((sum, w) => sum + (w.c ?? 0), 0) / words.length : 0
      };
    }).filter(f => f.name);
    if (!found.length) return { name: '', doubtful: true };
    const tally = new Map();
    found.forEach(f => {
      const key = League.nameKey(f.name).replace(/ /g, '');
      const entry = tally.get(key) || { variants: [], votes: 0, conf: 0 };
      entry.variants.push(f);
      entry.votes++;
      entry.conf = Math.max(entry.conf, f.conf);
      tally.set(key, entry);
    });
    const best = [...tally.values()].sort((a, b) => (b.votes - a.votes) || (b.conf - a.conf))[0];
    const variant = best.variants.sort((a, b) => (b.name.split(' ').length - a.name.split(' ').length) || (b.conf - a.conf))[0];
    // Two names read as one word ("SAMUELURUETA") are the other way a name comes out wrong, and every read can do it together.
    const glued = !/\s/.test(variant.name) && variant.name.length >= 11;
    return { name: variant.name, doubtful: glued || (best.votes < 2 && best.conf < 85) };
  },

  // A name the engine read, set against the players the person already has: the same letters with the spaces lost, or one letter
  // off, is that player ("SAMUELURUETA" is Samuel Urueta). Returns the name as the person has it, or the one read when none fits.
  // Only the first is certain: one letter off is a guess (`guessed`), which could as well be another player, so it is flagged.
  snapName(name, known) {
    const squeeze = (text) => League.nameKey(text).replace(/ /g, '');
    const key = squeeze(name);
    if (key.length < 8) return { name, snapped: false, guessed: false };
    const exact = known.filter(other => squeeze(other) === key);
    const near = exact.length ? exact : known.filter(other => !League.isTruncated(other) && League.editDistance(squeeze(other), key, 1) <= 1);
    return near.length === 1 ? { name: near[0], snapped: true, guessed: !exact.length } : { name, snapped: false, guessed: false };
  },

  // The month the poster says it is: its title ("LIGA MES DE AGOSTO"), or else the three letters under the dates. 1 to 12, or null.
  monthOf(reads, aboveY, labelWords) {
    const votes = new Array(12).fill(0);
    reads.forEach(read => (read.words || []).forEach(w => {
      if ((w.y0 + w.y1) / 2 >= aboveY) return;
      const word = League.nameKey(w.t).replace(/ /g, '');
      if (word.length < 4) return;
      this.MONTHS.forEach((month, i) => { if (League.editDistance(word, month, 2) <= 2 && Math.abs(word.length - month.length) <= 2) votes[i] += 1; });
    }));
    let best = votes.indexOf(Math.max(...votes));
    if (votes[best] > 0 && votes.filter(v => v === votes[best]).length === 1) return best + 1;
    // The labels under the dates: only a code with a single neighbour counts.
    const codes = new Array(12).fill(0);
    labelWords.forEach(text => {
      const word = League.nameKey(text).replace(/ /g, '');
      if (word.length !== 3) return;
      const near = this.MONTH_CODES.map((code, i) => (League.editDistance(word, code, 1) <= 1 ? i : -1)).filter(i => i >= 0);
      if (near.length === 1) codes[near[0]] += 1;
    });
    best = codes.indexOf(Math.max(...codes));
    return codes[best] > 0 && codes.filter(v => v === codes[best]).length === 1 ? best + 1 : null;
  },

  // Where the table is: its rows (numbers that share a height), its columns (numbers that share a place across the rows) and how
  // far apart the columns are. { ok: false, reason } when it cannot be found, or is not regular enough to trust.
  layout(tokens) {
    const fail = (reason) => ({ ok: false, reason });
    if (tokens.length < 12) return fail('No encontré los números de una tabla en la imagen: sube la captura de la tabla del mes de la tienda.');
    const h = this.median(tokens.map(t => t.h).filter(v => v > 0)) || 30;

    // Rows are the numbers that share a height; columns are the numbers that share a place across the rows.
    const bands = this.groups(tokens, t => t.y, h * 0.9).filter(g => g.items.length >= 3);
    const strong = this.groups(bands.flatMap(g => g.items), t => t.x, h * 0.8).filter(g => g.items.length >= Math.max(3, Math.round(bands.length * 0.4)));
    // How far apart the columns are, from the table itself: the yardstick for everything that follows (a poster can be any size).
    // It is the most usual gap between the columns that most rows reach: glued digits and stray marks make weak clusters in between
    // (a real column holds the numbers of every row, those hold a few), and counting them would halve the figure.
    const top = Math.max(0, ...strong.map(col => col.items.length));
    const core = strong.filter(col => col.items.length >= top * 0.5);
    const between = core.slice(1).map((col, i) => col.center - core[i].center);
    const bins = new Map();
    between.forEach(gap => { const bin = Math.round(gap / (h * 0.8)); bins.set(bin, (bins.get(bin) || 0) + 1); });
    const usual = [...bins.entries()].sort((a, b) => b[1] - a[1])[0];
    const spacing = usual ? this.median(between.filter(gap => Math.abs(Math.round(gap / (h * 0.8)) - usual[0]) <= 1)) : 0;
    if (!spacing) return fail('No encontré las columnas de la tabla: ¿es la tabla del mes de la tienda?');
    // Glued digits ("92" for "9" and "2") land between two columns: a weak column right next to a stronger one is not a column.
    let columns = strong.filter(col => !strong.some(other => other !== col && other.items.length > col.items.length && Math.abs(other.center - col.center) < spacing * 0.7));
    // The place column (1, 2, 3…) is numbers too, but the names lie between it and the first night: that gap is far wider than any other.
    const gaps = columns.slice(1).map((col, i) => col.center - columns[i].center);
    const wide = gaps.findIndex(gap => gap > this.median(gaps) * 3);
    const placeCenter = wide >= 0 ? columns[wide].center : null;
    if (wide >= 0) columns = columns.slice(wide + 1);
    // Night and reto columns come in pairs, and the total is one more: an odd count.
    if (columns.length < 3 || columns.length % 2 === 0) return fail('No encontré las columnas de la tabla: ¿es la tabla del mes de la tienda?');
    const count = (columns.length - 1) / 2;
    const last = columns.length - 1;
    // The columns of a poster are evenly spaced (the total sits a little further). A table whose columns are not has lost one, or
    // found one that is not there: reading it anyway could give rows that add up and are wrong, so it is refused.
    const regular = columns.slice(1).every((col, i) => {
      const gap = col.center - columns[i].center;
      return gap >= spacing * 0.75 && gap <= spacing * (i === last - 1 ? 2.2 : 1.3);
    });
    if (!regular) return fail('Las columnas de la tabla no se leyeron con claridad: prueba con una captura más nítida.');
    return { ok: true, h, bands, columns, spacing, placeCenter, count, last, reach: spacing * 0.4 };
  },

  // What one picture says about where things are: the layout, its rows split into cells, the rows of players (body), the header
  // above them, the height of one row, and the stretch of a row where the name is. { ok: false, reason } when there is no table.
  // Reads that cover only the names (`nameOnly`, crops of the name area) say nothing about figures, so they are left out here.
  scaffold(reads) {
    const found = this.layout(this.tokens(reads));
    if (!found.ok) return found;
    const { h, bands, columns, spacing, placeCenter, count, last, reach } = found;
    const fail = (reason) => ({ ok: false, reason });
    const columnOf = (t) => {
      let best = -1, dist = Infinity;
      columns.forEach((col, i) => { const d = Math.abs(col.center - t.x); if (d < dist) { dist = d; best = i; } });
      return dist <= reach ? best : -1;
    };
    const rows = bands.map(band => {
      const cells = columns.map(() => []);
      band.items.forEach(t => { const i = columnOf(t); if (i >= 0) cells[i].push(t); });
      return { y: band.center, cells, items: band.items };
    });
    // A row of players reaches the total column, or holds more than a header (which has only the dates) can.
    const body = rows.filter(row => row.cells[last].length > 0 || row.cells.filter(c => c.length).length >= count + 2);
    if (body.length < 2) return fail('No encontré las filas de jugadores de la tabla: prueba con una captura más nítida que la muestre completa.');
    const header = rows.filter(row => row.y < body[0].y - h).pop() || null;
    // The header's dates are a second count of the nights. More dates than night columns means columns were lost, and what was
    // read would add up on fewer nights than the poster has: refused rather than shown.
    if (header && this.groups(header.items, t => t.x, spacing * 0.5).length > count) return fail('Las columnas de la tabla no se leyeron con claridad: prueba con una captura más nítida.');
    const pitch = body.length > 1 ? this.median(body.slice(1).map((row, i) => row.y - body[i].y)) : h * 2.4;
    // The names live between the place column and the first night.
    const zone = [placeCenter === null ? 0 : placeCenter + spacing * 0.5, columns[0].center - spacing * 0.45];
    return { ok: true, found, rows, body, header, pitch, zone };
  },

  // Where to look to read a picture again in pieces: the middle of each row of players, the height of one row, the stretch of a row
  // that holds the name, and the one that holds the figures (picture coordinates). { ok: false } when there is no table to find.
  frame(reads) {
    const s = this.scaffold(reads);
    if (!s.ok) return s;
    const { columns, spacing } = s.found;
    return { ok: true, ys: s.body.map(row => row.y), pitch: s.pitch, names: s.zone, figures: [columns[0].center - spacing * 0.5, columns[columns.length - 1].center + spacing * 0.6] };
  },

  // The table: { ok, nights: [{ day }], month, rows: [{ name, nights, retos, total, flags, how }], flags }.
  // reads: [{ words: [{ t, c, x0, y0, x1, y1 }] }]. known: the players the person already has, to tell a name misread from theirs.
  // When the layout cannot be found, { ok: false, reason }.
  parse(allReads, known = []) {
    // The figure crops (`crop`) are one more vote for each cell. If they ever upset where the table is found, it is found without them.
    let reads = allReads;
    let s = this.scaffold(reads);
    if (!s.ok && reads.some(read => read.crop)) {
      reads = reads.filter(read => !read.crop);
      s = this.scaffold(reads);
    }
    if (!s.ok) return s;
    const { h, columns, count, last, reach } = s.found;
    const { body, header, pitch, zone } = s;
    const pages = reads.filter(read => !read.nameOnly);

    // The nights' days come from the header's numbers; the month, from the title or the labels under them.
    const nights = [];
    const labels = [];
    for (let n = 0; n < count; n++) {
      const found = header ? this.candidates(header.cells[n * 2], 31).filter(c => c.n >= 1) : [];
      nights.push({ day: found.length ? found[0].n : null });
      const x = columns[n * 2].center;
      pages.forEach(read => (read.words || []).forEach(w => {
        const cx = (w.x0 + w.x1) / 2, cy = (w.y0 + w.y1) / 2;
        if (header && Math.abs(cx - x) <= reach && cy > header.y + h * 0.3 && cy < body[0].y - h * 0.8) labels.push(w.t);
      }));
    }
    const month = this.monthOf(pages, body[0].y - h * 3, labels);

    const result = body.map(row => {
      const solved = this.solveRow(row.cells.map((cands, i) => this.candidates(cands, i === last ? this.MAX_TOTAL : this.MAX_CELL)));
      const v = solved.values;
      const named = this.rowNames(reads, zone, row.y - pitch / 2, row.y + pitch / 2);
      const read = this.titleCase(named.name);
      const snap = named.name ? this.snapName(read, known) : { name: '', snapped: false, guessed: false };
      const flags = [...solved.flags];
      if (!named.name) flags.push('noname');
      else if (snap.guessed) flags.push('snapped');
      else if (named.doubtful && !snap.snapped) flags.push('name');
      return {
        name: snap.name,
        read,
        nights: Array.from({ length: count }, (_, n) => v[n * 2]),
        retos: Array.from({ length: count }, (_, n) => v[n * 2 + 1]),
        total: v[last],
        flags,
        how: solved.how,
        y: Math.round(row.y)
      };
    });
    const flags = [];
    if (nights.some(n => n.day === null) || month === null) flags.push('dates');
    return { ok: true, nights, month, rows: result, flags };
  },

  // A row adds up when its nights and retos make its total and every figure is there.
  balanced(row) {
    if (row.nights.some(n => n === null) || row.retos.some(n => n === null) || row.total === null) return false;
    return row.nights.reduce((a, b) => a + b, 0) + row.retos.reduce((a, b) => a + b, 0) === row.total;
  },

  // A row nothing doubts: it adds up, and no figure or name in it is a guess or in dispute.
  clean(row) {
    return this.balanced(row) && !row.flags.some(flag => ['name', 'noname', 'snapped', 'conflict'].includes(flag))
      && !(row.how || []).some(how => how === 'derived' || how === 'fixed');
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
      const claims = table.rows.map(row => League.matchPlayer(row.name, before));
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
          // Two rows of the poster that came out with one name are one player, not two.
          const key = League.nameKey(store.name);
          if (rows.some(other => other && typeof other.name === 'string' && League.nameKey(other.name) === key)) return;
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
