// The repository checker (tools/check-repo.js) passes on a copy of the app and catches each mess it is there for.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT } = require('./helpers');

// A copy of the app's files in a fresh folder (not a git repository: the checker then counts every file in it).
function copy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pauper-check-'));
  ['index.html', 'sw.js', 'manifest.json', 'vercel.json', 'CLAUDE.md'].forEach(file => fs.copyFileSync(path.join(ROOT, file), path.join(dir, file)));
  ['js', 'css'].forEach(folder => fs.cpSync(path.join(ROOT, folder), path.join(dir, folder), { recursive: true }));
  return dir;
}
function check(dir, env = {}) {
  const run = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'check-repo.js')], { env: { ...process.env, CHECK_ROOT: dir, ...env }, encoding: 'utf8' });
  return { ok: run.status === 0, out: run.stdout + run.stderr };
}
const edit = (dir, file, change) => fs.writeFileSync(path.join(dir, file), change(fs.readFileSync(path.join(dir, file), 'utf8')));

test('a clean copy passes', () => {
  const result = check(copy());
  assert.ok(result.ok, result.out);
});

test('a script nobody loads is caught', () => {
  const dir = copy();
  fs.writeFileSync(path.join(dir, 'js', 'olvidado.js'), '// Nobody loads me.\n');
  const result = check(dir);
  assert.ok(!result.ok && /olvidado\.js existe pero index\.html no lo carga/.test(result.out), result.out);
  assert.match(result.out, /olvidado\.js no está en SHELL/);
});

test('a stale /* global */ name, and one used without being listed, are caught', () => {
  const dir = copy();
  edit(dir, 'js/outlook.js', text => text.replace('/* global CONFIG */', '/* global CONFIG, League */'));
  edit(dir, 'js/demo.js', text => text.replace('/* global CONFIG, localIsoDate, seasonOf, seasonEndBounds, tournamentType */', '/* global CONFIG, localIsoDate, seasonOf, seasonEndBounds */'));
  const result = check(dir);
  assert.match(result.out, /outlook\.js lista League en \/\* global \*\/ pero no lo usa/);
  assert.match(result.out, /demo\.js usa tournamentType \(de format\.js\) sin listarlo/);
});

test('an API key in a file is caught', () => {
  const dir = copy();
  edit(dir, 'js/config.js', text => `${text}\n// AIza${'x'.repeat(35)}\n`);
  assert.match(check(dir).out, /config\.js contiene lo que parece una clave de API/);
});

test('a loose file at the top of the repository is caught', () => {
  const dir = copy();
  fs.writeFileSync(path.join(dir, 'notas.txt'), 'algo');
  assert.match(check(dir).out, /"notas\.txt" no debería estar en la raíz/);
});

test('a SHELL change without a new CACHE_NAME is caught', () => {
  const dir = copy();
  const before = path.join(dir, 'sw-main.js');
  fs.copyFileSync(path.join(dir, 'sw.js'), before);
  // Patterns, not exact text: the copy may have Windows line endings.
  edit(dir, 'sw.js', text => text.replace(/'\/js\/main\.js'/, "'/js/main.js',\n  '/js/extra.js'"));
  fs.writeFileSync(path.join(dir, 'js', 'extra.js'), '// An extra script.\n');
  edit(dir, 'index.html', text => text.replace(/<script src="js\/main\.js" defer><\/script>/, '<script src="js/main.js" defer></script>\n  <script src="js/extra.js" defer></script>'));
  fs.renameSync(before, path.join(os.tmpdir(), `sw-main-${path.basename(dir)}.js`));
  const result = check(dir, { CHECK_MAIN_SW: path.join(os.tmpdir(), `sw-main-${path.basename(dir)}.js`) });
  assert.match(result.out, /SHELL de sw\.js cambió respecto a main pero CACHE_NAME sigue/);
});
