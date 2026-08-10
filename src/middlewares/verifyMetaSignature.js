import crypto from 'node:crypto';
import config from '../config/env.js';

/**
 * Comprueba que el POST del webhook venga de verdad de Meta.
 *
 * Sin esto, cualquiera que conozca la URL de Railway puede mandar un POST
 * falso y hacer que el bot escriba filas en la hoja y envíe WhatsApps a
 * números arbitrarios. La URL no es un secreto: está en el panel de Meta y
 * aparece en los logs.
 *
 * ⚠️ El `WEBHOOK_VERIFY_TOKEN` NO sirve para esto: solo protege el GET de
 * verificación inicial, no el POST por donde entran los mensajes.
 *
 * Meta firma el cuerpo con el App Secret y manda el resultado en la cabecera
 * `X-Hub-Signature-256`. Hay que calcular lo mismo sobre el cuerpo CRUDO: si
 * se usa el JSON ya parseado y vuelto a serializar, la firma nunca coincide.
 */

/** La firma que Meta debería haber mandado para este cuerpo. */
export function calcularFirma(cuerpoCrudo, secreto) {
  return 'sha256=' + crypto
    .createHmac('sha256', secreto)
    .update(cuerpoCrudo)
    .digest('hex');
}

/**
 * Compara en tiempo constante, para no filtrar información sobre el secreto
 * según cuánto tarda en fallar la comparación.
 */
export function firmaEsValida(firmaRecibida, cuerpoCrudo, secreto) {
  if (!firmaRecibida || !secreto || !cuerpoCrudo) return false;

  const esperada = calcularFirma(cuerpoCrudo, secreto);

  const a = Buffer.from(String(firmaRecibida));
  const b = Buffer.from(esperada);

  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

let yaAvisoQueEstaApagado = false;

export function verificarFirmaMeta(req, res, next) {
  const secreto = config.META_APP_SECRET;

  // Sin secreto configurado NO se valida, a propósito. Si esto rechazara
  // todo cuando falta la variable, desplegar sin haberla puesto en Railway
  // dejaría al bot sordo y nadie sabría por qué.
  if (!secreto) {
    if (!yaAvisoQueEstaApagado) {
      console.warn(
        '⚠️ META_APP_SECRET no está configurado: el webhook acepta cualquier POST. ' +
        'Ponlo en las variables de Railway para activar la verificación.'
      );
      yaAvisoQueEstaApagado = true;
    }

    return next();
  }

  if (!firmaEsValida(req.get('X-Hub-Signature-256'), req.rawBody, secreto)) {
    // Se registra fuerte: si el secreto quedó mal copiado, esto se llena de
    // rechazos y es la pista de por qué el bot dejó de responder.
    console.error('🚫 Webhook rechazado: la firma no coincide.');
    return res.sendStatus(403);
  }

  return next();
}

export default verificarFirmaMeta;
