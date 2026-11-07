// Gemini: the person's own API key (device-local, never part of State) and the one call that sends pictures to it and
// expects structured JSON back. Everything downstream (League.extend, Monthly.fromRows) cross-checks what comes back the
// same way it checked the local OCR engine: nothing here is trusted blindly.
/* global CONFIG */
/* exported Gemini */

const Gemini = {
  // The key is a secret the person pastes in, not league data: it is never read into State, never backed up, never
  // cleared by wipeAll, and the same in test mode as outside it.
  STORAGE_KEY: 'gemini_api_key',

  key() {
    return (localStorage.getItem(this.STORAGE_KEY) || '').trim();
  },

  setKey(value) {
    const key = String(value ?? '').trim();
    if (key) localStorage.setItem(this.STORAGE_KEY, key);
    else localStorage.removeItem(this.STORAGE_KEY);
    return key;
  },

  clearKey() {
    localStorage.removeItem(this.STORAGE_KEY);
  },

  // A file as the base64 the API wants: no "data:image/...;base64," prefix.
  toBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',', 2)[1] || '');
      reader.onerror = () => reject(new Error(`No se pudo leer el archivo «${file.name}».`));
      reader.readAsDataURL(file);
    });
  },

  // Which model reads. Google retires models and some days one is overloaded or out of free quota, and the person has
  // nobody to change the code, so the page moves on by itself. It only ever tries the free-tier families, "flash" and
  // "flash-lite" (never "pro", which is not free), and it learns which ones exist from the person's own key
  // (ListModels), so a model Google adds later is found without a release. The order is: the one that last worked, the
  // one in CONFIG, then the rest (flash newest first, then flash-lite, then the "-latest" aliases).
  _working: null,
  _found: null,
  _dead: new Set(),

  // 502/503/504: the server is busy for a moment. 429: the free quota of that model is used up (per minute or per day).
  // Both are worth trying on another model, and again after a pause. 404 (or the API saying the model is gone) is a model
  // that no longer answers: it is dropped for this visit.
  RETRY_STATUSES: [502, 503, 504],
  PASS_DELAYS_MS: [4000, 8000],

  candidates() {
    return [this._working, CONFIG.GEMINI.model, ...(this._found || [])]
      .filter((model, i, all) => model && !this._dead.has(model) && all.indexOf(model) === i);
  },

  // The free-tier models a key can call, best first: full flash (newest version first), then flash-lite, with the
  // "-latest" aliases after the numbered ones of their kind.
  rankFree(models) {
    const found = [];
    for (const entry of Array.isArray(models) ? models : []) {
      if (!(entry && Array.isArray(entry.supportedGenerationMethods) && entry.supportedGenerationMethods.includes('generateContent'))) continue;
      const name = String(entry.name || '').replace(/^models\//, '');
      const numbered = /^gemini-(\d+(?:\.\d+)?)-flash(-lite)?$/.exec(name);
      if (numbered) {
        found.push({ name, version: numbered[1].split('.').map(Number), lite: Boolean(numbered[2]) });
      } else if (name === 'gemini-flash-latest' || name === 'gemini-flash-lite-latest') {
        found.push({ name, version: [0], lite: name.includes('lite') });
      }
    }
    const newer = (a, b) => {
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const diff = (b[i] || 0) - (a[i] || 0);
        if (diff) return diff;
      }
      return 0;
    };
    return found.sort((a, b) => (a.lite - b.lite) || newer(a.version, b.version)).map(model => model.name);
  },

  // Asks the key which models exist. It is only a help: if it fails, reading goes on with the models already known and
  // the question is asked again next time.
  async discover(key) {
    try {
      const response = await fetch(`${CONFIG.GEMINI.endpoint}?pageSize=1000&key=${encodeURIComponent(key)}`);
      if (!response.ok) return;
      const data = await response.json();
      this._found = this.rankFree(data && data.models);
    } catch (err) {
      // No connection or no list: nothing to add.
    }
  },

  // Sends one or more pictures with a prompt, and expects back a JSON value (never markdown, never prose): the request
  // asks for application/json, and a response that is not valid JSON is an error, not a guess at what it meant.
  // `onNote(text)` lets the caller say in its status line that another model is being tried or that it is waiting.
  async read(files, prompt, onNote) {
    const key = this.key();
    if (!key) throw new Error('Falta tu clave de Gemini: agrégala en «Clave de Gemini» antes de leer una captura.');
    const parts = [{ text: prompt }];
    for (const file of files) {
      parts.push({ inline_data: { mime_type: file.type || 'image/jpeg', data: await this.toBase64(file) } });
    }
    const request = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseMimeType: 'application/json' }
      })
    };
    const say = text => { if (typeof onNote === 'function') onNote(text); };
    let statuses = [];
    let lastDetail = '';
    for (let pass = 0; ; pass++) {
      const tried = new Set();
      statuses = [];
      for (;;) {
        let model = this.candidates().find(name => !tried.has(name));
        if (!model && !this._found) {
          await this.discover(key);
          model = this.candidates().find(name => !tried.has(name));
        }
        if (!model) break;
        if (tried.size) say(`Probando con otro modelo de Gemini (${model})…`);
        tried.add(model);
        let response;
        try {
          response = await fetch(`${CONFIG.GEMINI.endpoint}/${model}:generateContent?key=${encodeURIComponent(key)}`, request);
        } catch (err) {
          throw new Error('No se pudo contactar a Gemini: revisa tu conexión e inténtalo de nuevo.');
        }
        if (response.ok) {
          this._working = model;
          return this.parse(response);
        }
        const body = await response.json().catch(() => null);
        const detail = (body && body.error && body.error.message) || '';
        if (response.status === 400 && /API key/i.test(detail)) {
          throw new Error('Tu clave de Gemini no es válida: revísala en «Clave de Gemini».');
        }
        const gone = response.status === 404 || /no longer available|not found|is not supported/i.test(detail);
        const busy = response.status === 429 || this.RETRY_STATUSES.includes(response.status);
        if (!gone && !busy) {
          throw new Error(`Gemini respondió con un error${detail ? `: ${detail}` : ` (${response.status})`}.`);
        }
        if (gone) this._dead.add(model);
        statuses.push(response.status);
        lastDetail = detail;
      }
      const waitable = statuses.some(status => status === 429 || this.RETRY_STATUSES.includes(status));
      if (!waitable || pass >= this.PASS_DELAYS_MS.length) break;
      say('Gemini está ocupado: reintentando en unos segundos…');
      await new Promise(resolve => setTimeout(resolve, this.PASS_DELAYS_MS[pass]));
    }
    if (statuses.some(status => this.RETRY_STATUSES.includes(status))) {
      throw new Error('Gemini sigue con mucha demanda en todos los modelos gratuitos. Espera unos minutos y vuelve a subir la captura.');
    }
    if (statuses.includes(429)) {
      throw new Error('Se acabó la cuota gratuita de Gemini por ahora (por minuto o por día). Espera un rato o inténtalo mañana.');
    }
    throw new Error(`Ningún modelo gratuito de Gemini respondió con tu clave${lastDetail ? `: ${lastDetail}` : ''}.`);
  },

  async parse(response) {
    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error('Gemini no devolvió una tabla legible: prueba con una captura más nítida.');
    }
  }
};
