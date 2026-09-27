/**
 * CÓMO SE IDENTIFICA A UN CLIENTE
 *
 * Lo normal es el teléfono: `573001112233`, solo dígitos.
 *
 * Pero desde 2026 WhatsApp deja activar un **nombre de usuario**, y quien lo
 * hace oculta su número. Meta entonces no manda el teléfono: manda un código
 * propio de este negocio —un BSUID— con la forma `CO.1429929462353188`.
 *
 * Ese código es estable para esa persona, así que sirve igual de bien como
 * identificador: sesión, turnos, cancelaciones. Lo que NO sirve es para
 * llamarla ni para mostrárselo a un barbero.
 *
 * ⚠️ Un mismo contacto puede traer las dos cosas. Cuando llega el teléfono se
 * usa el teléfono: es lo que ya está guardado en los turnos históricos.
 *
 * Documentación de Meta:
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/
 */

/** Cómo se le muestra a un humano un cliente que escondió su número. */
export const SIN_NUMERO = 'sin número (usuario de WhatsApp)';

/**
 * ¿Este identificador es un código de usuario en vez de un teléfono?
 *
 * Un teléfono son solo dígitos. Cualquier otra cosa (el punto del `CO.`, por
 * ejemplo) es un código de usuario.
 */
export function esUsuarioSinNumero(identificador) {
  const id = String(identificador ?? '').trim();

  return id.length > 0 && !/^\d+$/.test(id);
}

/**
 * De dónde sale el remitente de un mensaje entrante.
 *
 * Se miran las cuatro fuentes por orden, y el teléfono siempre va primero:
 *
 *   1. `messages[].from`          el teléfono de siempre
 *   2. `messages[].from_user_id`  el código de quien escondió su número
 *   3. `contacts[].wa_id`         respaldo
 *   4. `contacts[].user_id`       respaldo
 *
 * Antes solo se leía la primera, y a esos clientes el bot les respondía a
 * `undefined`: Meta rechazaba el envío con un 400 y el cliente se quedaba
 * esperando, sin ningún aviso ni para él ni para la barbería.
 */
export function remitenteDe(mensaje, info) {
  return mensaje?.from
    || mensaje?.from_user_id
    || info?.wa_id
    || info?.user_id
    || '';
}

/**
 * El teléfono como se le enseña a una persona: sin el 57 del país.
 * Si el cliente escondió su número, se dice con todas las letras en vez de
 * enseñarle al barbero un código que no le sirve para nada.
 */
export function telefonoVisible(identificador) {
  const id = String(identificador ?? '').trim();

  if (!id) return '';
  if (esUsuarioSinNumero(id)) return SIN_NUMERO;

  return id.replace(/^57/, '');
}
