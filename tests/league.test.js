// The league: what a night can give, who is decided, reading a scan, the month's poster, and telling players apart.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { boot, entry, plain } = require('./helpers');

const rows = (list) => list.map(([name, pts, reto]) => (reto ? { name, pts, reto } : { name, pts }));

test('the most a night can give counts the biggest reto on top', () => {
  const app = boot();
  const entries = [
    entry('2026-10-01', 'Burn', 12, '4-0-0', { playerResults: rows([['Ana Torres', 12], ['Beto Rios', 9, 2], ['Carla Mena', 3]]) }),
    entry('2026-10-08', 'Burn', 9, '3-1-0', { playerResults: rows([['Ana Torres', 9], ['Beto Rios', 12], ['Carla Mena', 6, 3]]) })
  ];
  const table = app.League.standings(entries, 2);
  assert.deepStrictEqual([table.maxNightPts, table.maxBasePts, table.maxReto], [12, 12, 3]);
  const players = [{ name: 'A', pts: 40 }, { name: 'B', pts: 39 }, { name: 'C', pts: 24 }];
  assert.deepStrictEqual(plain(app.Outlook.decided(players, 2, 1, 17)), ['', '', ''], 'nobody is safe from a night of 15 plus a reto of 2');
});

test('who is decided never contradicts playing every case out', () => {
  const app = boot();
  const random = app.Outlook.random(7);
  let wrong = 0;
  for (let k = 0; k < 150; k++) {
    const n = 4, top = 2, max = 3;
    const players = Array.from({ length: n }, (_, i) => ({ name: `P${i}`, pts: Math.floor(random() * 12) }));
    const marks = app.Outlook.decided(players, top, 1, max);
    for (let me = 0; me < n; me++) {
      let canIn = false, canOut = false;
      for (let code = 0; code < Math.pow(max + 1, n + 1); code++) {
        let x = code;
        const final = players.map(p => { const got = x % (max + 1); x = Math.floor(x / (max + 1)); return p.pts + got; });
        final.push(x % (max + 1)); // someone who has not shown up yet
        const above = final.filter((v, i) => i !== me && v > final[me]).length;
        if (above >= top) canOut = true; else canIn = true;
      }
      if ((marks[me] === 'in' && canOut) || (marks[me] === 'out' && canIn)) wrong++;
    }
  }
  assert.strictEqual(wrong, 0);
});

test('the risk and the final line are repeatable estimates', () => {
  const app = boot();
  app.League.identify(app.Demo.NAME);
  const demo = app.Demo.build(new Date(2026, 10, 14));
  const table = app.League.standings(demo.historic.filter(night => night.season === '2026-2'), 8);
  const sum = table.players.reduce((total, p) => total + p.pts, 0);
  const raw = demo.historic.filter(night => night.season === '2026-2').reduce((total, night) => total + (night.playerResults || []).reduce((s, r) => s + r.pts, 0), 0);
  assert.strictEqual(sum, raw, 'the table adds up every row');
  const options = { top: 8, nightsLeft: 5, captured: table.nights };
  const risk = app.Outlook.risk(table.players, table.me, options);
  assert.ok(risk >= 0 && risk <= 1);
  assert.strictEqual(app.Outlook.risk(table.players, table.me, options), risk);
  const cut = app.Outlook.finalCut(table.players, options);
  assert.ok(cut.likely >= table.cutPts && cut.safe >= cut.likely);
});

test('a scanned row keeps no invented place, and a one-word name is shown, not dropped', () => {
  const app = boot({ arena: ['arena-undo'] });
  const A = app.Arena;
  assert.strictEqual(A.standingsLine({ rank: null, name: 'Juan Perez', points: 9, wld: '3-1-0' }), 'Juan Perez 3-1-0 9');
  assert.strictEqual(A.standingsLine({ rank: 4, name: 'Juan Perez', points: 9, wld: '3-1' }), '4 Juan Perez 3-1-0 9');
  const text = [{ rank: null, name: 'Juan Perez', points: 9, wld: '3-1-0' }, { rank: null, name: 'Juanito', points: null, wld: '' },
    { rank: 5, name: 'Lola', points: null, wld: '' }, { rank: null, name: 'Maria Lopez', points: 6, wld: '' }].map(row => A.standingsLine(row)).join('\n');
  const scan = app.League.extend([], text, [], true);
  assert.deepStrictEqual(plain(scan.rows.map(r => [r.name, r.rank, r.pts, r.flags.join()])),
    [['Juan Perez', null, 9, ''], ['Juanito', null, null, 'nopts'], ['Lola', 5, null, 'nopts'], ['Maria Lopez', null, 6, '']]);
  assert.deepStrictEqual(plain([app.League.parseLine('July 16'), app.League.parseLine('16 Jul')]), [null, null], 'a date over a picture is no player');
  const two = app.League.extend(scan.rows, 'Juan Perez 3-1-0 9\nPedro Gomez 2-2-0 6', [], true);
  assert.deepStrictEqual([two.added, two.same, two.rows.filter(r => r.flags.includes('place')).length], [1, 1, 0], 'two pictures, one table');
});

test("the month's poster: a null row is a row to review, and a month or day of 0 is not read", () => {
  const app = boot();
  const read = app.Monthly.fromRows({ month: 0, columns: [{ day: 0 }], rows: [null, { name: 'ana torres', nights: [3], retos: [0], total: 3 }] });
  assert.deepStrictEqual(plain([read.ok, read.rows.length, read.rows[0].flags, read.rows[1].flags]), [true, 2, ['missing', 'noname'], []]);
  assert.deepStrictEqual(plain([read.month, read.nights[0].day, read.flags]), [null, null, ['dates']]);
});

// A season where the store spells players another way than the scans did.
const night = (iso, list) => ({ isoDate: iso, date: iso, season: '2026-2', deck: 'Burn', pts: 3, wl: '1-3-0', playerResults: rows(list) });
const season = () => [
  night('2026-07-02', [['Tomás Elías V…', 9], ['Ana Torres', 6], ['Pablo Mora', 3], ['Pablo Arias', 3], ['Raúl Anto…', 3]]),
  night('2026-08-06', [['Tomás Elías V…', 6], ['Ana Torres', 9], ['Pablo M…', 6], ['Pablo Arias', 3], ['Raúl Rodríguez', 3], ['Diego Ra…', 4], ['Diego Ramos Paz', 1]]),
  night('2026-08-13', [['Tomas Elias Vera', 3], ['Ana Torres', 3], ['Diego Ramos', 6]])
];
const poster = (list) => ({ rows: list.map(([name, pts, reto]) => ({ name, nights: [pts], retos: [reto], total: pts + reto })) });
const kinds = (report) => report.nights[0].checks.map(check => check.kind + (check.how ? `:${check.how}` : ''));

test("the poster finds a player through the names the person joined, and saves his reto", () => {
  const app = boot();
  app.League.setLinks({ same: [], apart: [] });
  const unlinked = app.Monthly.compare(poster([['Tomás Vera', 6, 2], ['Ana Torres', 9, 2]]), ['2026-08-06'], season());
  assert.deepStrictEqual(plain(kinds(unlinked)), ['absent', 'same:exact'], 'not joined: not found');
  app.League.setLinks({ same: [['tomas elias vera', 'tomas vera']], apart: [] });
  const entries = season();
  const table = poster([['Tomás Vera', 6, 2], ['Ana Torres', 9, 2], ['Pablo Mora', 6, 2], ['Pablo Arias', 3, 4]]);
  const report = app.Monthly.compare(table, ['2026-08-06'], entries);
  assert.deepStrictEqual(plain(kinds(report)), ['same:league', 'same:exact', 'same:cut', 'same:exact']);
  const changed = app.Monthly.apply(report, table);
  assert.strictEqual(changed.retos, 4);
  const standings = app.League.standings(entries, 10);
  const pts = (name) => standings.players.find(p => p.name === name).pts;
  assert.deepStrictEqual([pts('Tomas Elias Vera'), pts('Pablo Mora'), pts('Pablo Arias')], [20, 11, 10]);
});

test('the poster never puts two players on one row, nor guesses between two', () => {
  const app = boot();
  app.League.setLinks({ same: [], apart: [] });
  const report = app.Monthly.compare(poster([['Raúl Solano', 3, 2], ['Raúl Rodríguez', 3, 0]]), ['2026-08-06'], season());
  assert.deepStrictEqual(plain(kinds(report)), ['absent', 'same:exact']);
});

test('a separation the person made holds', () => {
  const app = boot();
  app.League.setLinks({ same: [], apart: [['pablo m', 'pablo mora']] });
  assert.strictEqual(app.League.who(season(), ['Pablo Mora'])('Pablo Mora', 'Pablo M…'), false);
});

test("a store night gives way to the person's table without adding a joined player twice", () => {
  const app = boot();
  app.League.setLinks({ same: [['tomas elias vera', 'tomas vera']], apart: [] });
  const storeRows = [{ name: 'Tomás Vera', pts: 6, reto: 2 }, { name: 'Nuevo Jugador', pts: 3 }];
  const scanned = [{ name: 'Tomás Elías V…', pts: 6 }, { name: 'Ana Torres', pts: 9 }];
  // As the app does: the season's nights, the store's night for that day among them, and the rows just scanned.
  const storeNight = { isoDate: '2026-08-20', date: '2026-08-20', season: '2026-2', deck: 'No participó', source: 'store', playerResults: storeRows };
  const same = app.League.who(season().concat([storeNight]), scanned.map(r => r.name));
  const out = app.League.absorb(scanned, storeRows, same);
  assert.deepStrictEqual(plain([out.retos, out.added, out.rows.map(r => `${r.name}:${r.pts}${r.reto ? `+${r.reto}` : ''}`)]),
    [1, 1, ['Tomás Elías V…:6+2', 'Ana Torres:9', 'Nuevo Jugador:3']]);
});

test('a cut-off name nobody owns, beside a player with its first name and points, is flagged as repeated', () => {
  const app = boot();
  app.League.setLinks({ same: [], apart: [] });
  const table = app.League.standings([night('2026-07-23', [['Raúl Anto…', 6], ['Raúl Solano', 6, 2], ['Ana Torres', 9]])], 10);
  const solano = table.players.find(p => p.name === 'Raúl Solano');
  assert.deepStrictEqual(plain(app.League.repeats(table.players, solano).map(p => p.name)), ['Raúl Anto…']);
});

test("a player's months add up to his total", () => {
  const app = boot();
  app.League.identify(app.Demo.NAME);
  const demo = app.Demo.build(new Date(2026, 10, 14));
  const table = app.League.standings(demo.historic.filter(night => night.season === '2026-2'), 8);
  table.players.forEach(p => {
    const months = app.League.breakdown(p, table.nightDates);
    assert.strictEqual(months.reduce((s, m) => s + m.total, 0), p.pts, p.name);
    assert.strictEqual(months.reduce((s, m) => s + m.nights.length, 0), p.nights, p.name);
  });
  const steps = app.League.progress(demo.historic.filter(night => night.season === '2026-2'), 8);
  assert.strictEqual(steps[steps.length - 1].pts, table.me.pts, 'the last step of the climb is the table on screen');
});
