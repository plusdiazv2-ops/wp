/**
 * FESTIVOS DE COLOMBIA
 *
 * Se calculan solos, para cualquier año: no hay que actualizar ninguna
 * lista cada enero. Fuente única: la usan el bot (lista de fechas del
 * cliente y agenda del barbero por WhatsApp) y el panel web.
 *
 * ⚠️ Un festivo NO cierra la barbería: se atiende normal, con el horario
 * de ese día de la semana. Solo se MARCA, para que el cliente y el barbero
 * lo sepan. El barbero que no vaya a trabajar lo bloquea desde el panel con
 * "Bloquear día" (decisión de noviembre de 2026).
 *
 * Tres clases de festivo:
 *   - Fijos: caen el día que caen.
 *   - Ley Emiliani (Ley 51 de 1983): si no caen en lunes, pasan al lunes
 *     siguiente.
 *   - Atados a la Pascua: Jueves y Viernes Santo quedan donde caen; los
 *     demás también se pasan al lunes.
 */

const FIJOS = [
  [1, 1, 'Año Nuevo'],
  [5, 1, 'Día del Trabajo'],
  [7, 20, 'Día de la Independencia'],
  [8, 7, 'Batalla de Boyacá'],
  [12, 8, 'Inmaculada Concepción'],
  [12, 25, 'Navidad'],
];

const EMILIANI = [
  [1, 6, 'Reyes Magos'],
  [3, 19, 'San José'],
  [6, 29, 'San Pedro y San Pablo'],
  [8, 15, 'Asunción de la Virgen'],
  [10, 12, 'Día de la Raza'],
  [11, 1, 'Todos los Santos'],
  [11, 11, 'Independencia de Cartagena'],
];

// Días después del domingo de Pascua, y si se pasan al lunes.
const PASCUA = [
  [-3, false, 'Jueves Santo'],
  [-2, false, 'Viernes Santo'],
  [39, true, 'Ascensión del Señor'],
  [60, true, 'Corpus Christi'],
  [68, true, 'Sagrado Corazón'],
];

/** Domingo de Pascua (algoritmo anónimo gregoriano). Mes 1–12. */
export function domingoDePascua(año) {
  const a = año % 19;
  const b = Math.floor(año / 100);
  const c = año % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;

  return new Date(año, mes - 1, dia);
}

const aISO = (fecha) =>
  `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;

/** Si no cae en lunes, el lunes siguiente. */
function alLunes(fecha) {
  const resultado = new Date(fecha);
  const dia = resultado.getDay();              // 0 domingo … 6 sábado
  if (dia !== 1) resultado.setDate(resultado.getDate() + ((8 - dia) % 7));
  return resultado;
}

const cache = new Map();

/** Los festivos de un año: Map de 'AAAA-MM-DD' → nombre. */
export function festivosDelAño(año) {
  if (cache.has(año)) return cache.get(año);

  const festivos = new Map();

  for (const [mes, dia, nombre] of FIJOS) {
    festivos.set(aISO(new Date(año, mes - 1, dia)), nombre);
  }

  for (const [mes, dia, nombre] of EMILIANI) {
    festivos.set(aISO(alLunes(new Date(año, mes - 1, dia))), nombre);
  }

  const pascua = domingoDePascua(año);
  for (const [dias, seMueve, nombre] of PASCUA) {
    const fecha = new Date(pascua);
    fecha.setDate(fecha.getDate() + dias);
    festivos.set(aISO(seMueve ? alLunes(fecha) : fecha), nombre);
  }

  cache.set(año, festivos);
  return festivos;
}

/** El nombre del festivo de esa fecha ('AAAA-MM-DD'), o null si no es festivo. */
export function festivoDe(fechaISO) {
  const año = Number(String(fechaISO).slice(0, 4));
  if (!año) return null;

  return festivosDelAño(año).get(String(fechaISO).slice(0, 10)) || null;
}
