import { esTurnoValido, turnoAMinutos, NOMBRES_DIAS, partirEnJornadas } from '../config/barbers.js';

/**
 * Revisa un horario ANTES de guardarlo.
 *
 * Es lo único que separa un descuido al escribir de un bot que deja de
 * funcionar. Un horario mal puesto no se nota al guardarlo: se nota cuando
 * un cliente no puede agendar.
 */

// Una lista de WhatsApp admite 10 filas y 2 se van en Volver y Menú.
export const MAXIMO_POR_JORNADA = 8;

/** "9am, 10:45am , 1:30pm" → ['9am', '10:45am', '1:30pm'] */
export function separarTurnos(texto) {
  return String(texto || '')
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Limpia y valida los turnos de un día.
 * → { turnos, error }
 */
export function revisarDia(texto, nombreDia) {
  const crudos = separarTurnos(texto);

  const malos = crudos.filter(t => !esTurnoValido(t));
  if (malos.length) {
    return {
      error: `${nombreDia}: no entiendo "${malos.join('", "')}". `
           + `Escríbelos como 9am, 10:45am o 1:30pm.`,
    };
  }

  // Repetidos: se quitan en silencio, no es un error del usuario.
  const turnos = [...new Set(crudos)].sort((a, b) => turnoAMinutos(a) - turnoAMinutos(b));

  // Las mismas jornadas que ve el cliente. Si la tarde no cabe entera, se
  // parte sola en tarde y tarde-noche, y entonces el tope aplica a cada una.
  const { manana, tarde, tardenoche } = partirEnJornadas(turnos, MAXIMO_POR_JORNADA);

  // Si una jornada se pasa, WhatsApp no puede mostrarla completa y el cliente
  // dejaría de ver los últimos turnos sin que nadie se entere.
  const jornadas = [
    ['la mañana', manana],
    ['la tarde', tarde],
    ['la tarde-noche', tardenoche],
  ];

  for (const [jornada, lista] of jornadas) {
    if (lista.length > MAXIMO_POR_JORNADA) {
      return {
        error: `${nombreDia}: ${lista.length} turnos en ${jornada}, y en una lista de `
             + `WhatsApp solo caben ${MAXIMO_POR_JORNADA}. Los últimos no se verían. `
             + `Quita ${lista.length - MAXIMO_POR_JORNADA}.`,
      };
    }
  }

  return { turnos };
}

/**
 * Revisa la semana completa.
 * → { porDia, errores }
 */
export function revisarSemana(dias) {
  const porDia = {};
  const errores = [];

  NOMBRES_DIAS.forEach((nombreDia, dia) => {
    const revisado = revisarDia(dias?.[dia] ?? dias?.[String(dia)] ?? '', nombreDia);

    if (revisado.error) errores.push(revisado.error);
    else porDia[dia] = revisado.turnos;
  });

  return { porDia, errores };
}
