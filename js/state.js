// What is saved on this device: history, deleted decks, season end dates.
/* global CONFIG, defaultHistoricData, Analytics, cleanSeasonEnds */
/* exported State */

// ══════════════════════════════════════════════════════════════════
// STATE MANAGEMENT
// ══════════════════════════════════════════════════════════════════
const State = {
  historic: [],
  decksList: [],
  deletedDecks: [],
  // Closing date of each season that has one: { "2026-2": "2026-11-29" }.
  seasonEnds: {},
  // True when the browser refused a write, so a change is never reported as saved when it was not.
  writeFailed: false,
  // Raw text of stored data that could not be read: kept aside so the next save does not wipe it.
  unreadable: null,

  historicKey() {
    return CONFIG.isTestMode ? 'pauper_test_arena_historic' : 'pauper_arena_historic';
  },

  deletedKey() {
    return CONFIG.isTestMode ? 'pauper_test_arena_deleted_decks' : 'pauper_arena_deleted_decks';
  },

  seasonEndsKey() {
    return CONFIG.isTestMode ? 'pauper_test_arena_season_ends' : 'pauper_arena_season_ends';
  },

  unreadableKey() {
    return `${this.historicKey()}_unreadable`;
  },

  saveSeasonEnds() {
    try {
      localStorage.setItem(this.seasonEndsKey(), JSON.stringify(this.seasonEnds));
    } catch (e) {
      this.writeFailed = true;
      console.warn('Error guardando en localStorage:', e);
    }
  },

  // Nothing saved yet means the dates the app ships with; a saved empty list means the person removed them all.
  loadSeasonEnds() {
    let stored = null;
    try {
      stored = JSON.parse(localStorage.getItem(this.seasonEndsKey()));
    } catch (e) {}
    this.seasonEnds = cleanSeasonEnds(stored) || { ...CONFIG.DEFAULT_SEASON_ENDS };
  },

  resetToDefaults() {
    this.historic = JSON.parse(JSON.stringify(defaultHistoricData));
    this.deletedDecks = [];
    this.saveDeletedDecks();
    this.syncDecksList();
  },

  saveDeletedDecks() {
    try {
      localStorage.setItem(this.deletedKey(), JSON.stringify(this.deletedDecks));
    } catch (e) {
      this.writeFailed = true;
      console.warn('Error guardando en localStorage:', e);
    }
  },

  loadDeletedDecks() {
    try {
      const stored = localStorage.getItem(this.deletedKey());
      this.deletedDecks = stored ? JSON.parse(stored) : [];
    } catch(e) {
      this.deletedDecks = [];
    }
  },

  // The raw text goes under its own key before the app starts over from the built-in history.
  keepUnreadable(raw) {
    if (!raw) return;
    this.unreadable = raw;
    try {
      if (localStorage.getItem(this.unreadableKey()) !== raw) localStorage.setItem(this.unreadableKey(), raw);
    } catch (e) {
      console.warn('No se pudo conservar una copia de los datos ilegibles:', e);
    }
  },

  // The set-aside copy, from this session or an earlier one.
  unreadableCopy() {
    try {
      return this.unreadable || localStorage.getItem(this.unreadableKey());
    } catch (e) {
      return this.unreadable;
    }
  },

  discardUnreadable() {
    this.unreadable = null;
    try { localStorage.removeItem(this.unreadableKey()); } catch (e) {}
  },

  syncDecksList() {
    this.loadDeletedDecks();
    const foundDecks = new Set(CONFIG.DEFAULT_DECKS);
    this.historic.forEach(item => {
      if (item.deck && item.deck !== "No participó") {
        foundDecks.add(item.deck.trim());
      }
    });
    // Filter out any explicitly deleted decks
    this.deletedDecks.forEach(del => foundDecks.delete(del));
    this.decksList = Array.from(foundDecks);
  },

  deleteDeck(deckName) {
    if (!deckName) return;
    const normalized = deckName.trim();
    if (!this.deletedDecks.includes(normalized)) {
      this.deletedDecks.push(normalized);
    }
    this.saveDeletedDecks();

    // Remove all tournaments with this deck from historic
    this.historic = this.historic.filter(item => {
      return !item.deck || item.deck.trim().toLowerCase() !== normalized.toLowerCase();
    });

    this.syncDecksList();
    this.save();
  },

  save() {
    try {
      localStorage.setItem(this.historicKey(), JSON.stringify(this.historic));
      localStorage.setItem('pauper_arena_version', CONFIG.DATA_VERSION);
      localStorage.setItem('pauper_arena_last_update', new Date().toISOString());
    } catch (e) {
      this.writeFailed = true;
      console.warn('Error guardando en localStorage:', e);
    }
  },

  load() {
    let stored = null;
    try {
      this.loadDeletedDecks();
      this.loadSeasonEnds();
      stored = localStorage.getItem(this.historicKey());

      if (stored) {
        this.historic = JSON.parse(stored);
        // Enrich with isoDate if missing
        this.historic.forEach(item => {
          if (!item.isoDate) {
            const def = defaultHistoricData.find(d => d.date === item.date && d.deck === item.deck && d.season === item.season);
            if (def && def.isoDate) {
              item.isoDate = def.isoDate;
            } else {
              const d = Analytics.parseDate(item.date, item.season);
              const y = d.getFullYear();
              const m = String(d.getMonth() + 1).padStart(2, '0');
              const day = String(d.getDate()).padStart(2, '0');
              item.isoDate = `${y}-${m}-${day}`;
            }
          }
        });
      } else {
        // Also check legacy key if transitioning
        const legacyKey = localStorage.getItem('pauper_historic');
        if (legacyKey) {
          try {
            this.historic = JSON.parse(legacyKey);
          } catch(e) {
            this.resetToDefaults();
          }
        } else {
          this.resetToDefaults();
        }
      }

      // Filter out any entries belonging to deleted decks
      if (this.deletedDecks.length > 0) {
        this.historic = this.historic.filter(item => {
          return !item.deck || !this.deletedDecks.some(d => d.toLowerCase() === item.deck.trim().toLowerCase());
        });
      }

      this.syncDecksList();
    } catch (e) {
      console.error('Error cargando datos:', e);
      this.keepUnreadable(stored);
      this.resetToDefaults();
    }
    // Starting from the built-in history writes nothing the person made, so a refused write here is not news.
    this.writeFailed = false;
  }
};
