/**
 * DEFENSA CONTRA LOS REENVÍOS DE META
 *
 * Meta espera un 200 rápido. Si no lo recibe a tiempo, da la entrega por
 * fallida y reenvía el MISMO mensaje, con el mismo `id`, durante días.
 *
 * Sin defensa, cada reenvío se procesaba como si fuera un mensaje nuevo. El
 * síntoma que se vio en producción: el cliente escoge "Tarde", recibe su
 * lista de horarios, y un minuto después le llega un "No entendí esa opción"
 * que nadie pidió — era el mismo toque llegando otra vez, ya con el flujo
 * en el paso siguiente.
 *
 * Aquí hay dos defensas distintas, para dos problemas distintos:
 *
 * 1. `esRepetido()`  — el mismo mensaje llegando dos veces.
 * 2. `esDemasiadoViejo()` — mensajes de hace horas. Pasa cuando el webhook
 *    estuvo caído: Meta guarda lo no entregado y lo suelta todo de golpe
 *    cuando vuelve. Responderle a alguien que escribió hace tres horas es
 *    peor que no responderle.
 */

// Cuánto tiempo se recuerda un id ya procesado.
export const MEMORIA_MS = 60 * 60 * 1000;        // 1 hora

// Tope de ids recordados, para que esto no crezca sin control.
export const MAXIMO_RECORDADOS = 5000;

// A partir de aquí un mensaje se considera viejo y no se responde.
// Es más que la sesión del bot, que expira a los 10 minutos.
export const ANTIGUEDAD_MAXIMA_MS = 15 * 60 * 1000;   // 15 minutos

const vistos = new Map();   // id → momento en que se procesó

function limpiarViejos() {
  const limite = Date.now() - MEMORIA_MS;

  for (const [id, momento] of vistos) {
    if (momento < limite) vistos.delete(id);
  }

  // Por si acaso: si aun así quedó enorme, se sueltan los más antiguos.
  while (vistos.size > MAXIMO_RECORDADOS) {
    vistos.delete(vistos.keys().next().value);
  }
}

/**
 * ¿Ya se procesó este mensaje? Si no, lo marca como procesado.
 *
 * Sin `id` devuelve false: mejor procesar de más que perder un mensaje real.
 */
export function esRepetido(id) {
  if (!id) return false;

  if (vistos.has(id)) return true;

  vistos.set(id, Date.now());

  if (vistos.size % 100 === 0) limpiarViejos();

  return false;
}

/**
 * ¿Este mensaje es de hace demasiado?
 *
 * `timestamp` viene de Meta en segundos, como texto. Si falta o no se
 * entiende se devuelve false a propósito: ante la duda, se procesa.
 */
export function esDemasiadoViejo(timestamp, ahora = Date.now()) {
  const segundos = Number(timestamp);

  if (!Number.isFinite(segundos) || segundos <= 0) return false;

  const edadMs = ahora - segundos * 1000;

  // Si el reloj de Meta va por delante del nuestro, tampoco es "viejo".
  if (edadMs < 0) return false;

  return edadMs > ANTIGUEDAD_MAXIMA_MS;
}

/** Para las pruebas. */
export function olvidarTodo() {
  vistos.clear();
}

export function cuantosRecordados() {
  return vistos.size;
}
