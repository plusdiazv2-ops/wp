import crypto from 'node:crypto';
import config from '../config/env.js';

/**
 * ACCESO AL PANEL DE ADMINISTRACIÓN
 *
 * Entrar al panel no usa contraseñas. El admin le escribe `acceso` al bot por
 * WhatsApp, el bot le responde un código de 6 dígitos, y con ese código entra
 * a la web.
 *
 * Por qué el recorrido EMPIEZA en WhatsApp: Meta solo deja enviar mensajes
 * libres dentro de las 24 horas siguientes al último mensaje del usuario.
 * Fuera de esa ventana hace falta una plantilla aprobada. Como aquí el admin
 * escribe primero, la ventana queda abierta y la respuesta no cuesta nada.
 */

export const VIGENCIA_MS = 5 * 60 * 1000;   // 5 minutos
export const MAX_INTENTOS = 5;

// Códigos pendientes: teléfono → { codigo, expira, intentos }
//
// Viven en memoria a propósito. Son de usar y tirar: si Railway reinicia se
// pierden y el admin pide otro. No vale la pena guardarlos en ningún lado.
const pendientes = new Map();

/** Solo dígitos. "+57 313 712 7100" y "573137127100" son el mismo número. */
export function normalizarTelefono(valor) {
  return String(valor || '').replace(/\D/g, '');
}

/**
 * Los números que siempre son admin, desde la variable de entorno.
 * Se pueden poner varios separados por coma.
 *
 * Estos NO se pueden quitar desde la web: son el seguro por si alguien se
 * equivoca editando la lista de admins.
 */
export function adminsPrincipales() {
  return String(config.ADMIN_PRINCIPAL || '')
    .split(',')
    .map(normalizarTelefono)
    .filter(Boolean);
}

export function esAdminPrincipal(telefono) {
  return adminsPrincipales().includes(normalizarTelefono(telefono));
}

/**
 * ¿Este número puede entrar al panel?
 *
 * `adminsExtra` son los agregados desde la web (pestaña `admins_web`). Se
 * reciben por parámetro para que este archivo no dependa de Google Sheets y
 * se pueda probar solo.
 */
export function puedeEntrar(telefono, adminsExtra = []) {
  const numero = normalizarTelefono(telefono);
  if (!numero) return false;

  if (esAdminPrincipal(numero)) return true;

  return adminsExtra.map(normalizarTelefono).includes(numero);
}

/**
 * Genera un código nuevo para ese número e invalida el anterior.
 * Se usa crypto y no Math.random: un código de acceso adivinable no sirve.
 */
export function generarCodigo(telefono) {
  const numero = normalizarTelefono(telefono);
  const codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

  pendientes.set(numero, {
    codigo,
    expira: Date.now() + VIGENCIA_MS,
    intentos: 0,
  });

  return codigo;
}

/**
 * Comprueba el código. Devuelve el motivo exacto para poder registrarlo en
 * el servidor, aunque al usuario se le muestre siempre lo mismo.
 *
 * → { ok: true } | { ok: false, motivo: 'sin_codigo' | 'expirado' |
 *                                        'demasiados_intentos' | 'incorrecto' }
 */
export function verificarCodigo(telefono, codigoRecibido) {
  const numero = normalizarTelefono(telefono);
  const pendiente = pendientes.get(numero);

  if (!pendiente) return { ok: false, motivo: 'sin_codigo' };

  if (Date.now() > pendiente.expira) {
    pendientes.delete(numero);
    return { ok: false, motivo: 'expirado' };
  }

  if (pendiente.intentos >= MAX_INTENTOS) {
    pendientes.delete(numero);
    return { ok: false, motivo: 'demasiados_intentos' };
  }

  pendiente.intentos++;

  // Comparación en tiempo constante, para no filtrar el código por lo que
  // tarda en fallar.
  const recibido = Buffer.from(normalizarTelefono(codigoRecibido).padStart(6, '0').slice(0, 6));
  const esperado = Buffer.from(pendiente.codigo);

  const coincide = recibido.length === esperado.length
    && crypto.timingSafeEqual(recibido, esperado);

  if (!coincide) {
    if (pendiente.intentos >= MAX_INTENTOS) pendientes.delete(numero);
    return { ok: false, motivo: 'incorrecto' };
  }

  // De un solo uso.
  pendientes.delete(numero);
  return { ok: true };
}

/** Para las pruebas y para cerrar todo de golpe si hiciera falta. */
export function olvidarCodigos() {
  pendientes.clear();
}

export function hayCodigoPendiente(telefono) {
  return pendientes.has(normalizarTelefono(telefono));
}

/**
 * FRENO DE ENVIOS
 *
 * Desde la web cualquiera puede escribir un numero y pedir un codigo. Sin
 * freno eso serviria para dos cosas malas: probar numeros hasta dar con los
 * de los admins (la web dice cuando un numero SI esta habilitado), y hacernos
 * gastar envios de WhatsApp a punta de darle al boton.
 *
 * Se cuenta por numero Y por dispositivo: cambiar de numero no reinicia la
 * cuenta, y cambiar de red tampoco.
 */
export const MAX_ENVIOS = 3;
export const VENTANA_ENVIOS_MS = 10 * 60 * 1000;   // 10 minutos

// clave ("tel:573..." / "ip:1.2.3.4") -> momentos de los ultimos envios
const envios = new Map();

/** Tira lo viejo para que el mapa no crezca sin parar. */
function limpiarEnvios(ahora) {
  for (const [clave, momentos] of envios) {
    const vivos = momentos.filter(m => ahora - m < VENTANA_ENVIOS_MS);

    if (vivos.length) envios.set(clave, vivos);
    else envios.delete(clave);
  }
}

/**
 * Pide permiso para mandar un codigo. Si alguna de las claves ya llego al
 * tope, NO se apunta nada y se dice cuanto falta para poder reintentar.
 *
 * → { ok: true } | { ok: false, esperaSegundos }
 */
export function permitirEnvio(claves = []) {
  const ahora = Date.now();
  limpiarEnvios(ahora);

  const usadas = claves.map(String).filter(Boolean);
  if (!usadas.length) return { ok: true };

  let esperaMax = 0;

  for (const clave of usadas) {
    const momentos = envios.get(clave) || [];

    if (momentos.length >= MAX_ENVIOS) {
      // El mas viejo de la tanda es el que libera el cupo.
      const libera = momentos[0] + VENTANA_ENVIOS_MS - ahora;
      esperaMax = Math.max(esperaMax, libera);
    }
  }

  if (esperaMax > 0) {
    return { ok: false, esperaSegundos: Math.max(1, Math.ceil(esperaMax / 1000)) };
  }

  // Se apunta solo cuando el envio va en serio, y en todas las claves a la vez.
  for (const clave of usadas) {
    envios.set(clave, [...(envios.get(clave) || []), ahora]);
  }

  return { ok: true };
}

/** Para las pruebas y para levantar el freno a mano si hiciera falta. */
export function olvidarEnvios() {
  envios.clear();
}
