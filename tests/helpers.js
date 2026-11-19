// Loads the app's plain scripts into a sandbox for the tests: no browser and no dependencies, only Node.
// Every name and figure in the tests is invented (CLAUDE.md: nothing of any person goes in the code).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const CORE = ['config', 'state', 'analytics', 'format', 'league', 'monthly', 'outlook', 'demo', 'gemini'];
const EXPOSE = ['CONFIG', 'State', 'Analytics', 'League', 'Monthly', 'Outlook', 'Demo', 'Gemini', 'tournamentType', 'cleanRounds',
  'cleanNameLinks', 'cleanMonthsLog', 'isStoreNight', 'seasonOf', 'localIsoDate'];

// A fresh app: its own storage (`ctx.store`), and, with `arena`, the Arena parts named (e.g. ['arena-undo']).
function boot({ arena = [], extra = {} } = {}) {
  const store = new Map();
  const localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
  const ctx = vm.createContext({
    console, Intl, Date, Math, JSON, Map, Set, Number, String, Array, Object, Int32Array, isNaN, parseInt, Promise,
    setTimeout, clearTimeout, setImmediate, AbortController, localStorage, ...extra
  });
  const read = (name) => fs.readFileSync(path.join(ROOT, 'js', `${name}.js`), 'utf8');
  let code = CORE.map(read).join('\n');
  if (arena.length) code += `\nconst Arena = {};\n${arena.map(read).join('\n')}`;
  code += `\n;Object.assign(globalThis, { ${EXPOSE.join(', ')}${arena.length ? ', Arena' : ''} });`;
  vm.runInContext(code, ctx, { filename: 'app.js' });
  ctx.store = store;
  return ctx;
}

// One saved tournament of the person.
const entry = (iso, deck, pts, wl, extra = {}) => ({ date: iso, isoDate: iso, season: '2026-2', deck, rank: '3°', pts, wl, type: 'normal', notes: '', ...extra });

// Values made inside the sandbox have its own Array and Object, which deepStrictEqual tells apart: compare them as plain data.
const plain = (value) => JSON.parse(JSON.stringify(value));

module.exports = { ROOT, boot, entry, plain };
