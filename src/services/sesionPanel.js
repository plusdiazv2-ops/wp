import crypto from 'node:crypto';
import config from '../config/env.js';

/**
 * SESIÓN DEL PANEL — cookie firmada, sin guardar nada
 *
 * La cookie lleva dentro el número y la fecha de vencimiento, y va firmada con
 * un secreto del servidor. Si alguien la modifica, la firma no cuadra y se
 * rechaza. No se guarda ninguna sesión en Sheets ni en memoria: verificarla no
 * cuesta ni una lectura.
 *
 * ⚠️ El costo de esta simplicidad: no se puede cerrar la sesión de UN
 * dispositivo. Cambiar SESION_SECRETO saca a todo el mundo de golpe — eso es
 * lo que se usa si alguien pierde el celular.
 */

export const NOMBRE_COOKIE = 'panel_sesion';
export const DURACION_MS = 30 * 24 * 60 * 60 * 1000;   // 30 días

let secretoDeRespaldo = null;

/**
 * Si no hay SESION_SECRETO configurado se genera uno al azar al arrancar.
 *
 * Es a propósito: si esto fallara por falta de variable, desplegar sin haberla
 * puesto dejaría el panel inservible sin explicación. Así funciona igual, solo
 * que cada despliegue cierra las sesiones abiertas.
 */
function secreto() {
  if (config.SESION_SECRETO) return config.SESION_SECRETO;

  if (!secretoDeRespaldo) {
    secretoDeRespaldo = crypto.randomBytes(32).toString('hex');
    console.warn(
      '⚠️ SESION_SECRETO no está configurado: se generó uno temporal. ' +
      'El panel funciona, pero cada despliegue cierra las sesiones. ' +
      'Ponlo en las variables de Railway.'
    );
  }

  return secretoDeRespaldo;
}

const aBase64Url = (texto) =>
  Buffer.from(texto, 'utf8').toString('base64url');

const deBase64Url = (texto) =>
  Buffer.from(texto, 'base64url').toString('utf8');

const firmar = (cuerpo) =>
  crypto.createHmac('sha256', secreto()).update(cuerpo).digest('base64url');

/** Crea el valor de la cookie para ese número. */
export function crearSesion(telefono, ahora = Date.now()) {
  const datos = { tel: String(telefono), exp: ahora + DURACION_MS };
  const cuerpo = aBase64Url(JSON.stringify(datos));

  return `${cuerpo}.${firmar(cuerpo)}`;
}

/**
 * Devuelve { tel, exp } si la cookie es válida, o null si no lo es.
 * Null cubre todo: manipulada, vencida, con basura o ausente.
 */
export function leerSesion(valorCookie, ahora = Date.now()) {
  if (!valorCookie || typeof valorCookie !== 'string') return null;

  const separador = valorCookie.lastIndexOf('.');
  if (separador <= 0) return null;

  const cuerpo = valorCookie.slice(0, separador);
  const firmaRecibida = valorCookie.slice(separador + 1);
  const firmaEsperada = firmar(cuerpo);

  // Comparación en tiempo constante, para no filtrar la firma por lo que
  // tarda en fallar.
  const a = Buffer.from(firmaRecibida);
  const b = Buffer.from(firmaEsperada);

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let datos;
  try {
    datos = JSON.parse(deBase64Url(cuerpo));
  } catch {
    return null;
  }

  if (!datos?.tel || typeof datos.exp !== 'number') return null;
  if (ahora > datos.exp) return null;

  return datos;
}

/** Lee una cookie del encabezado, sin depender de ninguna librería. */
export function leerCookie(req, nombre) {
  const bruto = req?.headers?.cookie || '';

  for (const parte of bruto.split(';')) {
    const igual = parte.indexOf('=');
    if (igual === -1) continue;

    if (parte.slice(0, igual).trim() === nombre) {
      try {
        return decodeURIComponent(parte.slice(igual + 1).trim());
      } catch {
        return null;
      }
    }
  }

  return null;
}

/**
 * Opciones de la cookie.
 *
 * `secure` sale del protocolo real: en Railway es HTTPS y va marcada, en
 * localhost es HTTP y no, para poder probar. Requiere `trust proxy` en app.js,
 * porque Railway termina el TLS antes de llegar a Node.
 */
export function opcionesCookie(req) {
  return {
    httpOnly: true,                 // no se puede leer desde JavaScript
    secure: Boolean(req?.secure),   // no viaja sin HTTPS
    sameSite: 'strict',             // no la manda un sitio ajeno
    maxAge: DURACION_MS,
    path: '/panel',                 // solo se envía a las rutas del panel
  };
}
