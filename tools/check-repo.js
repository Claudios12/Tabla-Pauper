// Checks that keep the repository clean, run by CI on every push and pull request (and by hand: `node tools/check-repo.js`).
// No dependencies: plain Node. Each rule here is one CLAUDE.md asks for; a failure says which file and why.
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// CHECK_ROOT lets the tests run it on a copy of the repository that they break on purpose.
const ROOT = process.env.CHECK_ROOT || path.join(__dirname, '..');
const problems = [];
const fail = (message) => problems.push(message);
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const git = (command) => { try { return execSync(`git ${command}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (err) { return null; } };
// The files git tracks; a copy that is not a repository (the tests) counts every file in it.
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
  .flatMap(item => (item.isDirectory() ? (item.name === '.git' ? [] : walk(path.posix.join(dir, item.name))) : [path.posix.join(dir, item.name)]));
const tracked = process.env.CHECK_ROOT ? walk('.') : (git('ls-files') || '').split('\n').filter(Boolean);

// 1. Only what belongs at the top of the repository. Anything else goes in a folder (Imgs/, tools/, tests/) or out.
const TOP_LEVEL = new Set(['.github', '.gitignore', '.gitattributes', '.vercelignore', 'CLAUDE.md', 'README.md', 'index.html', 'manifest.json', 'sw.js',
  'vercel.json', 'css', 'js', 'Imgs', 'tests', 'tools']);
[...new Set(tracked.map(file => file.split('/')[0]))].filter(top => !TOP_LEVEL.has(top))
  .forEach(top => fail(`"${top}" no debería estar en la raíz del repositorio: muévelo a una carpeta o quítalo (lista en tools/check-repo.js).`));

// 2. No secrets: the local key file is never committed, and no file holds a Google API key.
if (tracked.includes('.env') || tracked.some(file => file.startsWith('.env.'))) fail('.env está en el repositorio: es la clave de pruebas, sácalo con `git rm --cached .env`.');
const KEY = /(AIza[0-9A-Za-z_-]{30,}|AQ\.[0-9A-Za-z_-]{30,})/;
tracked.filter(file => /\.(js|html|css|json|md|yml|yaml|txt)$/.test(file)).forEach(file => {
  if (KEY.test(read(file))) fail(`${file} contiene lo que parece una clave de API: quítala (la clave va solo en el teléfono, o en .env para pruebas).`);
});

// 3. Every script and stylesheet is linked by the page, listed in the service worker's SHELL, and exists.
const html = read('index.html');
const sw = read('sw.js');
const linked = [...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref)="([^"]+\.(?:js|css))"/g)].map(m => m[1].replace(/^\.?\//, ''));
const shellOf = (text) => {
  const block = /const SHELL = \[([\s\S]*?)\];/.exec(text);
  return block ? [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]) : [];
};
const shell = shellOf(sw);
const files = ['js', 'css'].flatMap(dir => fs.readdirSync(path.join(ROOT, dir)).filter(name => /\.(js|css)$/.test(name)).map(name => `${dir}/${name}`));
files.forEach(file => {
  if (!linked.includes(file)) fail(`${file} existe pero index.html no lo carga: enlázalo o bórralo.`);
  if (!shell.includes(`/${file}`)) fail(`${file} no está en SHELL de sw.js: sin él la app no arranca sin conexión.`);
});
linked.filter(file => !/^https?:/.test(file)).forEach(file => { if (!fs.existsSync(path.join(ROOT, file))) fail(`index.html carga ${file}, que no existe.`); });
shell.filter(entry => entry !== '/').forEach(entry => { if (!fs.existsSync(path.join(ROOT, entry.slice(1)))) fail(`SHELL de sw.js lista ${entry}, que no existe: la instalación del service worker fallaría.`); });

// 4. A change to SHELL needs a new CACHE_NAME, or phones keep the old set of files. Compared with production (origin/main).
const mainSw = process.env.CHECK_MAIN_SW ? fs.readFileSync(process.env.CHECK_MAIN_SW, 'utf8')
  : (process.env.CHECK_ROOT ? null : git('show origin/main:sw.js'));
if (mainSw) {
  const name = (text) => (/const CACHE_NAME = '([^']+)'/.exec(text) || [])[1];
  if (JSON.stringify(shellOf(mainSw)) !== JSON.stringify(shell) && name(mainSw) === name(sw)) {
    fail(`SHELL de sw.js cambió respecto a main pero CACHE_NAME sigue en "${name(sw)}": súbelo (p. ej. a v${Number((/v(\d+)$/.exec(name(sw)) || [])[1] || 0) + 1}).`);
  }
} else {
  console.log('(No se pudo leer origin/main: se omite la comprobación de CACHE_NAME.)');
}

// 5. Each script says what it is and keeps its /* global */ and /* exported */ lists true (CLAUDE.md).
const BROWSER = new Set(['ResizeObserver']);
const scripts = fs.readdirSync(path.join(ROOT, 'js')).filter(name => name.endsWith('.js'));
const parsed = scripts.map(name => {
  const text = read(`js/${name}`);
  const list = (kind) => {
    const block = new RegExp(`/\\*\\s*${kind}\\s+([^*]*)\\*/`).exec(text);
    return block ? block[1].split(',').map(item => item.trim()).filter(Boolean) : [];
  };
  const body = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  const defined = new Set([...body.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]));
  return { name, text, body, globals: list('global'), exported: list('exported'), defined };
});
const exportedBy = new Map();
parsed.forEach(file => file.exported.forEach(item => exportedBy.set(item, file.name)));
parsed.forEach(file => {
  if (!/^\/\/ \S/.test(file.text)) fail(`js/${file.name} debe empezar con una línea // que diga qué hace.`);
  file.exported.forEach(item => { if (!file.defined.has(item)) fail(`js/${file.name} exporta ${item}, pero no lo define.`); });
  file.globals.forEach(item => {
    if (!exportedBy.has(item) && !BROWSER.has(item)) fail(`js/${file.name} toma ${item} de otro archivo, pero ninguno lo exporta.`);
    if (!new RegExp(`(?<![\\w$.])${item.replace('$', '\\$')}(?![\\w$])`).test(file.body)) fail(`js/${file.name} lista ${item} en /* global */ pero no lo usa: quítalo de la lista.`);
  });
  // A name another file exports, used here without being listed (strings stay: the page's markup calls helpers inside them).
  exportedBy.forEach((owner, item) => {
    if (owner === file.name || file.globals.includes(item) || file.defined.has(item)) return;
    if (new RegExp(`(?<![\\w$.'"\`-])${item.replace('$', '\\$')}(?![\\w$'"\`-])`).test(file.body)) fail(`js/${file.name} usa ${item} (de ${owner}) sin listarlo en /* global */.`);
  });
});

if (problems.length) {
  console.error(`✗ ${problems.length} ${problems.length === 1 ? 'problema' : 'problemas'}:\n${problems.map(p => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`✓ Repositorio en orden: ${files.length} archivos de la app enlazados y en caché, ${scripts.length} scripts con sus listas al día, sin claves.`);
