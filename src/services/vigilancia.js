import axios from 'axios';
import config from '../config/env.js';
import { enviarAlerta } from './alertas.js';

/**
 * VIGILANCIA CONTRA FALLOS SILENCIOSOS
 *
 * Cada 15 minutos revisa lo que, si se rompe, deja al bot mudo sin que
 * nada lo delate: el servicio responde, la web se ve, los logs se ven
 * normales... y simplemente no llega nada.
 *
 *   1. Que el número siga CONECTADO en Meta.
 *   2. Que alguna app siga suscrita a la cuenta de WhatsApp (WABA). Sin
 *      suscripción, Meta no manda ni un mensaje al webhook.
 *   3. Que sigan llegando cosas al webhook. Si en horario de la barbería
 *      pasan 4 horas sin nada, algo se rompió por fuera — así fue el cambio
 *      de dominio de agosto de 2026.
 *
 * El resultado queda guardado para /salud, que NO consulta a Meta en cada
 * visita: así nadie puede gastarnos llamadas a la API refrescando la página.
 */

export const SILENCIO_MAXIMO_MS = 4 * 60 * 60 * 1000;

let ultimoWebhook = Date.now();   // al arrancar se cuenta como "recién"
let ultimaRevision = null;        // { momento, problemas }

/** Lo llama el webhook con cada cosa que llega de Meta. */
export function anotarWebhook(ahora = Date.now()) {
  ultimoWebhook = ahora;
}

/** ¿Es horario en que la barbería debería estar recibiendo mensajes? */
export function esHorarioDeAtencion(fechaBogota) {
  const dia = fechaBogota.getDay();      // 0 = domingo
  const hora = fechaBogota.getHours();
  return dia !== 0 && hora >= 10 && hora < 19;
}

const ahoraEnBogota = () =>
  new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));

/**
 * Decide qué está mal. Pura: recibe lo que se averiguó y devuelve la lista
 * de problemas (vacía = todo bien). `null` en un dato = no se pudo revisar,
 * que NO es lo mismo que estar mal: un hipo de la API de Meta no debe
 * despertar a nadie.
 */
export function evaluar({ estadoNumero, appsSuscritas, msDesdeUltimoWebhook, enHorario }) {
  const problemas = [];

  if (estadoNumero !== null && estadoNumero !== 'CONNECTED') {
    problemas.push({
      clave: 'numero_desconectado',
      texto: `El número del bot NO está conectado en Meta (estado: ${estadoNumero || 'desconocido'}). Mientras tanto, el bot no envía ni recibe nada.`,
    });
  }

  if (appsSuscritas !== null && appsSuscritas === 0) {
    problemas.push({
      clave: 'app_sin_suscripcion',
      texto: 'Ninguna app está suscrita a la cuenta de WhatsApp. Meta no le está mandando mensajes al webhook: el bot está sordo.',
    });
  }

  if (enHorario && msDesdeUltimoWebhook > SILENCIO_MAXIMO_MS) {
    const horas = Math.floor(msDesdeUltimoWebhook / 3600000);
    problemas.push({
      clave: 'webhook_en_silencio',
      texto: `Hace ${horas} horas no llega nada al webhook en horario de atención. Revisa en Meta que la URL de devolución de llamada siga siendo la de Railway y termine en /webhook.`,
    });
  }

  return problemas;
}

async function consultarMeta(ruta) {
  const respuesta = await axios({
    method: 'GET',
    url: `https://graph.facebook.com/${config.API_VERSION}/${ruta}`,
    headers: { Authorization: `Bearer ${config.API_TOKEN}` },
    timeout: 15000,
  });
  return respuesta.data;
}

/** Revisa todo, guarda el resultado para /salud y alerta lo que esté mal. */
export async function revisarSalud() {
  let estadoNumero = null;
  let appsSuscritas = null;

  try {
    estadoNumero = (await consultarMeta(`${config.BUSINESS_PHONE}?fields=status`)).status ?? null;
  } catch (error) {
    console.log('Vigilancia: no se pudo consultar el número:', error?.response?.data?.error?.message || error?.message);
  }

  if (config.WABA_ID) {
    try {
      appsSuscritas = ((await consultarMeta(`${config.WABA_ID}/subscribed_apps`)).data || []).length;
    } catch (error) {
      console.log('Vigilancia: no se pudo consultar la suscripción:', error?.response?.data?.error?.message || error?.message);
    }
  }

  const problemas = evaluar({
    estadoNumero,
    appsSuscritas,
    msDesdeUltimoWebhook: Date.now() - ultimoWebhook,
    enHorario: esHorarioDeAtencion(ahoraEnBogota()),
  });

  ultimaRevision = { momento: Date.now(), problemas };

  for (const problema of problemas) {
    await enviarAlerta({
      clave: problema.clave,
      asunto: 'El bot de Exclusive Barber tiene un problema',
      texto: problema.texto,
    });
  }

  if (!problemas.length) console.log('🩺 Vigilancia: todo en orden.');

  return problemas;
}

/**
 * Para /salud. Sin detalles a propósito: es una página pública y solo tiene
 * que decir sí o no. Los detalles van en la alerta.
 */
export function resumenDeSalud() {
  if (!ultimaRevision) return { ok: true, revisado: null };

  return {
    ok: ultimaRevision.problemas.length === 0,
    revisado: new Date(ultimaRevision.momento).toISOString(),
  };
}
