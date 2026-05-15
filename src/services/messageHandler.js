import whatsappService from './whatsappService.js';
import appendToSheet, {
  checkAvailability,
  getAvailableSlots,
  getUpcomingAppointmentsByPhone,
  updateAppointmentStatus,
  countUserAppointmentsSameDay,
  getAppointmentsByBarberAndDate,
  getDailyScheduleByBarber,
} from './googleSheetsService.js';
import geminiAiService from './geminiAiService.js';

class MessageHandler {
  constructor() {
    this.appointmentState = {};
    this.assistantState = {};
    this.cancelState = {};
    this.barberAdminState = {};
    this.barbers = ["Bolon", "Julian", "Diaz (Prueba)"];
    this.barberAdmins = {
      "573137127100": {
        name: "Diaz",
        barber: "bolon",
        password: "#diaz001#"
      },

      "573146926477": {
        name: "Bolon",
        barber: "bolon",
        password: "#bolon001#"
      },

      "573002730493": {
        name: "Julian",
        barber: "julian",
        password: "#julian001#"
      },

      "573137127100": {
        name: "Diaz",
        barber: "diaz (prueba)",
        password: "#demo001#"
      },

    };
    this.errorCount = {};
    this.barberPhones = {
      Bolon: "573146926477",
      Julian: "573002730493",
      "Diaz (Prueba)": "573137127100"
    };
    this.adminPhones = [
      "573146926477",
      "573125911132",
      "573137127100"
    ];
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
    delete this.barberAdminState[to];
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

  isBackInput(input) {
    const cleanInput = this.normalizeText(input);
    return cleanInput === 'volver' || cleanInput === 'atras';
  }

  isMenuInput(input) {
    const cleanInput = this.normalizeText(input);
    return cleanInput === 'menu' || cleanInput === 'menú';
  }

  isCancelInput(input) {
    const cleanInput = this.normalizeText(input);
    return cleanInput === 'cancelar' || cleanInput === 'salir';
  }

  async sendMainMenu(to) {
    await this.sendWelcomeMenu(to);
  }

  async handleGlobalNavigation(to, messageText) {
    const cleanInput = this.normalizeText(messageText);
    const hasActiveFlow = this.appointmentState[to] || this.cancelState[to] || this.assistantState[to];

    if (!hasActiveFlow) return false;

    // 🏠 Menú principal: funciona en cualquier flujo activo.
    if (this.isMenuInput(cleanInput)) {
      this.clearAllStates(to);
      await this.sendMainMenu(to);
      return true;
    }

    // ❌ Cancelar/salir: abandona cualquier flujo activo sin afectar turnos guardados.
    if (this.isCancelInput(cleanInput)) {
      this.clearAllStates(to);
      await whatsappService.sendMessage(
        to,
        '✅ Proceso cancelado. Escribe *menu* para ver las opciones disponibles.'
      );
      return true;
    }

    // 🔙 Volver escrito: funciona en cualquier flujo activo donde tenga sentido.
    if (this.isBackInput(cleanInput)) {
      return await this.handleBack(to);
    }

    return false;
  }

  async handleBack(to) {
    // 🔙 Flujo de agendamiento
    if (this.appointmentState[to]) {
      const state = this.appointmentState[to];

      if (state.step === 'barber') {
        state.step = 'name';
        this.resetError(to);
        await whatsappService.sendMessage(
          to,
          `👤 Escribe nuevamente tu nombre:\n\n(Ejemplo: Juan Pérez)\n\n5️⃣ Menú principal`
        );
        return true;
      }

      if (state.step === 'date') {
        state.step = 'barber';
        delete state.barber;
        delete state.availableDates;
        this.resetError(to);
        await this.sendBarberOptions(to);
        return true;
      }

      if (state.step === 'time') {
        state.step = 'date';
        delete state.date;
        delete state.displayDate;
        delete state.availableSlots;
        this.resetError(to);
        await this.sendDateOptions(to, state);
        return true;
      }

      return false;
    }

    // 🔙 Flujo de cancelación
    if (this.cancelState[to]) {
      const state = this.cancelState[to];

      if (state.step === 'confirm_cancel') {
        state.step = 'select_cancel';
        delete state.selectedAppointment;
        this.resetError(to);
        await this.sendCancelAppointmentList(to, state.appointments);
        return true;
      }

      if (state.step === 'select_cancel') {
        delete this.cancelState[to];
        this.resetError(to);
        await this.sendMainMenu(to);
        return true;
      }

      return false;
    }

    // 🔙 Asistente IA
    if (this.assistantState[to]) {
      delete this.assistantState[to];
      this.resetError(to);
      await this.sendMainMenu(to);
      return true;
    }

    return false;
  }

  getNavigationNumber(input, optionsCount) {
    const cleanInput = this.normalizeText(input);
    const selectedNumber = parseInt(cleanInput, 10);

    if (!Number.isInteger(selectedNumber)) {
      return null;
    }

    return {
      value: selectedNumber,
      isBack: selectedNumber === optionsCount + 1,
      isMenu: selectedNumber === optionsCount + 2,
    };
  }

  async handleNavigationNumber(to, input, optionsCount) {
    const nav = this.getNavigationNumber(input, optionsCount);

    if (!nav) return false;

    if (nav.isBack) {
      return await this.handleBack(to);
    }

    if (nav.isMenu) {
      this.clearAllStates(to);
      await this.sendMainMenu(to);
      return true;
    }

    return false;
  }

  buildNavigationFooter(optionsCount, showBack = true, showMenu = true) {
    let footer = '';

    if (showBack) {
      footer += `\n${optionsCount + 1}️⃣ Volver`;
    }

    if (showMenu) {
      footer += `\n${optionsCount + 2}️⃣ Menú principal`;
    }

    footer += `\n\nTambién puedes escribir *volver* o *menu*.`;

    return footer;
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

      const admin = this.barberAdmins[to];

      if (admin && message.text.body.trim() === admin.password) {
        this.clearAllStates(to);

        this.barberAdminState[to] = {
          barber: admin.barber,
          name: admin.name,
          lastActivity: Date.now()
        };

        await whatsappService.sendMessage(
          to,
          `💈 Bienvenido ${admin.name}`
        );

        await this.sendBarberAdminMenu(to, admin.name);
        return;
      }

      const activeState =
        this.appointmentState[to] ||
        this.cancelState[to] ||
        this.assistantState[to] ||
        this.barberAdminState[to];

      if (activeState && this.isSessionExpired(activeState)) {
        this.clearAllStates(to);

        await whatsappService.sendMessage(
          to,
          "⏰ Tu sesión expiró por inactividad.\n\nEscribe *menu* para comenzar de nuevo."
        );

        await whatsappService.markAsRead(message.id);
        return;
      }

      const navigationHandled = await this.handleGlobalNavigation(to, message.text.body);
      if (navigationHandled) {
        await whatsappService.markAsRead(message.id);
        return;
      }

      if (this.barberAdminState[to]) {
        this.barberAdminState[to].lastActivity = Date.now();
        await this.handleBarberAdminFlow(to, message.text.body);

      } else if (this.appointmentState[to]) {
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
        this.assistantState[to] ||
        this.barberAdminState[to];

      if (activeState && this.isSessionExpired(activeState)) {
        this.clearAllStates(to);

        await whatsappService.sendMessage(
          to,
          "⏰ Tu sesión expiró por inactividad.\n\nEscribe *menu* para comenzar de nuevo."
        );

        await whatsappService.markAsRead(message.id);
        return;
      }

      if (this.barberAdminState[to]) {
        this.barberAdminState[to].lastActivity = Date.now();
        await this.handleBarberAdminFlow(to, option);

      } else if (this.cancelState[to]) {
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
        response = `👤 Para comenzar, escribe tu nombre:\n\n(Ejemplo: Juan Pérez)\n\n5️⃣ Menú principal`;
        await whatsappService.sendMessage(to, response);
        break;

      case '2':
      case 'cancelar turno': {
        this.resetError(to);

        const appointments = await getUpcomingAppointmentsByPhone(to);

        if (!appointments || appointments.length === 0) {
          await whatsappService.sendMessage(
            to,
            'No tienes ningún turno pendiente para cancelar.'
          );
          return;
        }

        this.cancelState[to] = {
          step: 'select_cancel',
          appointments,
          lastActivity: Date.now()
        };

        await this.sendCancelAppointmentList(to, appointments);
        return;
      }

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
      case 'name': {
        const cleanInput = message.trim();

        if (this.isMenuInput(cleanInput) || cleanInput === '5') {
          this.clearAllStates(to);
          await this.sendMainMenu(to);
          return;
        }

        if (!cleanInput) {
          await whatsappService.sendMessage(
            to,
            '❌ Escribe tu nombre para continuar.\n\n5️⃣ Menú principal'
          );
          return;
        }

        state.name = cleanInput;
        state.step = 'barber';
        this.resetError(to);

        await this.sendBarberOptions(to);
        return;
      }

      case 'barber': {
        const cleanInput = message.trim();

        const navHandled = await this.handleNavigationNumber(to, cleanInput, this.barbers.length);
        if (navHandled) return;

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
            `❌ Respuesta inválida. Escribe solo el número del barbero.\nEjemplo: 1${this.buildNavigationFooter(this.barbers.length)}`
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
            `❌ Opción inválida. Escribe solo el número de un barbero de la lista.${this.buildNavigationFooter(this.barbers.length)}`
          );
          return;
        }

        this.resetError(to);
        state.barber = this.barbers[selectedBarberIndex];
        state.step = 'date';

        await this.sendDateOptions(to, state);
        return;
      }

      case 'date': {
        const cleanInput = message.trim();
        const optionsCount = state.availableDates?.length || 0;

        const navHandled = await this.handleNavigationNumber(to, cleanInput, optionsCount);
        if (navHandled) return;

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
            `❌ Respuesta inválida. Escribe solo el número de la fecha que deseas.\nEjemplo: 1${this.buildNavigationFooter(optionsCount)}`
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
            `❌ Opción inválida. Responde solo con el número de una fecha de la lista.${this.buildNavigationFooter(optionsCount)}`
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
            `❌ ${selectedDate.label} no tiene turnos disponibles. Elige otra fecha.${this.buildNavigationFooter(optionsCount)}`
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
            `❌ No hay horarios disponibles para ${state.displayDate}.${this.buildNavigationFooter(optionsCount)}`
          );
          return;
        }

        state.availableSlots = availableSlots;
        state.step = 'time';

        await this.sendTimeOptions(to, state);
        return;
      }

      case 'time': {
        const cleanInput = message.trim();
        const optionsCount = state.availableSlots?.length || 0;

        const navHandled = await this.handleNavigationNumber(to, cleanInput, optionsCount);
        if (navHandled) return;

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
            `❌ Respuesta inválida. Escribe solo el número de la hora que deseas.\nEjemplo: 2${this.buildNavigationFooter(optionsCount)}`
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
            `❌ Opción inválida. Escribe solo el número de una hora de la lista.${this.buildNavigationFooter(optionsCount)}`
          );
          return;
        }

        const finalTime = state.availableSlots[selectedTimeIndex];

        // 🔒 VALIDACIÓN: máximo 2 turnos por día
        const appointmentsCount = await countUserAppointmentsSameDay(to, state.date);

        const isAdmin = this.adminPhones.includes(to);
        if (!isAdmin) {
          if (appointmentsCount >= 2) {
            await whatsappService.sendMessage(
              to,
              `⚠️ Ya tienes el máximo de 2 turnos permitidos para este día.${this.buildNavigationFooter(optionsCount)}`
            );
            return;
          }
        }

        const isAvailable = await checkAvailability(state.barber, state.date, finalTime);

        if (!isAvailable) {
          await whatsappService.sendMessage(
            to,
            `❌ Ese horario ya fue tomado por otro cliente. Elige otra opción.${this.buildNavigationFooter(optionsCount)}`
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

    if (state.step === 'select_cancel') {
      const optionsCount = state.appointments?.length || 0;

      const navHandled = await this.handleNavigationNumber(to, cleanInput, optionsCount);
      if (navHandled) return;

      if (!/^\d+$/.test(cleanInput)) {
        await whatsappService.sendMessage(
          to,
          `❌ Respuesta inválida. Responde solo con el número del turno.${this.buildNavigationFooter(optionsCount)}`
        );
        return;
      }

      const index = parseInt(cleanInput, 10) - 1;

      if (index < 0 || index >= state.appointments.length) {
        await whatsappService.sendMessage(
          to,
          `❌ Número fuera de rango. Intenta nuevamente.${this.buildNavigationFooter(optionsCount)}`
        );
        return;
      }

      state.selectedAppointment = state.appointments[index];
      state.step = 'confirm_cancel';

      await this.sendCancelConfirmation(to, state.selectedAppointment);
      return;
    }

    if (state.step === 'confirm_cancel') {
      const navHandled = await this.handleNavigationNumber(to, cleanInput, 2);
      if (navHandled) return;

      if (cleanInput === '1') {
        const appt = state.selectedAppointment;

        const result = await updateAppointmentStatus(
          appt.rowNumber,
          'Cancelado'
        );

        delete this.cancelState[to];
        this.resetError(to);

        if (!result) {
          await whatsappService.sendMessage(
            to,
            '❌ No pude cancelar el turno. Intenta de nuevo.'
          );
          return;
        }

        await whatsappService.sendMessage(
          to,
          `✅ Turno cancelado:\n\n` +
          `💈 ${appt.barber}\n` +
          `📅 ${appt.displayDate}\n` +
          `⏰ ${appt.time}`
        );

        return;
      }

      if (cleanInput === '2') {
        delete this.cancelState[to];
        this.resetError(to);

        await whatsappService.sendMessage(
          to,
          'Perfecto, tu turno sigue activo.'
        );
        return;
      }

      await whatsappService.sendMessage(
        to,
        `❌ Respuesta inválida.\n1️⃣ Sí\n2️⃣ No${this.buildNavigationFooter(2)}`
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

    message += this.buildNavigationFooter(this.barbers.length);

    await whatsappService.sendMessage(to, message);
  }

  async sendDateOptions(to, state) {
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

    dateMessage += this.buildNavigationFooter(nextDates.length);

    await whatsappService.sendMessage(to, dateMessage);
  }

  async sendTimeOptions(to, state) {
    let text = `⏰ Horarios disponibles con *${state.barber}* para *${state.displayDate}*:\n\n`;

    state.availableSlots.forEach((slot, index) => {
      text += `${index + 1}️⃣ ${slot}\n`;
    });

    text += this.buildNavigationFooter(state.availableSlots.length);

    await whatsappService.sendMessage(to, text);
  }

  async sendCancelAppointmentList(to, appointments) {
    let message = `📋 *Estos son tus turnos próximos:*\n\n`;

    appointments.forEach((appointment, index) => {
      message += `${index + 1}️⃣ *${appointment.displayDate}* - ${appointment.time}\n`;
      message += `💈 Barbero: ${appointment.barber}\n\n`;
    });

    message += `✍️ Responde con el número del turno que deseas cancelar.`;
    message += this.buildNavigationFooter(appointments.length);

    await whatsappService.sendMessage(to, message);
  }

  async sendCancelConfirmation(to, appointment) {
    await whatsappService.sendMessage(
      to,
      `📋 *Confirma la cancelación:*\n\n` +
      `👤 ${appointment.name}\n` +
      `💈 ${appointment.barber}\n` +
      `📅 ${appointment.displayDate}\n` +
      `⏰ ${appointment.time}\n\n` +
      `1️⃣ Sí cancelar\n` +
      `2️⃣ No` +
      this.buildNavigationFooter(2)
    );
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

    if (!barberPhone) {
      console.log(`❌ No hay número configurado para el barbero ${appointment.barber}`);
      return;
    }

    try {
      console.log("📤 Enviando template nuevo_turno_barbero al barbero:", barberPhone);

      await whatsappService.sendTemplate(
        barberPhone,
        "nuevo_turno_barbero",
        [
          appointment.name || "Cliente",                         // {{1}} Cliente
          appointment.barber || "Barbero",                       // {{2}} Barbero
          appointment.displayDate || appointment.date || "Fecha", // {{3}} Fecha
          appointment.time || "Hora",                            // {{4}} Hora
          appointment.phone || "Teléfono"                        // {{5}} Teléfono
        ]
      );

      console.log("✅ Template nuevo_turno_barbero enviado correctamente");
    } catch (error) {
      console.error("❌ Error enviando template nuevo_turno_barbero");

      if (error.response) {
        console.error("📛 Status:", error.response.status);
        console.error("📛 Data:", JSON.stringify(error.response.data, null, 2));
      } else {
        console.error("📛 Error:", error.message);
      }
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

  async handleBarberAdminFlow(to, option) {
    const admin = this.barberAdminState[to];

    if (!admin) {
      await whatsappService.sendMessage(to, "No tienes una sesión activa de barbero.");
      return;
    }

    const rawOption = option.trim();
    const normalizedOption = this.normalizeText(rawOption);

    if (admin.waitingForDate) {
      const date = this.parseAdminDate(rawOption);

      if (!date) {
        await whatsappService.sendMessage(
          to,
          "❌ Fecha no válida.\n\nEscríbela así:\n16/05/2026"
        );
        return;
      }

      admin.waitingForDate = false;

      const schedule = await getDailyScheduleByBarber(admin.barber, date);

      await whatsappService.sendMessage(
        to,
        this.formatDailySchedule(schedule, admin.name, rawOption)
      );

      await this.sendBarberAdminMenu(to, admin.name);
      return;
    }

    if (normalizedOption === "1" || normalizedOption === "hoy") {
      const today = this.getBogotaDate(0);
      const schedule = await getDailyScheduleByBarber(admin.barber, today);

      await whatsappService.sendMessage(
        to,
        this.formatDailySchedule(schedule, admin.name, "hoy")
      );

      await this.sendBarberAdminMenu(to, admin.name);
      return;
    }

    if (normalizedOption === "2" || normalizedOption === "manana" || normalizedOption === "mañana") {
      const tomorrow = this.getBogotaDate(1);
      const schedule = await getDailyScheduleByBarber(admin.barber, tomorrow);

      await whatsappService.sendMessage(
        to,
        this.formatDailySchedule(schedule, admin.name, "mañana")
      );

      await this.sendBarberAdminMenu(to, admin.name);
      return;
    }

    if (normalizedOption === "3") {
      admin.waitingForDate = true;

      await whatsappService.sendMessage(
        to,
        "📅 Escribe la fecha que quieres consultar.\n\nFormato:\nDD/MM/AAAA\n\nEjemplo:\n16/05/2026"
      );

      return;
    }

    if (normalizedOption === "4" || normalizedOption === "salir") {
      delete this.barberAdminState[to];

      await whatsappService.sendMessage(
        to,
        "✅ Has salido del panel barbero."
      );

      return;
    }

    await whatsappService.sendMessage(
      to,
      "Opción no válida. Elige una opción del panel."
    );

    await this.sendBarberAdminMenu(to, admin.name);
  }

  getBogotaDate(daysToAdd = 0) {
    const now = new Date(
      new Date().toLocaleString("en-US", { timeZone: "America/Bogota" })
    );

    now.setDate(now.getDate() + daysToAdd);

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  formatAppointmentsList(appointments, barberName, label) {
    if (!appointments.length) {
      return `💈 ${barberName}, no tienes turnos ${label}.`;
    }

    let message = `💈 Turnos de ${barberName} ${label}:\n\n`;

    appointments.forEach((appointment, index) => {
      message += `${index + 1}. ${appointment.time} - ${appointment.name}\n`;
      message += `📱 ${appointment.phone}\n\n`;
    });

    return message.trim();
  }

  async sendBarberAdminMenu(to, barberName) {
    await whatsappService.sendMessage(
      to,
      `💈 Panel ${barberName}

  1. Ver agenda de hoy
  2. Ver agenda de mañana
  3. Buscar agenda por fecha
  4. Salir`
    );
  }

  parseAdminDate(value) {
    const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

    if (!match) return null;

    const day = String(match[1]).padStart(2, '0');
    const month = String(match[2]).padStart(2, '0');
    const year = match[3];

    return `${year}-${month}-${day}`;
  }

  formatDailySchedule(schedule, barberName, label) {
    if (!schedule.length) {
      return `💈 Agenda ${barberName} - ${label}\n\nNo hay horarios configurados para este día.`;
    }

    let message = `💈 Agenda ${barberName} - ${label}\n\n`;

    schedule.forEach(item => {
      if (item.status === 'ocupado') {
        message += `🔴 ${item.time} - ${item.name}\n`;
        message += `📱 ${item.phone}\n\n`;
      } else {
        message += `🟢 ${item.time} - Libre\n`;
      }
    });

    return message.trim();
  }
}



export default new MessageHandler();
