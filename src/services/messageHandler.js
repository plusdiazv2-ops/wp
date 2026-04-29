import whatsappService from './whatsappService.js';
import appendToSheet, {
  checkAvailability,
  getAvailableSlots,
  getUpcomingAppointmentByPhone,
  updateAppointmentStatus,
  countUserAppointmentsSameDay,
} from './googleSheetsService.js';
import geminiAiService from './geminiAiService.js';

class MessageHandler {
  constructor() {
    this.appointmentState = {};
    this.assistantState = {};
    this.cancelState = {};
    this.barbers = ["Bolon", "Julian"];
    this.errorCount = {};
    this.barberPhones = {
      Bolon: "573146926477",
      Julian: "573125911132"
    };
  }

  normalizeText(text) {
    return (text || '')
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }

  isSessionExpired(state) {
    const TEN_MINUTES = 10 * 60 * 1000;
    return Date.now() - state.lastActivity > TEN_MINUTES;
  }

  clearAllStates(to) {
    delete this.appointmentState[to];
    delete this.cancelState[to];
    delete this.assistantState[to];
    this.resetError(to);
  }

  incrementError(to) {
    if (!this.errorCount[to]) this.errorCount[to] = 0;
    this.errorCount[to]++;

    if (this.errorCount[to] >= 3) {
      this.errorCount[to] = 0;
      return true;
    }

    return false;
  }

  resetError(to) {
    this.errorCount[to] = 0;
  }

  async handleIncomingMessage(message, senderInfo) {
    if (message?.type === 'text') {
      const incomingMessage = this.normalizeText(message.text.body);
      const to = message.from;

      if (incomingMessage === 'menu') {
        this.clearAllStates(to);
        await this.sendWelcomeMessage(to, message.id, senderInfo);
        await this.sendWelcomeMenu(to);
        await whatsappService.markAsRead(message.id);
        return;
      }

      const activeState =
        this.appointmentState[to] ||
        this.cancelState[to] ||
        this.assistantState[to];

      if (activeState && this.isSessionExpired(activeState)) {
        this.clearAllStates(to);

        await whatsappService.sendMessage(
          to,
          "⏰ Tu sesión expiró por inactividad.\n\nEscribe *menu* para comenzar de nuevo."
        );

        await whatsappService.markAsRead(message.id);
        return;
      }

      if (this.appointmentState[to]) {
        this.appointmentState[to].lastActivity = Date.now();
        await this.handleAppointmentFlow(to, message.text.body);

      } else if (this.cancelState[to]) {
        this.cancelState[to].lastActivity = Date.now();
        await this.handleCancelFlow(to, message.text.body);

      } else if (this.assistantState[to]) {
        this.assistantState[to].lastActivity = Date.now();
        await this.handleAssistantFlow(to, message.text.body, message.id);

      } else {
        const directOptions = [
          'agendar turno',
          'cancelar turno',
          'ubicacion',
          'ubicacion y contacto',
          'hablar con barberia'
        ];

        if (directOptions.includes(incomingMessage)) {
          await this.handleMenuOption(to, incomingMessage);
        } else {
          await this.sendWelcomeMessage(to, message.id, senderInfo);
          await this.sendWelcomeMenu(to);
        }
      }

      await whatsappService.markAsRead(message.id);

    } else if (message?.type === 'interactive') {
      const to = message.from;
      const option = message?.interactive?.button_reply?.id;

      const activeState =
        this.appointmentState[to] ||
        this.cancelState[to] ||
        this.assistantState[to];

      if (activeState && this.isSessionExpired(activeState)) {
        this.clearAllStates(to);

        await whatsappService.sendMessage(
          to,
          "⏰ Tu sesión expiró por inactividad.\n\nEscribe *menu* para comenzar de nuevo."
        );

        await whatsappService.markAsRead(message.id);
        return;
      }

      if (this.cancelState[to]) {
        this.cancelState[to].lastActivity = Date.now();
        await this.handleCancelFlow(to, option);

      } else if (this.assistantState[to]) {
        this.assistantState[to].lastActivity = Date.now();
        await this.handleAssistantFlow(to, option, message.id);

      } else {
        await this.handleMenuOption(to, option);
      }

      await whatsappService.markAsRead(message.id);
    }
  }

  getSenderName(senderInfo) {
    const fullName = senderInfo?.profile?.name || senderInfo?.wa_id || "Cliente";
    return fullName.split(' ')[0];
  }

  async sendWelcomeMessage(to, messageId, senderInfo) {
    const name = this.getSenderName(senderInfo);
    const welcomeMessage = `👋 Hola ${name}, bienvenido a *Exclusive Barber* 💈

    Estoy aquí para ayudarte a agendar tu turno de forma rápida y sencilla ✂️`;
    
    await whatsappService.sendMessage(to, welcomeMessage, messageId);
  }

  async sendWelcomeMenu(to) {
    const menuMessage = "Elige una opción";
    const buttons = [
      { type: 'reply', reply: { id: '1', title: '📅 Agendar turno' } },
      { type: 'reply', reply: { id: '2', title: '❌ Cancelar turno' } },
      { type: 'reply', reply: { id: '3', title: '📍 Ubicación' } },
    ];

    await whatsappService.sendInteractiveButtons(to, menuMessage, buttons);
  }

  async handleMenuOption(to, option) {
    let response;

    switch (option) {
      case '1':
      case 'agendar turno':
        this.resetError(to);
        this.appointmentState[to] = {
          step: 'name',
          lastActivity: Date.now()
        };
        response = `👤 Para comenzar, escribe tu nombre:

  (Ejemplo: Juan Pérez)`;
        await whatsappService.sendMessage(to, response);
        break;

      case '2':
      case 'cancelar turno': {
        this.resetError(to);

        const appointment = await getUpcomingAppointmentByPhone(to);

        if (!appointment) {
          await whatsappService.sendMessage(
            to,
            'No tienes ningún turno confirmado pendiente para cancelar.'
          );
          return;
        }

        this.cancelState[to] = {
          step: 'confirm_cancel',
          appointment,
          lastActivity: Date.now()
        };

        const message = `📋 Esta es tu próxima cita:

  👤 *Cliente:* ${appointment.name}
  💈 *Barbero:* ${appointment.barber}
  📅 *Fecha:* ${appointment.displayDate}
  ⏰ *Hora:* ${appointment.time}

  ¿Deseas cancelarla?

  1️⃣ Sí, cancelar
  2️⃣ No`;

        await whatsappService.sendMessage(to, message);
        return;
      }

      case '4':
      case 'hablar con barberia':
        this.resetError(to);
        this.assistantState[to] = {
          step: 'question',
          lastActivity: Date.now()
        };
        response = '🤖 Soy BarberIA. Pregunta lo que quieras sobre horarios, servicios o turnos.';
        await whatsappService.sendMessage(to, response);
        break;

      case '3':
      case 'ubicacion y contacto':
      case 'ubicacion':
        this.resetError(to);
        await this.sendLocationAndContact(to);
        break;

      default:
        response = 'No entendí tu opción. Escribe *menu* para ver las opciones disponibles.';
        await whatsappService.sendMessage(to, response);
        break;
    }
  }

  generateAvailableSlots() {
    const slots = [];

    for (let hour = 8; hour < 17; hour++) {
      if (hour === 12) continue;

      const format = (h, min) => {
        let period = h >= 12 ? 'pm' : 'am';
        let hour12 = h % 12 || 12;
        return min === '00'
          ? `${hour12}${period}`
          : `${hour12}:${min}${period}`;
      };

      slots.push(format(hour, '00'));
      slots.push(format(hour, '30'));
    }

    return slots;
  }

  async completeAppointment(to) {
    const appointment = this.appointmentState[to];
    delete this.appointmentState[to];
    this.resetError(to);

    const appointmentDateTime = this.buildAppointmentDateTime(
      appointment.date,
      appointment.time
    );

    const userData = [
      appointment.date,
      appointment.displayDate,
      appointment.time,
      appointment.name,
      to,
      appointment.barber,
      "Confirmado",
      new Date().toISOString(),
      appointmentDateTime,
      "No"
    ];

    await appendToSheet(userData);
    console.log("Turno guardado. Enviando notificación al barbero...", appointment);

    await this.notifyBarberNewAppointment({
      ...appointment,
      phone: to
    });

    console.log("Notificación al barbero enviada.");

    return `✅ *¡Turno confirmado!*

    👤 *Nombre:* ${appointment.name}
    💈 *Barbero:* ${appointment.barber}
    📅 *Fecha:* ${appointment.displayDate}
    ⏰ *Hora:* ${appointment.time}

    📌 Recuerda llegar 5 minutos antes de tu cita.

    Si necesitas cancelar tu turno:
    👉 Escribe *menu* y selecciona *Cancelar turno*.

    ¡Te esperamos en *Exclusive Barber* 💈🔥`;
  }

  async handleAppointmentFlow(to, message) {
    const state = this.appointmentState[to];
    let response;

    switch (state.step) {
      case 'name':
        state.name = message.trim();
        state.step = 'barber';
        this.resetError(to);

        await this.sendBarberOptions(to);
        return;

      case 'barber': {
        const cleanInput = message.trim();

        if (!/^\d+$/.test(cleanInput)) {
          if (this.incrementError(to)) {
            await whatsappService.sendMessage(
              to,
              "❌ Parece que hay un error.\nEscribe *menu* para empezar de nuevo."
            );
            return;
          }

          await whatsappService.sendMessage(
            to,
            "❌ Respuesta inválida. Escribe solo el número del barbero.\nEjemplo: 1"
          );
          return;
        }

        const selectedBarberIndex = parseInt(cleanInput, 10) - 1;

        if (
          selectedBarberIndex < 0 ||
          selectedBarberIndex >= this.barbers.length
        ) {
          if (this.incrementError(to)) {
            await whatsappService.sendMessage(
              to,
              "❌ Parece que hay un error.\nEscribe *menu* para empezar de nuevo."
            );
            return;
          }

          await whatsappService.sendMessage(
            to,
            "❌ Opción inválida. Escribe solo el número de un barbero de la lista."
          );
          return;
        }

        this.resetError(to);
        state.barber = this.barbers[selectedBarberIndex];
        state.step = 'date';

        const nextDates = await this.generateNextAvailableDates(state.barber);
        state.availableDates = nextDates;

        let dateMessage = `✅ Perfecto, *${state.name}*.\nHas elegido a *${state.barber}* 💈\n\n📅 Selecciona una fecha disponible:\n\n`;

        nextDates.forEach((d, index) => {
          dateMessage += `${index + 1}️⃣ ${d.label}`;
          if (!d.hasAvailability) {
            dateMessage += ` ❌`;
          }
          dateMessage += `\n`;
        });

        dateMessage += `\n✍️ Responde solo con el número de la fecha que deseas.`;

        await whatsappService.sendMessage(to, dateMessage);
        return;
      }

      case 'date': {
        const cleanInput = message.trim();

        if (!/^\d+$/.test(cleanInput)) {
          if (this.incrementError(to)) {
            await whatsappService.sendMessage(
              to,
              "❌ Parece que hay un error.\nEscribe *menu* para empezar de nuevo."
            );
            return;
          }

          await whatsappService.sendMessage(
            to,
            "❌ Respuesta inválida. Escribe solo el número de la fecha que deseas.\nEjemplo: 1"
          );
          return;
        }

        const selectedIndex = parseInt(cleanInput, 10) - 1;

        if (
          !state.availableDates ||
          selectedIndex < 0 ||
          selectedIndex >= state.availableDates.length
        ) {
          if (this.incrementError(to)) {
            await whatsappService.sendMessage(
              to,
              "❌ Parece que hay un error.\nEscribe *menu* para empezar de nuevo."
            );
            return;
          }

          await whatsappService.sendMessage(
            to,
            "❌ Opción inválida. Responde solo con el número de una fecha de la lista."
          );
          return;
        }

        const selectedDate = state.availableDates[selectedIndex];

        if (!selectedDate.hasAvailability) {
          if (this.incrementError(to)) {
            await whatsappService.sendMessage(
              to,
              "❌ Parece que hay un error.\nEscribe *menu* para empezar de nuevo."
            );
            return;
          }

          await whatsappService.sendMessage(
            to,
            `❌ ${selectedDate.label} no tiene turnos disponibles. Elige otra fecha.`
          );
          return;
        }

        this.resetError(to);
        state.date = selectedDate.value;
        state.displayDate = selectedDate.label;

        const availableSlots = await getAvailableSlots(state.barber, state.date);

        if (availableSlots.length === 0) {
          await whatsappService.sendMessage(
            to,
            `❌ No hay horarios disponibles para ${state.displayDate}.`
          );
          return;
        }

        state.availableSlots = availableSlots;
        state.step = 'time';

        let text = `⏰ Horarios disponibles con *${state.barber}* para *${state.displayDate}*:\n\n`;

        availableSlots.forEach((slot, index) => {
          text += `${index + 1}️⃣ ${slot}\n`;
        });

        text += `\n✍️ Responde solo con el número del horario que prefieras.`;

        await whatsappService.sendMessage(to, text);
        return;
      }

      case 'time': {
        const cleanInput = message.trim();

        if (!/^\d+$/.test(cleanInput)) {
          if (this.incrementError(to)) {
            await whatsappService.sendMessage(
              to,
              "❌ Parece que hay un error.\nEscribe *menu* para empezar de nuevo."
            );
            return;
          }

          await whatsappService.sendMessage(
            to,
            "❌ Respuesta inválida. Escribe solo el número de la hora que deseas.\nEjemplo: 2"
          );
          return;
        }

        const selectedTimeIndex = parseInt(cleanInput, 10) - 1;

        if (
          !state.availableSlots ||
          selectedTimeIndex < 0 ||
          selectedTimeIndex >= state.availableSlots.length
        ) {
          if (this.incrementError(to)) {
            await whatsappService.sendMessage(
              to,
              "❌ Parece que hay un error.\nEscribe *menu* para empezar de nuevo."
            );
            return;
          }

          await whatsappService.sendMessage(
            to,
            "❌ Opción inválida. Escribe solo el número de una hora de la lista."
          );
          return;
        }

        const finalTime = state.availableSlots[selectedTimeIndex];

        // 🔒 VALIDACIÓN: máximo 2 turnos por día
        const appointmentsCount = await countUserAppointmentsSameDay(to, state.date);

        if (appointmentsCount >= 2) {
          await whatsappService.sendMessage(
            to,
            "❌ Ya tienes 2 turnos agendados para ese día.\n\nSi necesitas más reservas o presentas algún inconveniente, comunícate directamente con la barbería para ayudarte."
          );

          // 🔁 Reiniciar flujo para evitar que quede colgado
          delete this.appointmentState[to];
          return;
        }

        const isAvailable = await checkAvailability(state.barber, state.date, finalTime);

        if (!isAvailable) {
          await whatsappService.sendMessage(
            to,
            "❌ Ese horario ya fue tomado por otro cliente. Elige otra opción."
          );
          return;
        }

        this.resetError(to);
        state.time = finalTime;

        response = await this.completeAppointment(to);
        break;
      }
    }

    await whatsappService.sendMessage(to, response);
  }

  async handleCancelFlow(to, message) {
    const state = this.cancelState[to];
    const cleanInput = message.trim();

    if (state.step === 'confirm_cancel') {
      if (cleanInput === '1') {
        const result = await updateAppointmentStatus(
          state.appointment.rowNumber,
          'Cancelado'
        );

        delete this.cancelState[to];
        this.resetError(to);

        if (!result) {
          await whatsappService.sendMessage(
            to,
            '❌ No pude cancelar tu turno en este momento. Inténtalo de nuevo.'
          );
          return;
        }

        await whatsappService.sendMessage(
          to,
          `✅ *Tu turno fue cancelado correctamente.*

          💈 *Barbero:* ${state.appointment.barber}
          📅 *Fecha:* ${state.appointment.displayDate}
          ⏰ *Hora:* ${state.appointment.time}

          Si deseas agendar uno nuevo, escribe *menu*.`
        );
        return;
      }

      if (cleanInput === '2') {
        delete this.cancelState[to];
        this.resetError(to);

        await whatsappService.sendMessage(
          to,
          'Perfecto, tu turno sigue confirmado.'
        );
        return;
      }

      if (this.incrementError(to)) {
        await whatsappService.sendMessage(
          to,
          "❌ Parece que hay un error.\nEscribe *menu* para empezar de nuevo."
        );
        return;
      }

      await whatsappService.sendMessage(
        to,
        '❌ Respuesta inválida.\nResponde:\n1. Sí, cancelar\n2. No'
      );
    }
  }

  async handleAssistantFlow(to, message, messageId) {
    const state = this.assistantState[to];

    if (state.step === 'question') {
      const iaResponse = await geminiAiService(message);

      await whatsappService.sendMessage(
        to,
        iaResponse || "No puedo responder eso ahora.",
        messageId
      );

      delete this.assistantState[to];
      this.resetError(to);
    }
  }

  async sendLocation(to) {
    await whatsappService.sendLocationMessage(
      to,
      5.087832111878063,
      -75.48875195270072,
      'Exclusive Barber 💈',
      'Glorieta del Barrio San Sebastián, Manizales, Caldas\n📞 3146926477'
    );
  }

  parseTime(input) {
    const match = input.toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);

    if (!match) return null;

    let hour = parseInt(match[1]);
    const minutes = match[2] ? parseInt(match[2]) : 0;
    const period = match[3];

    if (period === 'pm' && hour !== 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;

    return { hour, minutes };
  }

  formatDisplayDate(dateString) {
    const date = new Date(`${dateString}T00:00:00`);

    const dayNames = [
      'Domingo', 'Lunes', 'Martes', 'Miércoles',
      'Jueves', 'Viernes', 'Sábado'
    ];

    const monthNames = [
      'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
      'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
    ];

    return `${dayNames[date.getDay()]} ${date.getDate()} de ${monthNames[date.getMonth()]}`;
  }

  async generateNextAvailableDates(barber) {
    const dates = [];
    const now = new Date(
      new Date().toLocaleString("en-US", { timeZone: "America/Bogota" })
    );

    let i = 0;
    while (dates.length < 7) {
      const current = new Date(now);
      current.setDate(now.getDate() + i);

      const day = current.getDay();

      if (day !== 0) {
        const year = current.getFullYear();
        const month = String(current.getMonth() + 1).padStart(2, '0');
        const dayOfMonth = String(current.getDate()).padStart(2, '0');
        const isoDate = `${year}-${month}-${dayOfMonth}`;

        const slots = await getAvailableSlots(barber, isoDate);

        dates.push({
          value: isoDate,
          label: this.formatDisplayDate(isoDate),
          hasAvailability: slots.length > 0
        });
      }

      i++;
    }

    return dates;
  }

  async sendBarberOptions(to) {
    let message = "✂️ Elige tu barbero:\n\n";

    this.barbers.forEach((barber, index) => {
      message += `${index + 1}️⃣ ${barber}\n`;
    });

    message += "\n✍️ Responde solo con el número de la opción.\nEjemplo: 1";

    await whatsappService.sendMessage(to, message);
  }

  async sendLocationAndContact(to) {
    await whatsappService.sendLocationMessage(
      to,
      5.087832111878063,
      -75.48875195270072,
      'Exclusive Barber 💈',
      'Glorieta del Barrio San Sebastián, Manizales, Caldas'
    );

    await whatsappService.sendMessage(
      to,
      `📍 Exclusive Barber 💈
  Glorieta del Barrio San Sebastián
  Manizales, Caldas

  📞 Contacto: +57 3146926477

  Si necesitas ayuda con tu turno, puedes escribirnos o llamarnos.`
    );
  }

  async sendReminder(to, name, barber, date, time) {
    await whatsappService.sendMessage(
      to,
      `👋 Hola ${name}

Te recordamos tu turno en *Exclusive Barber* 💈

💈 ${barber}
📅 ${date}
⏰ ${time}

¡Te esperamos!`
    );
  }

  async notifyBarberNewAppointment(appointment) {
    const barberPhone = this.barberPhones[appointment.barber];

    console.log("📢 Preparando notificación al barbero");
    console.log("👤 Barbero:", appointment.barber);
    console.log("📱 Número encontrado:", barberPhone);
    console.log("📋 Appointment:", appointment);

    if (!barberPhone) {
      console.log(`❌ No hay número configurado para el barbero ${appointment.barber}`);
      return;
    }

    const message = `📅 Nuevo turno agendado

  👤 Cliente: ${appointment.name}
  💈 Barbero: ${appointment.barber}
  📅 Fecha: ${appointment.displayDate}
  ⏰ Hora: ${appointment.time}
  📞 Teléfono: ${appointment.phone || ''}`;

    console.log("📤 Enviando mensaje normal al barbero...");
    console.log("📱 Para:", barberPhone);
    console.log("💬 Mensaje:", message);

    try {
      const response = await whatsappService.sendMessage(barberPhone, message);

      console.log("✅ Mensaje normal al barbero enviado correctamente");
      console.log("📦 Respuesta:", response);
    } catch (error) {
      console.error("⚠️ Falló mensaje normal al barbero. Usando TEMPLATE...");

      if (error.response) {
        console.error("📛 Status:", error.response.status);
        console.error("📛 Data:", JSON.stringify(error.response.data, null, 2));
      } else {
        console.error("📛 Error:", error.message);
      }

      const templateResponse = await whatsappService.sendTemplate(
        barberPhone,
        'nuevo_turno_barbero',
        [
          appointment.name,
          appointment.barber,
          appointment.displayDate,
          appointment.time,
          appointment.phone || ''
        ]
      );

      console.log("✅ Template nuevo_turno_barbero enviado al barbero");
      console.log("📦 Respuesta template:", templateResponse);
    }
  }

  buildAppointmentDateTime(date, time) {
    const match = time.toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);

    if (!match) return null;

    let hour = parseInt(match[1], 10);
    const minutes = match[2] ? parseInt(match[2], 10) : 0;
    const period = match[3];

    if (period === 'pm' && hour !== 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;

    const hh = String(hour).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');

    return `${date} ${hh}:${mm}:00`;
  }
}

export default new MessageHandler();