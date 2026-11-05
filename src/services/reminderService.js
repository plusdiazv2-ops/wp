import whatsappService from './whatsappService.js';
import { nombreVisible } from '../config/barbers.js';
import {
  getAppointmentsToRemind,
  markReminderAsSent,
  desmarcarRecordatorio,
} from './googleSheetsService.js';

/**
 * Qué mensaje de Meta corresponde a qué fila, por si Meta lo rechaza.
 *
 * Meta acepta el envío y el bot marca "Sí", pero el rechazo puede llegar
 * segundos después por el webhook. Con esto se sabe qué fila devolver a "No".
 * En memoria y por poco tiempo: el rechazo llega en segundos, no en horas.
 */
const ENVIOS_RECIENTES_MS = 60 * 60 * 1000;
const enviosRecientes = new Map();   // id de Meta → { fila, telefono, momento }

function recordarEnvio(id, fila, telefono, ahora = Date.now()) {
  if (!id) return;

  for (const [clave, envio] of enviosRecientes) {
    if (ahora - envio.momento > ENVIOS_RECIENTES_MS) enviosRecientes.delete(clave);
  }

  enviosRecientes.set(id, { fila, telefono, momento: ahora });
}

/** Para los tests. */
export function olvidarEnvios() {
  enviosRecientes.clear();
}

/**
 * Meta avisó que un mensaje falló. Si era un recordatorio, su fila vuelve a
 * "No". Devuelve la fila que se desmarcó, o null si no era un recordatorio.
 */
export async function recordatorioFallido(estado) {
  if (estado?.status !== 'failed') return null;

  const envio = enviosRecientes.get(estado.id);
  if (!envio) return null;

  enviosRecientes.delete(estado.id);

  const resultado = await desmarcarRecordatorio(envio.fila, envio.telefono);

  if (resultado.ok) {
    console.log(`↩️ Recordatorio rechazado por Meta: fila ${envio.fila} vuelve a "No".`);
  }

  return resultado.ok ? envio.fila : null;
}

class ReminderService {
  async processReminders() {
    try {
      const appointments = await getAppointmentsToRemind();

      if (!appointments.length) {
        console.log('No hay recordatorios pendientes.');
        return;
      }

      for (const appointment of appointments) {
        try {
          const respuesta = await whatsappService.sendTemplate(
            appointment.phone,
            'recordatorio_turno',
            [
              appointment.name,
              // El nombre que ve la gente ("Juli"), no el de la hoja ("Julian").
              nombreVisible(appointment.barber),
              appointment.displayDate,
              appointment.time
            ]
          );

          await markReminderAsSent(appointment.rowNumber);
          recordarEnvio(respuesta?.messages?.[0]?.id, appointment.rowNumber, appointment.phone);

          console.log(
            `Recordatorio enviado a ${appointment.phone} para ${appointment.displayDate} ${appointment.time}`
          );
        } catch (error) {
          console.error(
            `Error enviando recordatorio a ${appointment.phone}:`,
            error
          );
        }
      }
    } catch (error) {
      console.error('Error procesando recordatorios:', error);
    }
  }
}

export default new ReminderService();