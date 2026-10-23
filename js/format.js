// Display helpers: number and date formats, deck names as mana pips, row and card pieces.
/* global CONFIG, Analytics */
/* exported nf0, nf1, pct, plural, esc, MANA_NAME, deckInfo, pipsHtml, stripeHtml, deckNameHtml,
         shortDate, TRASH_ICON, logRowHtml, pickLead, deckExtremes, statusPillClass, deckPillHtml,
         deltaHtml, localIsoDate, seasonOf, SEASON_FORMAT, nextSeason, seasonEndBounds, isIsoDate,
         cleanSeasonEnds, longDate */

// ══════════════════════════════════════════════════════════════════
// DISPLAY HELPERS (formatting, deck names as mana pips)
// Stored deck strings keep their emoji (they are user data and the
// matching key); the UI shows the name and its colours as pips.
// ══════════════════════════════════════════════════════════════════
const NBSP = String.fromCharCode(160);
const nf0 = new Intl.NumberFormat('es');
const nf1 = new Intl.NumberFormat('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = (x) => `${nf1.format(x)}${NBSP}%`;
const plural = (n, one, many) => `${nf0.format(n)} ${n === 1 ? one : many}`;
const esc = (s) => Analytics.escHtml(s);

const EMOJI_RE = /[\p{Extended_Pictographic}️‍]/gu;
// Colour-identity circles used in deck names: white, blue, black, red, green.
const PIP_MAP = Object.fromEntries([[0x26AA, 'w'], [0x1F535, 'u'], [0x26AB, 'b'], [0x1F534, 'r'], [0x1F7E2, 'g']]
  .map(([cp, k]) => [String.fromCodePoint(cp), k]));
const PIP_NAMES = { w: 'Blanco', u: 'Azul', b: 'Negro', r: 'Rojo', g: 'Verde' };
// Class names for the colour keys (the keys themselves stay one letter in the data).
const MANA_NAME = { w: 'white', u: 'blue', b: 'black', r: 'red', g: 'green', n: 'none' };

function deckInfo(raw) {
  const pips = [];
  for (const ch of String(raw ?? '')) {
    const key = PIP_MAP[ch];
    if (key && !pips.includes(key)) pips.push(key);
  }
  const name = String(raw ?? '').replace(EMOJI_RE, '').replace(/\s{2,}/g, ' ').trim();
  return { name: name || String(raw ?? ''), pips };
}

// The five symbols live in Imgs/mana/ (W, U, B, R, G). Each one sits on a colour dot that only shows if the image fails.
const MANA_DIR = './Imgs/mana/';
function pipsHtml(pips) {
  if (!pips.length) return '';
  const label = pips.map((k) => PIP_NAMES[k]).join(', ');
  return `<span class="pips" role="img" aria-label="${label}">${pips.map((k) => `<span class="pip mana-${MANA_NAME[k]}"><img class="pip-image" src="${MANA_DIR}${k.toUpperCase()}.png" width="32" height="32" decoding="async" alt=""></span>`).join('')}</span>`;
}

// A flat band in the deck's own Magic colours (white, blue, black, red, green).
function stripeHtml(raw) {
  const pips = deckInfo(raw).pips;
  const segs = pips.length ? pips : ['n'];
  return `<span class="stripe" aria-hidden="true">${segs.map((k) => `<i class="stripe-segment mana-${MANA_NAME[k]}"></i>`).join('')}</span>`;
}

function deckNameHtml(raw) {
  const info = deckInfo(raw);
  return `${pipsHtml(info.pips)}<span class="title-text">${esc(info.name)}</span>`;
}

// "6 Jun Paupergedón" -> "6 Jun"
const shortDate = (date) => (String(date).match(/^\d{1,2}\s+\S+/) || [String(date)])[0];

const TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10 11v5M14 11v5"/></svg>';

function rankClass(rankStr) {
  const n = Analytics.parseRankNumber(rankStr);
  if (n && n <= 4) return 'top4';
  if (n && n <= 8) return 'top8';
  return '';
}

// One tournament as a row. mode "deck": the deck leads (history, preview).
// mode "date": the date leads (the timeline inside a deck's dossier).
function logRowHtml(item, opts = {}) {
  const skipped = item.type === 'none' || item.deck === 'No participó';
  const mode = opts.mode || 'deck';
  const date = esc(item.date);
  const notes = item.notes ? esc(item.notes) : '';
  let title, sub;
  if (mode === 'date') {
    title = `<span class="title-text">${date}</span>`;
    sub = notes || (opts.showSeason ? esc(item.season || '') : '');
  } else {
    title = deckNameHtml(item.deck);
    sub = [date, opts.showSeason ? esc(item.season || '') : '', notes].filter(Boolean).join(' · ');
  }
  const pts = item.pts === '—' || item.pts === undefined || item.pts === null ? '—' : `${nf0.format(Number(item.pts))} pts`;
  const del = opts.delIdx !== undefined
    ? `<button class="btn-icon-del js-delete-tournament" type="button" onclick="Arena.deleteTournament(${opts.delIdx}, this)" aria-label="Eliminar el torneo del ${date} con ${esc(deckInfo(item.deck).name)}">${TRASH_ICON.replace('<svg ', '<svg class="row-delete-icon" ')}</button>`
    : '';
  return `
    <li class="log-row js-log-row ${opts.delIdx !== undefined ? 'has-del' : ''} ${opts.preview ? 'preview' : ''} ${opts.fresh ? 'fresh' : ''}">
      <span class="tourney-rank ${rankClass(item.rank)}">${esc(item.rank || '—')}</span>
      <div class="log-main">
        <div class="log-title">${skipped ? '<span class="title-text">No participó</span>' : title}</div>
        <div class="log-sub">${sub}</div>
      </div>
      <div class="log-fig"><b class="log-fig-value ${item.type === 'good' ? 'good' : ''}">${pts}</b><small class="log-fig-detail">${esc(item.wl || '—')}</small></div>
      ${del}
    </li>`;
}

// Colour-free-by-default pairing: the lead deck is the one thing in orange.
function pickLead(stats) {
  const qualified = stats.filter((d) => d.count >= 2);
  const pool = qualified.length > 0 ? qualified : stats;
  return [...pool].sort((a, b) => (b.winRate - a.winRate) || (b.totalMatches - a.totalMatches) || (b.ppg - a.ppg))[0] || null;
}

// The deck that leads and the one that struggles most, judged on decks with enough tournaments to mean something.
// The headline and the diagnosis both read this, so they never name different decks.
function deckExtremes(stats) {
  const lead = pickLead(stats);
  const weak = !lead ? null : stats
    .filter((d) => d.deck !== lead.deck && d.count >= CONFIG.BENCHMARKS.MIN_SAMPLE_SIZE && d.winRate < lead.winRate)
    .sort((a, b) => a.winRate - b.winRate)[0] || null;
  return { lead, weak };
}

// ══════════════════════════════════════════════════════════════════
// MORE DISPLAY HELPERS (status, deltas, dates)
// Rule for colour: green = above the 50% line or a good result; neutral
// ink = at or below it; red = only a loss, a drop or a destructive action.
// ══════════════════════════════════════════════════════════════════
const statusPillClass = (stat) => (stat.status.class === 'good' ? 'good' : 'insufficient');

// One badge on the leader that carries the whole message; every other deck gets its status.
function deckPillHtml(stat, isLead) {
  if (isLead) {
    const note = stat.status.class === 'good' ? '' : (stat.status.class === 'insufficient' ? ' · muestra pequeña' : ` · bajo 50${NBSP}%`);
    return `<span class="pill lead">Líder${note}</span>`;
  }
  return `<span class="pill ${statusPillClass(stat)}">${esc(stat.status.label)}</span>`;
}

// Distance from the 50% line, in words: the only place red appears next to a win rate.
function deltaHtml(stat) {
  if (!stat.totalMatches) return '';
  const diff = stat.winRate - 50;
  const r = Analytics.roundPct(Math.abs(diff));
  if (r === 0) return '<span class="delta">justo en el 50 %</span>'.replace('50 %', `50${NBSP}%`);
  return `<span class="delta ${diff < 0 ? 'neg' : 'pos'}">${nf1.format(r)} ${diff < 0 ? 'bajo' : 'sobre'} el 50${NBSP}%</span>`;
}

// Local calendar date as YYYY-MM-DD (toISOString() would use UTC and shift the day at night).
function localIsoDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// A year has two seasons: January to June is 1, July to December is 2. Month is 1 to 12.
function seasonOf(year, month) {
  return `${year}-${month <= 6 ? 1 : 2}`;
}
const SEASON_FORMAT = /^\d{4}-[12]$/;

function nextSeason(season) {
  const [year, half] = season.split('-').map(Number);
  return half === 1 ? `${year}-2` : `${year + 1}-1`;
}

// Where a closing date may fall: from the season's first day to a year after it begins.
function seasonEndBounds(season) {
  const [year, half] = season.split('-').map(Number);
  return half === 1 ? [`${year}-01-01`, `${year}-12-31`] : [`${year}-07-01`, `${year + 1}-06-30`];
}

// A real calendar date written YYYY-MM-DD ("2026-02-31" is not one).
function isIsoDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = text.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

// Keeps only { "2026-2": "2026-11-29" } entries; anything else a file or an old save carries is dropped.
// Returns null when there is no such object at all, so callers can tell "none" from "empty".
function cleanSeasonEnds(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const clean = {};
  Object.entries(raw).forEach(([season, date]) => {
    if (SEASON_FORMAT.test(season) && isIsoDate(date)) clean[season] = date;
  });
  return clean;
}

const longDate = (iso) => new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', year: 'numeric' }).format(Analytics.parseDate(iso));
