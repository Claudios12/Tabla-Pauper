// The app settings (CONFIG). Nothing here belongs to one person: names, decks, dates and the league night are the
// person's own and live in what is saved on their device (see State).
/* global seasonOf */
/* exported CONFIG */

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
  // Pictures are enlarged before they are read when they are small (a screenshot shared through a chat is): a short side under
  // OCR_SMALL_SIDE is brought to about OCR_TARGET_SIDE, never more than 3 times. A picture longer than OCR_MAX_SIDE is
  // scaled down to fit it, whatever its size.
  OCR_SMALL_SIDE: 1000,
  OCR_TARGET_SIDE: 1500,
  OCR_MAX_SIDE: 3200,
  // The OCR engine is fetched on first use: one pinned version, checked against this hash.
  OCR_ENGINE: {
    src: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
    integrity: 'sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F'
  },
  // The General tab: how many places qualify, and how the rest of a season is judged.
  LEAGUE: {
    // How many qualify in a season that has not said yet (each season says its own, in the season dialog; the page asks
    // while it has not); the most that can.
    TOP_CUTOFF: 10,
    MAX_TOP: 99,
    // The most points one night can give when no record shows more rounds (5 rounds of 3). What is left of the season is
    // judged against it, so a bigger real figure seen in the results replaces it.
    MAX_NIGHT_PTS: 15,
    // How many times the rest of the season is played out to estimate the chance of missing the top.
    RISK_RUNS: 3000
  },
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
