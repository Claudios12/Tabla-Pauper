// Deck names and the app settings (CONFIG).
/* global seasonOf */
/* exported DECK, CONFIG */

// Deck strings are stored data (emoji = colour identity, also the matching key).
// The UI shows the name plus mana pips; see deckInfo().
const DECK = {
  boros: "🐂⚪🔴 Torito Boros", // taste-skill-ignore
  izzet: "🐧🔵🔴 Pingüinos Izzet", // taste-skill-ignore
  rakdos: "🧙⚫🔴 Magitos Rakdos", // taste-skill-ignore
  grixis: "🔵⚫🔴 Grixis" // taste-skill-ignore
};

// ══════════════════════════════════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════════════════════════════════
const CONFIG = {
  isTestMode: false,
  DATA_VERSION: 'pauper-deck-arena-v1',
  // Today's season, by the same rule that files each tournament under its date.
  get CURRENT_SEASON() {
    const today = new Date();
    return seasonOf(today.getFullYear(), today.getMonth() + 1);
  },
  // Closing dates the app starts with. They are edited from the Fechas restantes card and saved per season.
  DEFAULT_SEASON_ENDS: { '2026-2': '2026-11-29' },
  // The OCR engine is fetched on first use: one pinned version, checked against this hash.
  OCR_ENGINE: {
    src: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
    integrity: 'sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F'
  },
  DEFAULT_DECKS: [DECK.boros, DECK.izzet, DECK.rakdos, DECK.grixis],
  // Standard MTG Benchmarks
  BENCHMARKS: {
    GOOD_WIN_RATE: 50.0,       // >= 50% Win Rate is positive
    AVG_WIN_RATE: 45.0,        // 45% - 49.9% is average / viable
    MIN_SAMPLE_SIZE: 3,        // < 3 tournaments is marked as insufficient sample
    FORM_WIN_PTS: 6,           // >= this pts = form pill "w" (win)
    FORM_LOSS_PTS: 3,          // <= this pts = form pill "l" (loss)
    TYPE_GOOD_PTS: 6,          // saved tournament type: "good" when pts >= this
    TYPE_BAD_PTS: 3            // saved tournament type: "bad" when pts <= this
  },
  MONTHS_MAP: {
    'ene': 0, 'feb': 1, 'mar': 2, 'abr': 3, 'may': 4, 'jun': 5,
    'jul': 6, 'ago': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dic': 11
  },
  MONTHS_ABBR: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
};
