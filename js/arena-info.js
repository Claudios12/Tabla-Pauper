// Arena: the ⓘ beside every figure, saying what it means and how it is worked out.
/* global esc, Arena */

// What each figure of the app means and how it is got, in the words the person reads. Every "how" follows the code that makes the
// figure (Analytics.computeDeckStats, League.standings, Outlook, …): change the figure, change its words here.
const STAT_INFO = Object.freeze({
  winrate: {
    title: '% de victorias',
    what: 'De cada 100 partidas, cuántas ganaste. El 50 % es ganar tantas como pierdes: por encima ganas más de las que pierdes, por debajo pierdes más. «X sobre el 50 %» o «X bajo el 50 %» es la distancia a esa línea.',
    how: 'Victorias ÷ partidas jugadas (victorias + derrotas + empates), sumando el récord de cada torneo. Un empate cuenta como partida no ganada. Un bye cuenta como victoria cuando está en el récord. Se muestra con un decimal.'
  },
  mp: {
    title: 'Efectividad (MP %)',
    what: 'Qué parte de los puntos de partida posibles conseguiste. A diferencia del % de victorias, un empate vale algo: 1 de los 3 puntos.',
    how: '(victorias × 3 + empates) ÷ (partidas × 3). Son los puntos de partida, sin los puntos especiales ni los retos de la tienda.'
  },
  ppt: {
    title: 'Pts por torneo',
    what: 'Lo que te da un torneo en promedio, en los puntos oficiales que cuentan para la liga.',
    how: 'La suma de los puntos oficiales de cada torneo ÷ el número de torneos. Si un torneo no tiene los puntos escritos, salen de su récord (3 por victoria, 1 por empate); si no tiene ni puntos ni récord, cuenta con 0. No incluye los retos de la tienda.'
  },
  count: {
    title: 'Torneos',
    what: 'Cuántos torneos jugaste.',
    how: 'Los torneos que guardaste en la temporada que ves arriba (o en todas, si eliges «Todas»). No cuentan las noches marcadas «No participó» ni las noches creadas con la tabla del mes de la tienda.'
  },
  record: {
    title: 'Partidas (W-L-D)',
    what: 'Tu récord total: victorias-derrotas-empates. Entre paréntesis, cuántas partidas son en total.',
    how: 'La suma del récord de cada torneo. Un torneo guardado sin récord no suma partidas.'
  },
  totalPts: {
    title: 'Pts reales',
    what: 'Todos los puntos oficiales que te dio ese mazo.',
    how: 'La suma de los puntos de cada torneo con ese mazo. Cuando un torneo no tiene los puntos escritos, salen de su récord (3 por victoria, 1 por empate).'
  },
  avgRank: {
    title: 'Posición promedio',
    what: 'En qué puesto terminas de media. Cuanto más bajo, mejor.',
    how: 'La suma de tus puestos ÷ los torneos que tienen puesto. Un torneo sin puesto no cuenta aquí.'
  },
  bestRank: {
    title: 'Mejor posición',
    what: 'El mejor puesto en que terminaste: el número más bajo.',
    how: 'El puesto más alto entre los torneos que tienen puesto.'
  },
  top48: {
    title: 'Top 4 / Top 8',
    what: 'En cuántos torneos quedaste entre los 4 primeros, y entre los 8 primeros.',
    how: 'Se cuentan los torneos con puesto 4° o mejor, y con puesto 8° o mejor. Un top 4 también cuenta como top 8.'
  },
  status: {
    title: 'Estado del mazo',
    what: 'Cómo le va al mazo, de un vistazo, según su % de victorias.',
    how: '«Muestra insuficiente»: menos de 3 torneos, todavía dice poco. «Buen rendimiento»: 50 % o más. «Promedio / viable»: de 45 % a 49,9 %. «Bajo rendimiento»: menos de 45 %. «Líder» es el mazo con mejor % de victorias entre los que tienen al menos 2 torneos (si empatan, el de más partidas); a su lado dice «bajo 50 %» o «muestra pequeña» cuando toca.'
  },
  form: {
    title: 'Última racha',
    what: 'Tus últimos 5 torneos con ese mazo, del más antiguo (izquierda) al más reciente (derecha), con su récord.',
    how: 'Verde: 6 pts o más. Rojo: 3 pts o menos. Gris: 4 o 5 pts. Son los mismos colores con que se marca cada torneo en el Historial.'
  },
  nightColour: {
    title: 'Color de cada torneo',
    what: 'Cada torneo se marca según los puntos que te dio.',
    how: 'Bueno (verde): 6 pts o más. Normal: 4 o 5 pts. Malo (rojo): 3 pts o menos. Las noches que no jugaste y las creadas con la tabla de la tienda no llevan color.'
  },
  diagnostic: {
    title: 'Diagnóstico competitivo',
    what: 'Los mazos que destacan en la temporada que ves.',
    how: '«Mazo más efectivo»: el de mejor % de victorias, el mismo «Líder» de las tarjetas. «Mejor pico de torneo»: el mazo que logró el mejor puesto, entre los que tienen al menos 3 torneos (si es el mismo mazo más efectivo, se dice junto). «Mazo con mayor dificultad»: el de peor % de victorias, y solo si está por debajo del 50 %.'
  },
  chart: {
    title: 'Puntos por torneo (gráfica)',
    what: 'Cómo te fue torneo a torneo: una columna por torneo, en orden de fecha, con los puntos que te dio.',
    how: 'Cada columna lleva los colores del mazo que jugaste. Una noche marcada «No participó» queda como hueco. Las noches creadas con la tabla del mes de la tienda no salen, porque no son torneos tuyos.'
  },
  matchups: {
    title: 'Contra qué mazos',
    what: 'Tu récord contra cada mazo rival, con este mazo.',
    how: 'Sale de las rondas que anotas en Registrar, en «Llevar la cuenta ronda a ronda». % victorias = victorias ÷ rondas contra ese mazo. Los byes no cuentan, porque no tienen rival. «Sin anotar» son las rondas en que no escribiste el rival. Con pocas rondas contra un mazo, el porcentaje dice poco.'
  },
  nightsLeft: {
    title: 'Fechas restantes',
    what: 'Cuántas noches de liga quedan antes del cierre de la temporada.',
    how: 'Se cuentan los días de la semana en que juega tu liga, desde hoy hasta la fecha de cierre incluida. La noche de hoy cuenta hasta que guardas su tabla. La fecha de cierre la pones tú: toca la tarjeta para cambiarla. Es la misma cuenta que usa el riesgo de quedar fuera.'
  },
  myRank: {
    title: 'Tu puesto',
    what: 'Tu lugar en la tabla de la liga de la temporada.',
    how: 'Se ordena a todos los jugadores por sus puntos totales (puntos de cada noche más los retos). Los que tienen los mismos puntos comparten puesto: tu puesto es 1 más los jugadores que tienen más puntos que tú.'
  },
  myPts: {
    title: 'Tus puntos',
    what: 'Tus puntos en la liga: los que cuentan para clasificar.',
    how: 'Los puntos oficiales de tus torneos, más los de las noches creadas con la tabla del mes de la tienda en que saliste, más los retos. «Por torneo» es el promedio sin los retos. Es la misma cifra que la tuya en la tabla de la liga.'
  },
  cut: {
    title: 'Distancia al top',
    what: 'Cuánto te separa de la línea de los que clasifican.',
    how: 'Si estás dentro: tus puntos menos los del primero que queda fuera (tu ventaja). Si estás fuera: los puntos del último que entra menos los tuyos (lo que te falta). Si empatas en la línea, decide el desempate de la tienda.'
  },
  board: {
    title: 'Tabla de la liga',
    what: 'Todos los jugadores de las tablas que guardaste en la temporada, ordenados por puntos.',
    how: 'Se suman, noche a noche, los puntos de cada jugador en las capturas que guardaste más los retos de la tabla del mes, y las noches creadas con esa tabla. La línea marca a los que clasifican; los empatados en la línea quedan dentro. «Clasificado» (verde): nadie puede dejarlo fuera, aunque los demás ganen todo lo que queda. «Eliminado» (rojo): no entra ni ganando todo lo que queda. Toca un jugador para ver sus puntos noche a noche.'
  },
  risk: {
    title: 'Riesgo de quedar fuera del top',
    what: 'Qué tan probable es que termines la temporada fuera de los que clasifican. Es una estimación.',
    how: 'Se juegan muchas veces, al azar, las noches que quedan: cada jugador viene con la frecuencia con que suele venir y saca puntos parecidos a los que suele sacar. Se cuenta en cuántas de esas temporadas terminas con más jugadores por encima que puestos hay. Si ya estás decidido (clasificado o eliminado), es exacto. Necesita la fecha de cierre, el día de la liga y la tabla de cada noche que se jugó.'
  },
  need: {
    title: 'Lo que necesitas por fecha',
    what: 'Cuántos puntos por noche te harían falta para entrar al top, si juegas todas las noches que quedan.',
    how: 'Con las mismas temporadas simuladas del riesgo se estima dónde terminará la línea del top: lo más probable (la mitad de las simulaciones termina por encima y la mitad por debajo) y una marca «con margen» que se supera en 8 de cada 10. A eso se le restan tus puntos y se divide entre las noches que quedan. Se compara con lo que sacas por noche ahora. Es una estimación.'
  },
  rivals: {
    title: 'Tus rivales',
    what: 'Los jugadores más cerca de ti en la tabla.',
    how: 'Los dos de arriba y los dos de abajo, y además el último dentro y el primero fuera del top cuando están más lejos. La diferencia es de puntos totales. «Le sacaste» o «te sacó» es cuánto cambió esa diferencia en la última noche. Toca un rival para ver sus puntos.'
  },
  progress: {
    title: 'Tu camino al top',
    what: 'Cómo fueron tus puntos durante la temporada frente a la línea del top.',
    how: 'Después de cada noche: tus puntos acumulados y los del último que entraba en el top ese día, en la misma escala de puntos. El número sobre tus puntos es tu puesto esa noche. «Diferencia» son tus puntos menos los de esa línea. La última noche es la tabla que ves hoy.'
  },
  playerPoints: {
    title: 'Puntos por mes',
    what: 'Cómo sumó este jugador sus puntos de la temporada.',
    how: 'Mes por mes, y en cada mes sus noches: los puntos de la tabla de esa noche, el reto que le dio la tienda y el total. Los meses suman exactamente la cifra que muestra la tabla de la liga.'
  }
});

Object.assign(Arena, {
  STAT_INFO,

  // The small mark that opens a figure's meaning. name: the figure as the screen calls it, for a screen reader. text: words shown
  // beside the mark (a card's "Qué es y cómo se calcula"), which then start its name, so what is read is what is seen.
  infoButton(key, name = '', text = '') {
    const info = STAT_INFO[key];
    if (!info) return '';
    const label = text ? `${text}: ${name || info.title}` : `Qué es «${name || info.title}» y cómo se calcula`;
    return `<button class="info-btn${text ? ' info-btn-text' : ''}" type="button" onclick="Arena.showInfo('${key}', this)" aria-haspopup="dialog" aria-label="${esc(label)}">`
      + `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>${text ? `<span>${esc(text)}</span>` : ''}</button>`;
  },

  // The meaning and the how of a figure, as the top of #explain-dialog (explainFigure adds the sum and the tournaments under it).
  infoHtml(key) {
    const info = STAT_INFO[key];
    if (!info) return '';
    return `<p><strong>Qué significa.</strong> ${esc(info.what)}</p><p><strong>Cómo se obtiene.</strong> ${esc(info.how)}</p>`;
  },

  showInfo(key, opener) {
    const dialog = document.getElementById("explain-dialog");
    const info = STAT_INFO[key];
    if (!dialog || !info || typeof dialog.showModal !== 'function') return;
    this._explainOpener = opener || document.activeElement;
    document.getElementById("ex-title").textContent = info.title;
    document.getElementById("ex-def").innerHTML = this.infoHtml(key);
    document.getElementById("ex-sum").textContent = '';
    document.getElementById("ex-notes").innerHTML = '';
    document.getElementById("ex-table").innerHTML = '';
    dialog.showModal();
  }
});
