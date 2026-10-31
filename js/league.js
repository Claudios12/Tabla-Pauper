// The league table: reading the standings screen and adding every player's points up per season.
/* global CONFIG, Analytics, isIsoDate, isStoreNight */
/* exported League */

// ══════════════════════════════════════════════════════════════════
// LEAGUE
// A tournament may carry playerResults: one { name, pts, wl } row per player on the standings screen.
// Names are stored as the scan read them; the spellings of one person are joined only when the table is built,
// so improving the matching later never needs the saved data to change.
// ══════════════════════════════════════════════════════════════════
const League = {
  MAX_PTS: 60,
  // Words a screenshot has in its header or footer; a line starting with one is never a player.
  NOT_A_NAME: ['ronda', 'round', 'jugador', 'jugadores', 'player', 'players', 'puntos', 'points', 'pts', 'total', 'standings',
    'clasificacion', 'posicion', 'puesto', 'nombre', 'name', 'rank', 'torneo', 'record', 'mesa', 'fecha'],

  // Lower case, no accents, letters and digits only: what two spellings of one name have in common.
  nameKey(raw) {
    return String(raw ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ').trim();
  },

  // "Rubén Darío M…": the screen cut the name short, so what is left is the start of the full one.
  isTruncated(raw) {
    return /(\.{2,}|…)\s*$/.test(String(raw ?? ''));
  },

  // Who "me" is, as the person wrote it: the names they appear under on the standings screens, several spellings separated by
  // commas ("Ana Pérez, Anita Pérez"). In each, the first word is the first name and the rest are surnames; a spelling of one
  // word is a handle that stands alone. Each spelling is judged on its own, so what is listed is what matches and no word of
  // one is mixed with another's. Nothing is known until the person says: no name, no "me".
  identify(text) {
    this.spellings = String(text ?? '').split(/[,;\n]+/)
      .map(spelling => this.nameKey(spelling).split(' ').filter(Boolean))
      .filter(words => words.length)
      .map(words => ({ first: words[0], lasts: words.slice(1) }));
  },
  spellings: [],

  isMyName(raw) {
    const words = this.nameKey(raw).split(' ').filter(Boolean);
    return words.length > 0 && this.spellings.some(spelling => this.matchesSpelling(raw, words, spelling));
  },

  // Whole words, never pieces of a word: "Christopher" is not "Chris", another Christian is not the user, and neither is
  // Cristhian (a letter from Cristian) who is cut off at "Cristhian M…". A whole name needs a first name and a surname (a
  // letter off is fine, for a misread). A name the screen cut short must start with the first name exactly and what shows
  // of the surname must be the start of it: "Christian Do…" is the user; "Cristhian M…" and "Christian Pe…" are not.
  matchesSpelling(raw, words, { first, lasts }) {
    // The dots of a cut-off name can be lost in the read ("Christian Do" for "Christian Do…"): a last word that stops short of
    // a surname counts as cut off all the same.
    const last = words[words.length - 1];
    const stopsShort = words.length > 1 && last.length >= 2 && lasts.some(alias => alias.length > last.length && alias.startsWith(last));
    if (this.isTruncated(raw) || stopsShort) {
      const piece = last;
      if (words.length === 1) return piece.length >= 4 && [first, ...lasts].some(alias => alias.startsWith(piece));
      return (words[0] === first && lasts.some(alias => alias.startsWith(piece)))
        || (lasts.includes(words[0]) && first.startsWith(piece));
    }
    if (words.length === 1) return words[0] === first || lasts.includes(words[0]);
    const near = (aliases) => words.some(word => aliases.some(alias => word === alias || (alias.length >= 5 && this.editDistance(word, alias, 1) <= 1)));
    return lasts.length > 0 && near([first]) && near(lasts);
  },

  // Whether any way a spelling was read is the user's own name (the cut-off marks are only in the names as read).
  spellingIsMine(spelling) {
    return [...spelling.forms.keys()].some(form => this.isMyName(form));
  },

  // The ellipsis a cut-off name ends in stays; the rank, the dots and the stray symbols around a name go.
  cleanName(raw) {
    return String(raw ?? '').trim()
      .replace(/^[\d.#\-—–\sº°|]+/, '')
      .replace(/\.{2,}\s*$/, '…')
      .replace(/[\s:|\-—–_]+$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 60);
  },

  // What a piece of a line is: a record, a percentage, a number, a label, digits that were a record once, a stray symbol, or a word.
  cellKind(cell) {
    if (/^\d{1,2}-\d{1,2}-\d$/.test(cell)) return 'record';
    if (/^\d{1,4}%$|^\d{1,3}[.,]\d{1,2}$/.test(cell)) return 'percent';
    if (/^\d{1,3}$/.test(cell)) return Number(cell) <= this.MAX_PTS ? 'int' : 'junk';
    if (/^(?:pts|puntos|pt)$/i.test(cell)) return 'label';
    if (/^[\d\-–—:/.,%]+$/.test(cell)) return 'junk';
    if (!/[\p{L}\d]/u.test(cell)) return 'glyph';
    return 'word';
  },

  // One line of the standings screen. The cells on the right are figures (points, record, percentages) and what is left
  // is the rank and the name. Returns { name, rank, printed, wl } or null when the line is not a player.
  parseLine(line) {
    const text = String(line ?? '').replace(/[|│｜!¦]/g, ' ')
      .replace(/(\d)(pts|puntos)\b/gi, '$1 $2')
      .replace(/(\d{1,2})\s*[-–—:/]\s*(\d{1,2})\s*[-–—:/]\s*([0-9Oo])\b/g, (all, w, l, d) => ` ${w}-${l}-${/[Oo]/.test(d) ? 0 : d} `);
    const cells = text.split(/\s+/).filter(Boolean);

    // Right to left while the cells are figures or symbols; a symbol there stands for a figure that could not be read.
    const metrics = [];
    while (cells.length) {
      const kind = this.cellKind(cells[cells.length - 1]);
      if (kind === 'word') break;
      const cell = cells.pop();
      if (kind !== 'glyph') metrics.unshift({ cell, kind });
    }
    const record = metrics.find(m => m.kind === 'record');
    const ints = metrics.map((m, at) => ({ ...m, at })).filter(m => m.kind === 'int');
    const labelAt = metrics.findIndex(m => m.kind === 'label');
    let printed = null;
    if (labelAt > 0 && metrics[labelAt - 1].kind === 'int') {
      printed = Number(metrics[labelAt - 1].cell);
    } else if (record) {
      // Points sit next to the record: the figure just before it, or just after it.
      const at = metrics.indexOf(record);
      const next = ints.filter(m => m.at < at).pop() || ints.find(m => m.at > at);
      printed = next ? Number(next.cell) : null;
    } else if (ints.length) {
      printed = Number(ints[0].cell);
    }

    let rank = null;
    if (cells.length > 1 && /^#?\d{1,3}[.)°º:]?$/.test(cells[0])) rank = parseInt(cells.shift().replace(/\D/g, ''), 10);
    // Avatars and frame lines leave symbols and lone letters around the name. Whatever is not a letter or a digit comes off
    // the ends of a word (the dots of a cut-off name stay); a piece that is only symbols, or a symbol with a letter or two,
    // is dropped.
    const edge = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}.…]+$/gu;
    const pieces = cells.map(cell => ({ bare: cell.replace(edge, ''), stuck: cell.replace(edge, '') !== cell }));
    const keeps = (piece) => /\p{L}/u.test(piece.bare) && !(piece.stuck && piece.bare.length <= 2);
    const words = pieces.filter(keeps).map(piece => piece.bare);
    // Whether something stood in front of the name that looks like an avatar: a symbol, a stuck bracket, a lone letter.
    let prefixed = pieces.length > 0 && (!keeps(pieces[0]) || pieces[0].stuck);
    while (words.length > 2 && words[0].length === 1) {
      words.shift();
      prefixed = true;
    }
    // Two letters in front of a name may be an avatar's initial: scan() decides once it has seen every row.
    const lead = words.length > 2 && /^\p{L}{2}$/u.test(words[0]);
    // The screen cuts a long name with "…" and nothing real follows it: what does is a figure misread as letters
    // ("Roosevelt Bl... A 2-2-1"). Likewise, a letter or two between a name and its record when no points were read is
    // the points, misread: it is not part of the name ("Fredy Castro S 3-1-0").
    const cutAt = words.findIndex(word => /(\.{2,}|…)$/.test(word));
    if (cutAt >= 0) words.length = cutAt + 1;
    else if (printed === null && record && words.length > 2 && words[words.length - 1].length <= 2) words.pop();

    const name = this.cleanName(words.join(' '));
    if ((name.match(/\p{L}/gu) || []).length < 2 || words.length > 6) return null;
    if (this.NOT_A_NAME.includes(this.nameKey(name).split(' ')[0])) return null;
    // Without a rank, a record or a figure, a line of words is only text. A single word is a player only with a record, or
    // with a place and points together: a date written over the picture ("July 16", "16 Jul") is a word and one figure.
    if (rank === null && printed === null && !record) return null;
    if (words.length < 2 && !record && !(rank !== null && printed !== null)) return null;
    return { name, rank, printed, wl: record ? record.cell : '', lead, prefixed: prefixed || lead };
  },

  // Cross-checks a whole scan. Rows keep what was read. Points are filled in only from a clean record (marked calculated)
  // or between two rows with the same points (marked estimated), and every row that does not add up is flagged for a person.
  review(rows) {
    const out = rows.map(row => ({ name: row.name, rank: row.rank, pts: null, wl: row.wl, flags: [] }));
    // The rounds of this event: the record total most rows agree on.
    const totals = new Map();
    out.forEach(row => {
      const record = Analytics.parseWLD(row.wl);
      if (record) totals.set(record.w + record.l + record.d, (totals.get(record.w + record.l + record.d) || 0) + 1);
    });
    const [rounds, votes] = [...totals].sort((a, b) => b[1] - a[1])[0] || [0, 0];
    out.forEach((row, i) => {
      let record = Analytics.parseWLD(row.wl);
      const played = record ? record.w + record.l + record.d : 0;
      // More matches than the event had rounds can only be a misread: the record is dropped, never saved.
      if (record && votes >= 3 && played > rounds) {
        row.flags.push('record');
        row.wl = '';
        record = null;
      }
      const calc = record ? Analytics.calculatePoints(record.w, record.d) : null;
      if (rows[i].printed !== null) {
        // The printed figure is the official one (special events score differently): it wins over the record.
        row.pts = rows[i].printed;
        if (calc !== null && calc !== row.pts) {
          row.flags.push('mismatch');
          row.calcPts = calc;
        }
      } else if (calc !== null) {
        row.pts = calc;
        row.calculated = true;
        // Fewer matches than rounds is a player who dropped, or a digit misread: when the points come from this
        // record and nothing else, that is worth a look. (With printed points a short record is simply a drop.)
        if (votes >= 3 && played < rounds) row.flags.push('short');
      }
    });
    // Standings list the best first: a figure above the one before it is a misread, in one of the two rows.
    for (let i = 1; i < out.length; i++) {
      const above = out[i - 1], row = out[i];
      if (above.pts === null || row.pts === null || row.pts <= above.pts) continue;
      const before = i >= 2 ? out[i - 2].pts : null;
      const wrong = (before === null || row.pts <= before) ? above : row;
      if (!wrong.flags.includes('order')) wrong.flags.push('order');
    }
    // Places only go up: one lower than the place above is a digit lost or misread.
    for (let i = 1; i < out.length; i++) {
      const a = out[i - 1].rank, b = out[i].rank;
      if (a !== null && b !== null && b < a) out[i].flags.push('rank');
    }
    // A figure that could not be read, between two rows with the same points, can only be those points.
    out.forEach((row, i) => {
      if (row.pts !== null) return;
      const a = out[i - 1] ? out[i - 1].pts : null, b = out[i + 1] ? out[i + 1].pts : null;
      if (a !== null && a === b) {
        row.pts = a;
        row.flags.push('estimated');
      } else {
        row.flags.push('nopts');
      }
    });
    // Which places are not on the list. With one place read twice (a tie) the places cannot be told apart, so only a count.
    const ranks = out.map(row => row.rank).filter(rank => rank !== null);
    const top = ranks.reduce((most, rank) => Math.max(most, rank), 0);
    const missingPlaces = new Set(ranks).size === ranks.length ? Array.from({ length: top }, (_, i) => i + 1).filter(place => !ranks.includes(place)) : [];
    const missing = missingPlaces.length || Math.max(0, top - out.length);
    return { rows: out, rounds: votes >= 3 ? rounds : null, missing, missingPlaces, calculated: out.some(row => row.calculated) };
  },

  // Whether a name is one the season already has: the same, a misreading of it, or the start of it when the screen cut it off.
  isKnown(name, known) {
    const key = this.nameKey(name);
    return known.some(other => {
      const otherKey = this.nameKey(other);
      return otherKey === key || this.isNearDuplicate(otherKey, key)
        || (this.isTruncated(name) && otherKey.startsWith(key)) || (this.isTruncated(other) && key.startsWith(otherKey));
    });
  },

  // The rows a text holds, as each line reads (no cross-checks yet). An avatar column shows as something in front of the name
  // on most rows of a picture; real names do not do that on most rows.
  parseText(text) {
    const parsed = [];
    String(text ?? '').split('\n').forEach(line => {
      const row = this.parseLine(line);
      if (row) parsed.push(row);
    });
    if (parsed.length >= 6 && parsed.filter(row => row.prefixed).length >= parsed.length / 2) {
      parsed.forEach(row => { if (row.lead) row.name = this.cleanName(row.name.split(' ').slice(1).join(' ')); });
    }
    return parsed;
  },

  // Every player a picture can read, once each, in the order the screen lists them, cross-checked as a whole.
  // known: the players the season's table already has, to tell a misread name from one it has seen before.
  scan(text, known = []) {
    return this.extend([], text, known);
  },

  // Whether a stretch of rows (read from one picture) has places that only climb: the order a picture is read in.
  climbs(rows) {
    let last = 0;
    return rows.every(row => {
      if (row.rank === null) return true;
      const ok = row.rank > last;
      last = row.rank;
      return ok;
    });
  },

  // Whether two rows, from two pictures of one table, are the same player: the same name, or the same place with names that
  // can be one (one a misreading of the other, or one the start of the other when the screen cut it off).
  sameRow(a, b) {
    const keyA = this.nameKey(a.name), keyB = this.nameKey(b.name);
    if (keyA === keyB) return true;
    if (a.rank === null || b.rank === null || a.rank !== b.rank) return false;
    return this.isNearDuplicate(keyA, keyB)
      || (this.isTruncated(a.name) && keyB.startsWith(keyA)) || (this.isTruncated(b.name) && keyA.startsWith(keyB));
  },

  // Adds what another picture of the same table holds to the rows already read (none at first), as one table. The rows
  // already there stay as they are, edits and warnings included. A row that is the same player is not added again, and
  // its points are never added to theirs: where the new one has what the other lacks it fills it in, and where the two
  // disagree the one already there stays and is flagged. Two different players on one place are both kept and flagged.
  // The rows come out in the order of the places, and the whole table is checked together (the missing places, the
  // rounds, the order of the points), so a picture of the second half is not a table with a hole in it.
  extend(existing, text, known = []) {
    const added = [];
    let same = 0, filled = 0, conflicts = 0;
    this.parseText(text).forEach(row => {
      if (!this.nameKey(row.name)) return;
      const twin = existing.find(other => this.sameRow(other, row));
      if (twin) {
        same++;
        if (twin.pts === null && row.printed !== null) {
          twin.pts = row.printed;
          twin.flags = twin.flags.filter(flag => flag !== 'nopts' && flag !== 'estimated');
          filled++;
        } else if (twin.pts !== null && row.printed !== null && twin.pts !== row.printed) {
          twin.otherPts = row.printed;
          if (!twin.flags.includes('conflict')) twin.flags.push('conflict');
          conflicts++;
        }
        if (!twin.wl && row.wl) twin.wl = row.wl;
        return;
      }
      // The same player twice in one picture counts once.
      const again = added.find(other => this.sameRow(other, row));
      if (again) {
        if (again.printed === null && row.printed !== null) again.printed = row.printed;
        if (!again.wl && row.wl) again.wl = row.wl;
        return;
      }
      added.push(row);
    });

    // The rows in the order of their places. Two pictures that each climb (as they do when one is scrolled further than the
    // other) are interleaved by place; otherwise the picture that starts higher goes first, each in its own order.
    const held = existing.map(row => ({ row, fresh: false })), news = added.map(row => ({ row, fresh: true }));
    let items;
    if (this.climbs(existing) && this.climbs(added)) {
      const keyed = (list) => { let carry = 0; return list.map(item => { carry = item.row.rank ?? carry; return { ...item, key: carry }; }); };
      const a = keyed(held), b = keyed(news);
      items = [];
      while (a.length || b.length) items.push(!b.length || (a.length && a[0].key <= b[0].key) ? a.shift() : b.shift());
    } else {
      const first = (list) => list.reduce((least, item) => (item.row.rank === null ? least : Math.min(least, item.row.rank)), Infinity);
      items = first(held) <= first(news) ? [...held, ...news] : [...news, ...held];
    }

    // The whole table is read together; only the warnings of rows that were just added are taken from it, apart from the
    // ones that can only come from comparing rows (the order of points and places), which can fall on a row already there.
    const reviewed = this.review(items.map(({ row, fresh }) => (fresh ? row : { name: row.name, rank: row.rank, printed: row.pts, wl: row.wl })));
    const rows = items.map((item, i) => {
      if (item.fresh) return reviewed.rows[i];
      reviewed.rows[i].flags.filter(flag => flag === 'order' || flag === 'rank').forEach(flag => { if (!item.row.flags.includes(flag)) item.row.flags.push(flag); });
      return item.row;
    });
    // Two players that claim one place were not read from one table: both are flagged.
    rows.forEach((row, i) => rows.slice(i + 1).forEach(other => {
      if (row.rank !== null && row.rank === other.rank && !this.sameRow(row, other)) {
        [row, other].forEach(each => { if (!each.flags.includes('place')) each.flags.push('place'); });
      }
    }));
    // With a roster to compare against, a name it has never seen is new or misread: either way, worth a look. But early in a
    // season many names are simply new, so only when most of what was added is known are the few strangers worth flagging.
    if (known.length >= 8) {
      const fresh = rows.filter((row, i) => items[i].fresh);
      const strangers = fresh.filter(row => !this.isKnown(row.name, known));
      if (strangers.length <= fresh.length * 0.3) strangers.forEach(row => row.flags.push('new'));
    }
    return {
      rows, added: added.length, same, filled, conflicts,
      rounds: reviewed.rounds, missing: reviewed.missing, missingPlaces: reviewed.missingPlaces, calculated: rows.some(row => row.calculated)
    };
  },

  // The same, for a tournament that is already saved: its stored rows ({ name, pts, wl }) and the ones to add. A player who is
  // already there is not added again (the points are never added up) and keeps what was saved; a record the saved row lacks
  // is filled in. Where the two give different points the saved ones stay and it is counted.
  mergeStored(saved, incoming) {
    // The rows the league table accepts (see cleanRows), kept as they were saved; a row the table ignores has no points to lose.
    // A table that is not a list at all (a damaged save) counts as empty instead of stopping the merge.
    const valid = (row) => this.cleanRows([row]).length === 1;
    const rows = (Array.isArray(saved) ? saved : []).filter(valid).map(row => ({ ...row }));
    const result = { rows, added: 0, conflicts: 0 };
    (Array.isArray(incoming) ? incoming : []).filter(valid).forEach(row => {
      const key = this.nameKey(row.name);
      // The same name, or a misreading of it; the start of a cut-off name only when it can be only one of the players there.
      const twins = rows.filter(other => this.nameKey(other.name) === key || this.isNearDuplicate(this.nameKey(other.name), key));
      const starts = rows.filter(other => (this.isTruncated(row.name) && this.nameKey(other.name).startsWith(key)) || (this.isTruncated(other.name) && key.startsWith(this.nameKey(other.name))));
      const twin = twins[0] || (starts.length === 1 ? starts[0] : null);
      if (!twin) {
        rows.push({ ...row });
        result.added++;
        return;
      }
      if (Number(twin.pts) !== Number(row.pts)) result.conflicts++;
      if (!twin.wl && row.wl) twin.wl = row.wl;
    });
    return result;
  },

  parseStandings(text, known) {
    return this.scan(text, known).rows;
  },

  // Where a read of the whole page skipped rows. lines: [{ y0, y1, row }] in screen order, row being the parsed line (or null).
  // For every run of missing places it returns { places, y0, y1 }: the stretch of the picture, between the rows on either
  // side, where those rows sit. A page whose places do not climb one by one (ties, a misread digit) cannot say.
  gaps(lines) {
    const rows = lines.filter(line => line.row && line.row.rank !== null);
    const ranks = rows.map(line => line.row.rank);
    if (rows.length < 2 || new Set(ranks).size !== ranks.length || ranks.some((rank, i) => i > 0 && rank < ranks[i - 1])) return [];
    // How far apart consecutive rows are, from the pairs that are one place apart.
    const steps = rows.slice(1).map((line, i) => line.y0 - rows[i].y0).filter((step, i) => ranks[i + 1] - ranks[i] === 1).sort((a, b) => a - b);
    const pitch = steps.length ? steps[Math.floor(steps.length / 2)] : 0;
    if (!pitch) return [];
    const places = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
    const found = [];
    const first = rows[0];
    if (first.row.rank > 1) {
      // The places before the first row read sit between the header (the last line above it) and that row.
      const header = lines.filter(line => line !== first && line.y1 <= first.y0).pop();
      const slots = first.row.rank - 1;
      found.push({
        places: places(1, slots),
        y0: Math.max(0, header ? Math.max(header.y1, first.y0 - (slots + 0.6) * pitch) : first.y0 - (slots + 0.2) * pitch),
        y1: first.y0
      });
    }
    rows.forEach((line, i) => {
      const next = rows[i + 1];
      if (next && next.row.rank - line.row.rank > 1) found.push({ places: places(line.row.rank + 1, next.row.rank - 1), y0: line.y1, y1: next.y0 });
    });
    // A gap has to be tall enough for all the rows it should hold: a picture that is the second half of a table starts at
    // place 18 with no room above it for the 17 before.
    return found.filter(gap => gap.y1 - gap.y0 >= gap.places.length * pitch * 0.6);
  },

  // What a saved tournament may carry, whatever a backup file put there: only well-formed rows come back.
  cleanRows(raw) {
    return this.cleanRowsAt(raw).rows;
  },

  // The same, and where each clean row sits in what is stored (`at`, an index of raw), for code that writes back into it.
  cleanRowsAt(raw) {
    const rows = [], at = [];
    if (!Array.isArray(raw)) return { rows, at };
    raw.forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      const name = typeof item.name === 'string' ? item.name.trim().slice(0, 60) : '';
      const pts = typeof item.pts === 'string' && item.pts.trim() !== '' ? Number(item.pts) : item.pts;
      if (!this.nameKey(name) || !Number.isInteger(pts) || pts < 0 || pts > this.MAX_PTS) return;
      const record = Analytics.parseWLD(item.wl);
      const row = record ? { name, pts, w: record.w, l: record.l, d: record.d } : { name, pts };
      // The extra points of a side quest that night (the store's "reto"), when the store's table was added. A figure that
      // makes no sense is left out; the row itself stays.
      const reto = typeof item.reto === 'string' && item.reto.trim() !== '' ? Number(item.reto) : item.reto;
      if (Number.isInteger(reto) && reto > 0 && reto <= this.MAX_PTS) row.reto = reto;
      rows.push(row);
      at.push(index);
    });
    return { rows, at };
  },

  // The rows of a table the person scanned, completed with those of a night made from the store's table for the same day: the person's
  // own points stay; the store's retos and the players the scan missed come in, and nobody of the store's night is dropped.
  absorb(rows, storeRows) {
    const out = rows.map(row => ({ ...row }));
    const scanned = out.slice();
    const done = { added: 0, retos: 0 };
    // Only the rows of the scan can be the same player as a player of the store's night (never one just brought in from it): two
    // players of the store's night with names a letter apart are two players. A name that fits more than one scanned row cannot be
    // pinned on one, so that player comes in as a row of their own: nobody of the store's night is dropped.
    this.cleanRows(storeRows).forEach(store => {
      const match = this.matchPlayer(store.name, scanned);
      if (match.at >= 0) {
        if (store.reto && !out[match.at].reto) { out[match.at].reto = store.reto; done.retos++; }
      } else {
        out.push(store.reto ? { name: store.name, pts: store.pts, reto: store.reto } : { name: store.name, pts: store.pts });
        done.added++;
      }
    });
    return { rows: out, ...done };
  },

  // The row of one night's stored table ({ name, pts }) that is this player, and how sure that is. Stricter than joining the
  // spellings of the season, because here two different players of one night can have alike names ("Santiago Ramos" and
  // "Santiago Rojas"): the exact name wins outright, and only without one does a close name count.
  //   exact  the same name, case, accents and punctuation aside
  //   near   one letter off, in a long name (a misreading)
  //   cut    the spelling this one starts, when the screen cut it off
  // at is the row's index; -1 when nobody is; -2 when more than one could be.
  matchPlayer(name, rows) {
    const key = this.nameKey(name);
    if (!key || !Array.isArray(rows)) return { at: -1, how: null };
    const found = { exact: [], near: [], cut: [] };
    rows.forEach((row, i) => {
      if (!row || typeof row.name !== 'string') return;
      const other = this.nameKey(row.name);
      if (!other) return;
      if (other === key) found.exact.push(i);
      else if (Math.min(other.length, key.length) >= 10 && other[0] === key[0] && this.editDistance(other, key, 1) <= 1) found.near.push(i);
      else if ((this.isTruncated(row.name) && key.startsWith(other)) || (this.isTruncated(name) && other.startsWith(key))) found.cut.push(i);
    });
    for (const how of ['exact', 'near', 'cut']) {
      if (found[how].length) return { at: found[how].length === 1 ? found[how][0] : -2, how };
    }
    return { at: -1, how: null };
  },

  findPlayer(name, rows) {
    return this.matchPlayer(name, rows).at;
  },

  // Edits (a letter changed, lost or added) between two keys, counted up to max + 1.
  // Only the band of the table within max of the diagonal can matter (anything outside it is already past max), so only
  // that band is worked out, on two rows that are reused. It stops once the whole band is past max.
  editDistance(a, b, max) {
    const n = a.length, m = b.length, over = max + 1;
    if (Math.abs(n - m) > max || m > 79) return over;
    const rows = this._rows || (this._rows = [new Int32Array(80), new Int32Array(80)]);
    let prev = rows[0], cur = rows[1];
    for (let j = 0; j <= m; j++) prev[j] = j <= max ? j : over;
    for (let i = 1; i <= n; i++) {
      const from = Math.max(1, i - max), to = Math.min(m, i + max);
      cur[from - 1] = from === 1 && i <= max ? i : over;
      let lowest = cur[from - 1];
      for (let j = from; j <= to; j++) {
        const edits = Math.min(prev[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1), prev[j] + 1, cur[j - 1] + 1);
        cur[j] = edits > over ? over : edits;
        if (cur[j] < lowest) lowest = cur[j];
      }
      if (to < m) cur[to + 1] = over;
      if (lowest > max) return over;
      [prev, cur] = [cur, prev];
    }
    return Math.min(prev[m], over);
  },

  // Two keys a letter apart are the same person read twice, once they are long enough for that to be rare. Two letters
  // apart is still one person when the name is long and a whole word of it agrees.
  isNearDuplicate(a, b) {
    const shortest = Math.min(a.length, b.length);
    if (shortest < 10 || a[0] !== b[0]) return false;
    // A stray letter or two stuck on the end of an otherwise whole name.
    if ((a.startsWith(b) || b.startsWith(a)) && Math.abs(a.length - b.length) <= 2) return true;
    const edits = this.editDistance(a, b, 2);
    if (edits <= 1) return true;
    const wordsA = a.split(' '), wordsB = b.split(' ');
    return edits === 2 && shortest >= 12 && wordsA.length === wordsB.length && wordsA.some((word, i) => word === wordsB[i] && word.length >= 5);
  },

  // Joins the spellings of one person. Two spellings that stand on the same night's screen are two people.
  groupPlayers(nights) {
    const spellings = new Map();
    nights.forEach((rows, night) => rows.forEach(row => {
      const key = this.nameKey(row.name);
      if (!key) return;
      let spelling = spellings.get(key);
      if (!spelling) {
        spelling = { key, forms: new Map(), cut: true, nights: new Set() };
        spellings.set(key, spelling);
      }
      spelling.forms.set(row.name, (spelling.forms.get(row.name) || 0) + 1);
      if (!this.isTruncated(row.name)) spelling.cut = false;
      spelling.nights.add(night);
    }));

    const list = [...spellings.values()];
    const groups = list.map(spelling => ({ members: [spelling], nights: new Set(spelling.nights), merged: false }));
    const groupOf = new Map(list.map((spelling, i) => [spelling.key, groups[i]]));
    const join = (a, b) => {
      const into = groupOf.get(a.key), from = groupOf.get(b.key);
      if (into === from) return;
      for (const night of from.nights) if (into.nights.has(night)) return;
      into.members.push(...from.members);
      from.nights.forEach(night => into.nights.add(night));
      from.members.forEach(member => groupOf.set(member.key, into));
      from.merged = true;
    };

    const whole = list.filter(spelling => !spelling.cut);
    // Only long spellings that start with the same letter can be one person read twice, so only those are compared.
    const byLetter = new Map();
    whole.forEach(spelling => {
      if (spelling.key.length < 10) return;
      if (!byLetter.has(spelling.key[0])) byLetter.set(spelling.key[0], []);
      byLetter.get(spelling.key[0]).push(spelling);
    });
    // ...and never when they differ in length by more than two letters, so each only meets its neighbours by length.
    byLetter.forEach(group => {
      group.sort((a, b) => a.key.length - b.key.length);
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length && group[j].key.length - group[i].key.length <= 2; j++) {
          if (this.isNearDuplicate(group[i].key, group[j].key)) join(group[i], group[j]);
        }
      }
    });
    const mine = whole.filter(spelling => this.spellingIsMine(spelling));
    mine.slice(1).forEach(spelling => join(mine[0], spelling));
    // A cut-off name belongs to the one longer spelling it starts, whole or itself cut off ("Cristhian M…" and "Cristhian
    // Mac…" are one person), and only when exactly one person fits.
    list.filter(spelling => spelling.cut && spelling.key.length >= 4).forEach(cut => {
      const owners = new Set(list
        .filter(other => other !== cut && other.key.length > cut.key.length && other.key.startsWith(cut.key))
        .map(other => groupOf.get(other.key)));
      if (owners.size === 1) join([...owners][0].members[0], cut);
    });
    return { groups: groups.filter(group => !group.merged), groupOf };
  },

  // The name a person is shown under: the whole spelling seen most often.
  displayName(group) {
    const forms = new Map();
    group.members.forEach(member => member.forms.forEach((count, form) => forms.set(form, (forms.get(form) || 0) + count)));
    return [...forms].sort((a, b) =>
      (this.isTruncated(a[0]) - this.isTruncated(b[0])) || (b[1] - a[1]) || (b[0].length - a[0].length))[0][0];
  },

  // The table for a set of tournaments (one season): everyone's points, best first, and where the cut falls. top: how many
  // places qualify in that season. Each player also carries the points of every night they were on, for estimating the rest.
  //
  // The nights that count are the person's own tournaments that have a table, and the nights made from the store's monthly table
  // (entries with source 'store': nobody's tournament, only a table). A night made from the store's table counts only where the person
  // has no table of their own for that day, so a day is never added twice; where they have a tournament with no table, it stands in
  // for the table that tournament lacks.
  standings(entries, top = CONFIG.LEAGUE.TOP_CUTOFF) {
    let played = 0, captured = 0, maxRounds = 0, maxNightPts = 0;
    const nights = [];
    const isOwn = (entry) => !!entry && !!entry.deck && entry.deck !== 'No participó';
    // What each entry's table holds, as the league reads it: worked out once per entry (it is the costliest part of this).
    const tables = new Map(entries.map(entry => [entry, this.cleanRows(entry && entry.playerResults)]));
    // A day is its date: an entry without a real one cannot say which day it is, so it takes no part in deciding whose table counts.
    const dayOf = (entry) => (isIsoDate(entry.isoDate) ? entry.isoDate : null);
    const ownDays = new Set(entries.filter(isOwn).map(dayOf).filter(Boolean));
    const ownTableDays = new Set(entries.filter(entry => isOwn(entry) && tables.get(entry).length).map(dayOf).filter(Boolean));
    const storeNights = new Map();
    entries.filter(isStoreNight).forEach(entry => {
      const day = dayOf(entry);
      if (day && tables.get(entry).length && !storeNights.has(day)) storeNights.set(day, tables.get(entry));
    });
    entries.forEach(entry => {
      if (!isOwn(entry)) return;
      played++;
      const rows = tables.get(entry);
      const day = dayOf(entry);
      if (rows.length) { nights.push(rows); captured++; } else if (day && storeNights.has(day) && !ownTableDays.has(day)) captured++;
    });
    // The store's nights: the days the person has no table of their own for. Those on days they have no tournament at all are the
    // ones whose points are theirs only through the table (the tournament figures cover the rest).
    const storeOnly = new Set();
    let stored = 0;
    storeNights.forEach((rows, day) => {
      if (ownTableDays.has(day)) return;
      nights.push(rows);
      stored++;
      if (!ownDays.has(day)) storeOnly.add(rows);
    });

    const { groups, groupOf } = this.groupPlayers(nights);
    const totals = new Map(groups.map(group => [group, { name: this.displayName(group), pts: 0, retoPts: 0, storePts: 0, storeNights: 0, w: 0, l: 0, d: 0, withRecord: 0, nights: 0, nightPts: [], isMe: group.members.some(spelling => this.spellingIsMine(spelling)) }]));
    nights.forEach(rows => {
      const counted = new Set();
      rows.forEach(row => {
        const group = groupOf.get(this.nameKey(row.name));
        if (!group || counted.has(group)) return;
        counted.add(group);
        const total = totals.get(group);
        // What a night gave is its points and its reto (the store's side-quest points), the same way the store adds them up.
        const night = row.pts + (row.reto || 0);
        total.pts += night;
        total.retoPts += row.reto || 0;
        if (storeOnly.has(rows)) { total.storePts += row.pts; total.storeNights++; }
        total.nights++;
        total.nightPts.push(night);
        maxNightPts = Math.max(maxNightPts, night);
        if (row.w !== undefined) {
          total.w += row.w;
          total.l += row.l;
          total.d += row.d;
          total.withRecord++;
          maxRounds = Math.max(maxRounds, row.w + row.l + row.d);
        }
      });
    });

    const players = [...totals.values()]
      .sort((a, b) => (b.pts - a.pts) || (b.w - a.w) || a.name.localeCompare(b.name, 'es'));
    // Players on the same points share a place.
    players.forEach(player => { player.rank = 1 + players.filter(other => other.pts > player.pts).length; });

    // Everyone whose place is within the cut is inside it, so a tie on the line puts more than `top` players inside
    // (tied: true) and the first one outside is the next player ranked below the cut, not just the next in the list.
    const outside = players.find(player => player.rank > top);
    return {
      players,
      top,
      maxRounds,
      maxNightPts,
      captured,
      nights: nights.length,
      stored,
      played,
      me: players.find(player => player.isMe) || null,
      cutPts: players.length >= top ? players[top - 1].pts : null,
      nextPts: outside ? outside.pts : null,
      tied: players.filter(player => player.rank <= top).length > top
    };
  }
};
