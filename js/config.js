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
  // The standings scan and the monthly store table are both read by Gemini, called with the person's own key (see
  // js/gemini.js). `model` is the first one tried; if it is busy, out of free quota or retired, Gemini.read moves on to
  // the other free "flash" models the key lists. The key lives only on their device; it is never part of what State saves
  // or backs up.
  GEMINI: {
    model: 'gemini-3.8-flash',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models'
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
