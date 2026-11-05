import crypto from 'node:crypto';
import config from '../config/env.js';
import { nombreVisible } from '../config/barbers.js';
import { festivoDe } from '../config/festivos.js';
import {
  getAvailableSlots,
  checkAvailability,
  countUserAppointmentsSameDay,
  SheetsUnavailableError,
} from './googleSheetsService.js';
import whatsappService from './whatsappService.js';

/**
 * AGENDAR CON FORMULARIO DE WHATSAPP (Flows) — Fase 2, noviembre 2026
 *
 * En vez de 6–8 mensajes (nombre, barbero, fecha, jornada, hora…), el
 * cliente llena una pantalla dentro de WhatsApp. Desde octubre de 2026 Meta
 * cobra los mensajes normales pasado el cupo gratis: esto ahorra plata y
 * tiempo.
 *
 * Pantallas (el diseño está en flows/agendar.json):
 *   DATOS  → nombre y barbero
 *   FECHA  → los días con turnos, con "Festivo" marcado
 *   HORA   → las horas libres DE VERDAD, consultadas en el momento
 *   LISTO  → confirmación
 *
 * ⚠️ Todas las reglas son las del flujo de siempre, llamando a las MISMAS
 * funciones: fechas de generateNextAvailableDates, horas de
 * getAvailableSlots, tope de 2 turnos, re-verificación con checkAvailability
 * y guardado con completeAppointment (fila, aviso al barbero, columna K).
 * No hay una segunda copia de ninguna regla.
 */

// ── El pase del formulario (flow_token) ──────────────────────────────────
//
// Meta no nos dice quién está llenando el formulario: solo devuelve el
// token que le mandamos. Por eso el token lleva el teléfono, FIRMADO.
//
// ⚠️ Se firma con una llave DISTINTA a la de las cookies del panel. Si fuera
// la misma, el pase de un cliente serviría como sesión del panel web.

const DURACION_TOKEN_MS = 2 * 60 * 60 * 1000;   // 2 horas para llenarlo

const secretoDelToken = () =>
  crypto.createHash('sha256').update(`formulario-agendar:${config.FLOW_PRIVATE_KEY || ''}`).digest();

const firmar = (cuerpo) =>
  crypto.createHmac('sha256', secretoDelToken()).update(cuerpo).digest('base64url');

export function crearToken(telefono, nombre = '', ahora = Date.now()) {
  const cuerpo = Buffer.from(JSON.stringify({
    t: String(telefono),
    n: String(nombre || '').slice(0, 40),
    e: ahora + DURACION_TOKEN_MS,
  })).toString('base64url');

  return `${cuerpo}.${firmar(cuerpo)}`;
}

/** { telefono, nombre } o null si el token es falso o venció. */
export function leerToken(token, ahora = Date.now()) {
  const [cuerpo, firma] = String(token || '').split('.');
  if (!cuerpo || !firma) return null;

  const a = Buffer.from(firma);
  const b = Buffer.from(firmar(cuerpo));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
    if (!datos?.t || typeof datos.e !== 'number' || ahora > datos.e) return null;
    return { telefono: datos.t, nombre: datos.n || '' };
  } catch {
    return null;
  }
}

// ── El mensaje que abre el formulario ────────────────────────────────────

/** ¿Este cliente usa el formulario? Depende del interruptor del bot. */
export function formularioDisponible() {
  return Boolean(config.FLOW_ID && config.FLOW_PRIVATE_KEY);
}

/** El mensaje interactivo de tipo "flow" que se le manda al cliente. */
export function mensajeFormulario(telefono, nombre, { borrador = false } = {}) {
  return {
    messaging_product: 'whatsapp',
    to: telefono,
    type: 'interactive',
    interactive: {
      type: 'flow',
      body: { text: '💈 Agenda tu turno en un solo paso: elige barbero, fecha y hora.' },
      footer: { text: '¿No se abre? Escribe lista' },
      action: {
        name: 'flow',
        parameters: {
          flow_message_version: '3',
          flow_token: crearToken(telefono, nombre),
          flow_id: config.FLOW_ID,
          flow_cta: 'Agendar turno',
          flow_action: 'data_exchange',
          // Mientras el formulario no esté publicado, solo se puede abrir
          // en modo borrador. Sirve para probarlo con Prueba.
          ...(borrador ? { mode: 'draft' } : {}),
        },
      },
    },
  };
}

// ── Las pantallas ────────────────────────────────────────────────────────

const pantalla = (screen, data, aviso = '') => ({
  screen,
  data: { ...data, aviso, hay_aviso: Boolean(aviso) },
});

function pantallaDatos(bot, nombre, aviso) {
  return pantalla('DATOS', {
    nombre_inicial: nombre || '',
    barberos: bot.barbers.map(b => ({ id: b, title: nombreVisible(b) })),
  }, aviso);
}

async function pantallaFecha(bot, nombre, barbero, aviso) {
  const fechas = await bot.generateNextAvailableDates(barbero);

  if (!fechas.length) {
    return pantallaDatos(bot, nombre, `😕 ${nombreVisible(barbero)} no tiene días de atención configurados. Elige otro barbero.`);
  }

  return pantalla('FECHA', {
    nombre,
    barbero,
    resumen: `💈 ${nombreVisible(barbero)}`,
    fechas: fechas.map(f => {
      const libres = f.availableCount === 1 ? '1 turno libre' : `${f.availableCount} turnos libres`;
      const festivo = festivoDe(f.value) ? '🇨🇴 Festivo · ' : '';

      return {
        id: f.value,
        title: f.label,
        description: f.hasAvailability ? `${festivo}${libres}` : `${festivo}❌ sin cupos`,
        enabled: f.hasAvailability,
      };
    }),
  }, aviso);
}

async function pantallaHora(bot, nombre, barbero, fecha, aviso) {
  const horas = await getAvailableSlots(barbero, fecha);

  if (!horas.length) {
    return pantallaFecha(bot, nombre, barbero, '😕 Ese día ya no tiene horas libres. Elige otro día.');
  }

  return pantalla('HORA', {
    nombre,
    barbero,
    fecha,
    resumen: `💈 ${nombreVisible(barbero)} · 📅 ${bot.formatDisplayDate(fecha)}`,
    horas: horas.map(h => ({ id: h, title: h })),
  }, aviso);
}

const esFecha = (texto) => /^\d{4}-\d{2}-\d{2}$/.test(String(texto || ''));

/**
 * Guarda el turno con las mismas validaciones del flujo de siempre.
 * Devuelve la pantalla siguiente: LISTO, o HORA con el motivo si no se pudo.
 */
async function reservar(bot, telefono, { nombre, barbero, fecha, hora }) {
  // La hora tiene que seguir existiendo entre las libres de ese día.
  const libres = await getAvailableSlots(barbero, fecha);
  if (!libres.some(h => h.toLowerCase() === String(hora).toLowerCase())) {
    return pantallaHora(bot, nombre, barbero, fecha, '❌ Esa hora ya no está disponible. Elige otra.');
  }

  // 🔒 Máximo 2 turnos por día, salvo los números de los barberos.
  if (!bot.adminPhones.includes(telefono)) {
    const yaTiene = await countUserAppointmentsSameDay(telefono, fecha);
    if (yaTiene >= 2) {
      return pantallaHora(bot, nombre, barbero, fecha, '⚠️ Ya tienes el máximo de 2 turnos para este día. Elige otro día.');
    }
  }

  // Re-verificación con datos frescos, justo antes de guardar.
  if (!(await checkAvailability(barbero, fecha, hora))) {
    return pantallaHora(bot, nombre, barbero, fecha, '❌ Esa hora la acaba de tomar otro cliente. Elige otra.');
  }

  // Igual que el flujo de listas: se arma el estado y se guarda con
  // completeAppointment (fila en la hoja, columna K, aviso al barbero).
  bot.appointmentState[telefono] = {
    name: nombre,
    barber: barbero,
    date: fecha,
    displayDate: bot.formatDisplayDate(fecha),
    time: hora,
    lastActivity: Date.now(),
  };

  const confirmacion = await bot.completeAppointment(telefono);

  // La confirmación de siempre también por el chat: queda como constancia.
  // Sin esperar: el formulario no puede quedarse colgado por esto.
  whatsappService.sendMessage(telefono, confirmacion)
    .catch(error => console.error('Formulario: no se pudo mandar la confirmación:', error?.message));

  return pantalla('LISTO', {
    resumen: `👤 ${nombre}\n💈 ${nombreVisible(barbero)}\n📅 ${bot.formatDisplayDate(fecha)}\n⏰ ${hora}`,
  });
}

/**
 * Responde un pedido ya descifrado. Devuelve el objeto a cifrar, o
 * { estado: 427 } si el pase venció (Meta le dice al cliente que reinicie).
 */
export async function responderFormulario(pedido, bot) {
  if (pedido?.action === 'ping') return { data: { status: 'active' } };

  // Meta avisa errores del lado del cliente: solo hay que acusar recibo.
  if (pedido?.data?.error) {
    console.error('Formulario: Meta reporta un error:', pedido.data.error, pedido.data.error_message || '');
    return { data: { acknowledged: true } };
  }

  const quien = leerToken(pedido?.flow_token);
  if (!quien) return { estado: 427 };

  const datos = pedido.data || {};
  const nombre = String(datos.nombre || quien.nombre || '').trim().slice(0, 60);
  const barbero = bot.barbers.find(b => b === datos.barbero);

  try {
    if (pedido.action === 'INIT' || pedido.action === 'BACK') {
      return pantallaDatos(bot, quien.nombre);
    }

    if (pedido.screen === 'DATOS') {
      if (nombre.length < 2) return pantallaDatos(bot, nombre, '✍️ Escribe tu nombre para continuar.');
      if (!barbero) return pantallaDatos(bot, nombre, '✂️ Elige un barbero.');
      return pantallaFecha(bot, nombre, barbero);
    }

    if (!barbero) return pantallaDatos(bot, nombre, '✂️ Elige un barbero.');

    if (pedido.screen === 'FECHA') {
      if (!esFecha(datos.fecha)) return pantallaFecha(bot, nombre, barbero, '📅 Elige una fecha.');
      return pantallaHora(bot, nombre, barbero, datos.fecha);
    }

    if (pedido.screen === 'HORA') {
      if (!esFecha(datos.fecha)) return pantallaFecha(bot, nombre, barbero, '📅 Elige una fecha.');
      if (!datos.hora) return pantallaHora(bot, nombre, barbero, datos.fecha, '⏰ Elige una hora.');
      return reservar(bot, quien.telefono, { nombre, barbero, fecha: datos.fecha, hora: String(datos.hora) });
    }

    return pantallaDatos(bot, quien.nombre);
  } catch (error) {
    if (!(error instanceof SheetsUnavailableError)) throw error;

    console.error('Formulario:', error.message);
    return pantallaDatos(bot, nombre, '⚠️ No puedo consultar la agenda en este momento. Intenta en un minuto 🙏');
  }
}
