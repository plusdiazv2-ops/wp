import config from '../config/env.js';
import sendToWhatsApp from './httpRequest/sendToWhatsApp.js';
import { telefonoVisible } from '../config/contacto.js';

/**
 * ALERTAS AL DESARROLLADOR
 *
 * Para los fallos que no se ven. Ya pasaron dos que costaron caro:
 *
 *   - Agosto 2026: el dominio cambió y Meta siguió mandando al viejo. Horas
 *     sin recibir un solo mensaje, y nadie se enteró.
 *   - Noviembre 2026: Meta rechazaba todos los recordatorios y avisos a los
 *     barberos por un cobro fallido a la tarjeta (código 131042). El bot los
 *     daba por enviados. Días sin recordatorios.
 *
 * Salen por DOS caminos a propósito:
 *
 *   - Correo, por Resend (HTTPS). No depende de Meta: llega aunque el
 *     problema sea justo de WhatsApp o del pago. Railway bloquea el correo
 *     tradicional (SMTP) en este plan, por eso no se usa Gmail directo.
 *   - WhatsApp al número del desarrollador. Es lo que se ve primero, pero
 *     solo llega si ese número le escribió al bot en las últimas 24 horas.
 *
 * Freno: la misma alerta (misma `clave`) sale como mucho una vez cada 6
 * horas. Sin esto, un problema que dura un día serían cientos de correos.
 */

export const FRENO_MS = 6 * 60 * 60 * 1000;

// clave → momento de la última alerta. En memoria: si Railway reinicia,
// como mucho llega una alerta repetida, que es preferible a perderla.
const ultimas = new Map();

// Los ids de los WhatsApp que son alertas. Si uno de ellos falla, Meta avisa
// por el webhook y eso NO debe disparar otra alerta: sería un bucle.
const idsDeAlertas = new Set();

/** ¿Toca avisar de esto, o ya se avisó hace poco? Marca el momento si toca. */
export function debeAvisar(clave, ahora = Date.now(), freno = FRENO_MS) {
  const ultima = ultimas.get(clave);
  if (ultima && ahora - ultima < freno) return false;

  ultimas.set(clave, ahora);
  return true;
}

/** Para los tests. */
export function olvidarAlertas() {
  ultimas.clear();
  idsDeAlertas.clear();
}

export const esIdDeAlerta = (id) => idsDeAlertas.has(id);

if (!config.RESEND_API_KEY) {
  console.warn(
    '⚠️ Sin RESEND_API_KEY: las alertas solo saldrán por WhatsApp, y ese ' +
    'camino falla justo cuando el problema es de Meta o del pago. ' +
    'Ponla en Railway para recibirlas también por correo.'
  );
}

async function porCorreo(asunto, texto) {
  if (!config.RESEND_API_KEY || !config.ALERTA_CORREO) return 'sin configurar';

  const respuesta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      // Sin dominio propio, Resend solo deja mandar desde esta dirección y
      // solo al correo dueño de la cuenta. Para alertas es justo lo que hace falta.
      from: 'Bot Exclusive Barber <onboarding@resend.dev>',
      to: [config.ALERTA_CORREO],
      subject: `🚨 ${asunto}`,
      text: texto,
    }),
  });

  if (!respuesta.ok) {
    throw new Error(`Resend respondió ${respuesta.status}: ${await respuesta.text()}`);
  }

  return 'enviado';
}

async function porWhatsApp(asunto, texto) {
  if (!config.ALERTA_WHATSAPP) return 'sin configurar';

  const respuesta = await sendToWhatsApp({
    messaging_product: 'whatsapp',
    to: config.ALERTA_WHATSAPP,
    type: 'text',
    text: { body: `🚨 *${asunto}*\n\n${texto}` },
  });

  const id = respuesta?.messages?.[0]?.id;
  if (id) idsDeAlertas.add(id);

  return 'enviado';
}

/**
 * Avisa al desarrollador. Nunca lanza error: una alerta que falla no puede
 * tumbar lo que estaba haciendo el bot.
 *
 * `clave` agrupa las alertas para el freno: dos fallos con la misma clave en
 * menos de 6 horas mandan una sola alerta.
 */
export async function enviarAlerta({ clave, asunto, texto, freno = FRENO_MS }) {
  if (!debeAvisar(clave, Date.now(), freno)) {
    console.log(`🔕 Alerta frenada (ya se avisó hace poco): ${clave}`);
    return { enviada: false };
  }

  console.error(`🚨 ALERTA [${clave}] ${asunto}\n${texto}`);

  const [correo, whatsapp] = await Promise.allSettled([
    porCorreo(asunto, texto),
    porWhatsApp(asunto, texto),
  ]);

  const como = (r) => (r.status === 'fulfilled' ? r.value : `falló: ${r.reason?.message || r.reason}`);
  console.log(`🚨 Alerta [${clave}] → correo: ${como(correo)} · WhatsApp: ${como(whatsapp)}`);

  return { enviada: true, correo: como(correo), whatsapp: como(whatsapp) };
}

/**
 * Arma la alerta de un mensaje que Meta NO entregó, o null si no hay que
 * avisar. Separada del envío para poder probarla sin mandar nada.
 */
export function alertaDeEntrega(estado) {
  if (estado?.status !== 'failed') return null;
  if (esIdDeAlerta(estado.id)) return null;

  const error = estado.errors?.[0] || {};
  const codigo = error.code ?? 'sin código';
  const detalle = error.error_data?.details || error.message || '';
  const destino = estado.recipient_id || estado.recipient_user_id || '';

  const lineas = [
    `Para: ${telefonoVisible(destino)}`,
    `Código: ${codigo} — ${error.title || ''}`,
    detalle ? `Detalle: ${detalle}` : null,
    '',
    'Si es 131042, hay un problema de pago en Meta: revisa Facturación y pagos.',
    'Mientras no se resuelva, no llegan recordatorios ni avisos a los barberos.',
    '',
    'Esta alerta no se repite por 6 horas aunque sigan fallando más mensajes con este mismo código.',
  ];

  return {
    clave: `entrega_fallida_${codigo}`,
    asunto: `Meta no entregó un mensaje (${codigo})`,
    texto: lineas.filter(linea => linea !== null).join('\n'),
  };
}

/**
 * Meta avisó por el webhook que un mensaje NO se entregó.
 *
 * El envío había salido "bien": Meta lo aceptó y el bot siguió. El rechazo
 * llega segundos después, por otro lado. Sin esto, solo quedaba en los logs.
 */
export async function alertaPorEntregaFallida(estado) {
  const alerta = alertaDeEntrega(estado);
  if (!alerta) return { enviada: false };

  return enviarAlerta(alerta);
}
