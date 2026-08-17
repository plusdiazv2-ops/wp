import { getDailyScheduleByBarber } from './googleSheetsService.js';
import { turnoAMinutos, NOMBRES_DIAS } from '../config/barbers.js';
import { NOMBRE_BLOQUEO } from './googleSheetsService.js';

/**
 * AGENDA DE LA SEMANA — para el panel web
 *
 * Arma una cuadrícula de horas × días con lo que ya devuelve
 * getDailyScheduleByBarber(). No consulta nada nuevo ni escribe nada:
 * esto solo mira.
 *
 * Cada día puede tener horarios distintos (el miércoles de Bolon es solo
 * tarde, por ejemplo), así que las filas son la UNIÓN de todas las horas de
 * la semana. Donde un barbero no trabaja a esa hora ese día, la celda queda
 * marcada como `cerrado` en vez de "libre" — no es lo mismo.
 */

const DOS_DIGITOS = n => String(n).padStart(2, '0');

/** "2026-08-12" → Date en la medianoche local de ese día. */
function aFecha(iso) {
  return new Date(`${iso}T00:00:00`);
}

export function aTextoISO(fecha) {
  return `${fecha.getFullYear()}-${DOS_DIGITOS(fecha.getMonth() + 1)}-${DOS_DIGITOS(fecha.getDate())}`;
}

/** Hoy en Bogotá, no en el reloj del servidor (Railway corre en UTC). */
export function hoyEnBogota() {
  const ahora = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' })
  );

  return aTextoISO(ahora);
}

/** El lunes de la semana a la que pertenece esa fecha. */
export function lunesDeLaSemana(iso) {
  const fecha = aFecha(iso);
  const dia = fecha.getDay();               // 0 domingo … 6 sábado
  const retroceso = dia === 0 ? 6 : dia - 1; // el domingo pertenece a la semana que termina

  fecha.setDate(fecha.getDate() - retroceso);

  return aTextoISO(fecha);
}

export function sumarDias(iso, dias) {
  const fecha = aFecha(iso);
  fecha.setDate(fecha.getDate() + dias);

  return aTextoISO(fecha);
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

/** Los 7 días de la semana que empieza ese lunes. */
export function diasDeLaSemana(lunesISO, hoyISO = hoyEnBogota()) {
  return Array.from({ length: 7 }, (_, i) => {
    const fecha = sumarDias(lunesISO, i);
    const d = aFecha(fecha);

    return {
      fecha,
      nombre: NOMBRES_DIAS[d.getDay()],
      corto: NOMBRES_DIAS[d.getDay()].slice(0, 3),
      numero: d.getDate(),
      mes: MESES[d.getMonth()],
      esHoy: fecha === hoyISO,
      esPasado: fecha < hoyISO,
    };
  });
}

/** "10 – 16 de agosto" o "28 de julio – 3 de agosto" si cruza de mes. */
export function rotuloSemana(dias) {
  const primero = dias[0];
  const ultimo = dias[dias.length - 1];

  return primero.mes === ultimo.mes
    ? `${primero.numero} – ${ultimo.numero} de ${primero.mes}`
    : `${primero.numero} de ${primero.mes} – ${ultimo.numero} de ${ultimo.mes}`;
}

/**
 * La semana completa de un barbero.
 *
 * Devuelve { horas, dias } donde cada día trae sus turnos indexados por hora.
 * Las horas van ordenadas y son la unión de las de todos los días.
 */
export async function armarSemana(barbero, lunesISO, hoyISO = hoyEnBogota()) {
  const dias = diasDeLaSemana(lunesISO, hoyISO);
  const horas = new Set();

  for (const dia of dias) {
    const agenda = await getDailyScheduleByBarber(barbero, dia.fecha);

    dia.turnos = {};
    dia.trabaja = agenda.length > 0;

    for (const turno of agenda) {
      horas.add(turno.time);

      const esBloqueo = String(turno.name || '')
        .toLowerCase()
        .startsWith(NOMBRE_BLOQUEO.toLowerCase());

      dia.turnos[turno.time] = {
        estado: turno.status,                        // 'ocupado' | 'libre'
        // Un bloqueo es un turno ocupado con nombre "Descanso". Se marca
        // aparte para que el panel lo pinte distinto y deje liberarlo.
        bloqueado: turno.status === 'ocupado' && esBloqueo,
        nombre: turno.name || '',
        telefono: (turno.phone || '').replace(/^57/, ''),
      };
    }
  }

  return {
    horas: [...horas].sort((a, b) => turnoAMinutos(a) - turnoAMinutos(b)),
    dias,
  };
}
