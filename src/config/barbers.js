/**
 * HORARIOS DE LOS BARBEROS — fuente única
 *
 * Antes estas listas estaban COPIADAS en dos funciones de
 * googleSheetsService.js (`getAvailableSlots` y `getDailyScheduleByBarber`).
 * Cambiar una y olvidar la otra hacía que el cliente y el barbero vieran
 * horarios distintos. Ya pasó. Por eso ahora viven aquí y nada más.
 *
 * ⚠️ Estos son los horarios POR DEFECTO, el respaldo del sistema.
 * La pestaña `horarios` de Google Sheets los sobrescribe cuando existe
 * (ver googleSheetsService.js). Si esa pestaña falla, se borra o nunca se
 * crea, el bot sigue funcionando con lo que hay aquí.
 *
 * ⚠️ El texto de cada turno se guarda TAL CUAL en la columna C de la hoja y
 * se compara con `===`. Cambiar "5:00pm" por "5pm" rompe la comparación con
 * los turnos históricos. No los "arregles" sin pensarlo.
 */

// Domingo = 0, Lunes = 1 ... Sábado = 6 (igual que Date.getDay())
export const NOMBRES_DIAS = [
  'Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'
];

// ── Bolon ─ cada 35 min ───────────────────────────────────────────────
// Los dos ultimos, 6:00pm y 6:30pm, son un refuerzo TEMPORAL que pidio Bolon
// en agosto de 2026. Para volver a la normalidad se quitan de esta lista (y
// de la pestana `horarios` de la hoja, que manda sobre esto).
const BOLON_TARDE = [
  "1:30pm", "2:05pm", "2:40pm", "3:15pm", "3:50pm", "4:25pm", "5:00pm", "5:30pm",
  "6:00pm", "6:30pm"
];
const BOLON_COMPLETO = [
  "9am", "9:35am", "10:10am", "10:45am", "11:20am", "11:55am", ...BOLON_TARDE
];

// ── Julian ─ cada 40 min, salvo 2:30pm→3:20pm que son 50 (es a propósito) ──
const JULIAN_MANANA = [
  "9:40am", "10:20am", "11:00am", "11:40am", "12:20pm", "1:00pm"
];
const JULIAN_HASTA_440 = [...JULIAN_MANANA, "2:30pm", "3:20pm", "4:00pm", "4:40pm"];
const JULIAN_HASTA_520 = [...JULIAN_HASTA_440, "5:20pm"];

// ── Ladino ─ cada 30 min, SOLO DE NOCHE ───────────────────────────────
// Desde el 10 de agosto de 2026 atiende únicamente de 6pm a 9pm. Antes hacía
// jornada completa de 10:30am a 6:20pm, cada 40 min.
// El último turno empieza 8:30pm y termina a las 9pm.
const LADINO = [
  "6:00pm", "6:30pm", "7:00pm", "7:30pm", "8:00pm", "8:30pm"
];

/**
 * Un arreglo de 7 posiciones por barbero, una por día de la semana.
 * Lista vacía = ese día no trabaja.
 */
export const HORARIOS_POR_DEFECTO = {
  //          Domingo         Lunes            Martes           Miércoles     Jueves           Viernes          Sábado
  bolon:   [ [],              BOLON_COMPLETO,  BOLON_COMPLETO,  BOLON_TARDE,  BOLON_COMPLETO,  BOLON_COMPLETO,  BOLON_COMPLETO  ],
  julian:  [ [],              JULIAN_HASTA_520, JULIAN_HASTA_440, JULIAN_MANANA, JULIAN_HASTA_520, JULIAN_HASTA_520, JULIAN_HASTA_520 ],
  ladino:  [ [],              LADINO,          LADINO,          LADINO,       LADINO,          LADINO,          LADINO          ],

  // 🧪 Barbero temporal de pruebas. Mismo horario de Bolon, que es el caso
  // más exigente. Se apaga desde messageHandler.js (testBarberEnabled).
  prueba:  [ [],              BOLON_COMPLETO,  BOLON_COMPLETO,  BOLON_COMPLETO, BOLON_COMPLETO, BOLON_COMPLETO, BOLON_COMPLETO  ],
};

/** Formato exacto que acepta la columna C: 9am, 10:45am, 1:30pm */
export const FORMATO_TURNO = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/;

/** Donde corta cada jornada, en minutos desde medianoche. */
export const CORTE_TARDE = 12 * 60;         // 12:00pm
export const CORTE_TARDE_NOCHE = 17 * 60;   // 5:00pm

/**
 * Reparte los turnos de un dia en jornadas: manana, tarde y tarde-noche.
 *
 * ⚠️ La tercera jornada NO existe porque si: existe solo porque una lista de
 * WhatsApp no admite mas de `maximoPorLista` turnos. Si la tarde entera cabe
 * en una lista, no se parte y el cliente ve las dos jornadas de siempre.
 *
 * Hoy solo le hace falta a Bolon, que atiende hasta las 6:30pm. Julian y
 * Ladino caben de sobra y por eso no ven ningun cambio.
 *
 * Vive aqui, y no en messageHandler, porque el panel necesita la misma regla
 * para saber si un horario cabe antes de guardarlo. Cuando esto estuvo en dos
 * sitios, uno se quedo viejo y el cliente y el barbero vieron cosas distintas.
 */
export function partirEnJornadas(turnos, maximoPorLista = 8) {
  const manana = [];
  const tarde = [];
  const tardenoche = [];

  (turnos || []).forEach(turno => {
    const minutos = turnoAMinutos(turno);

    if (minutos < CORTE_TARDE) manana.push(turno);
    else if (minutos < CORTE_TARDE_NOCHE) tarde.push(turno);
    else tardenoche.push(turno);
  });

  if (tarde.length + tardenoche.length <= maximoPorLista) {
    return { manana, tarde: [...tarde, ...tardenoche], tardenoche: [] };
  }

  return { manana, tarde, tardenoche };
}

/** Minutos desde medianoche. -1 si el turno no se entiende o es imposible. */
export function turnoAMinutos(turno) {
  const match = String(turno || '').trim().toLowerCase().match(FORMATO_TURNO);
  if (!match) return -1;

  let hora = parseInt(match[1], 10);
  const minutos = match[2] ? parseInt(match[2], 10) : 0;

  // El patrón acepta \d{1,2}, así que sin esto "25pm" pasaría como válido
  // y se guardaría en la hoja como una hora que no existe.
  if (hora < 1 || hora > 12 || minutos > 59) return -1;

  if (match[3] === 'pm' && hora !== 12) hora += 12;
  if (match[3] === 'am' && hora === 12) hora = 0;

  return hora * 60 + minutos;
}

// Se apoya en turnoAMinutos a propósito: si fueran dos validaciones
// separadas podrían dejar de coincidir, que es el problema que este
// archivo existe para evitar.
export function esTurnoValido(texto) {
  return turnoAMinutos(texto) !== -1;
}

/**
 * Los turnos por defecto de un barbero en un día.
 * Devuelve [] si el barbero no existe o si no trabaja ese día.
 */
export function turnosPorDefecto(barbero, dia) {
  const semana = HORARIOS_POR_DEFECTO[String(barbero || '').toLowerCase().trim()];
  if (!semana) return [];

  return semana[dia] || [];
}
