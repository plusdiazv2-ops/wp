import whatsappService from './whatsappService.js';
import {
  getAppointmentsToRemind,
  markReminderAsSent
} from './googleSheetsService.js';

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
          await whatsappService.sendTemplate(
            appointment.phone,
            'recordatorio_turno',
            [
              appointment.name,
              appointment.barber,
              appointment.displayDate,
              appointment.time
            ]
          );

          await markReminderAsSent(appointment.rowNumber);

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