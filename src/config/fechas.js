import { NOMBRES_DIAS, turnoAMinutos } from './barbers.js';

/**
 * Formatos de fecha que se guardan en la hoja.
 *
 * Vive aquí y no dentro de un servicio para que lo puedan usar tanto el bot
 * como el panel web sin que uno importe al otro. Si estuviera duplicado,
 * el día que cambie uno la columna B quedaría escrita de dos formas
 * distintas — que es exactamente el tipo de problema que ya costó caro con
 * los horarios.
 */

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

/** "2026-08-12" → "Miércoles 12 de agosto"  (columna B de la hoja) */
export function fechaVisible(iso) {
  const fecha = new Date(`${iso}T00:00:00`);
  if (isNaN(fecha.getTime())) return '';

  return `${NOMBRES_DIAS[fecha.getDay()]} ${fecha.getDate()} de ${MESES[fecha.getMonth()]}`;
}

/**
 * "2026-08-12" + "6:00pm" → "2026-08-12 18:00:00"  (columna I)
 * Es lo que usa el cron de recordatorios para saber cuándo avisar.
 */
export function fechaHoraTurno(iso, hora) {
  const minutos = turnoAMinutos(hora);
  if (minutos < 0) return null;

  const hh = String(Math.floor(minutos / 60)).padStart(2, '0');
  const mm = String(minutos % 60).padStart(2, '0');

  return `${iso} ${hh}:${mm}:00`;
}
