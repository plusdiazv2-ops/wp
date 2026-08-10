import whatsappService from './whatsappService.js';
import appendToSheet, {
  checkAvailability,
  getAvailableSlots,
  getUpcomingAppointmentsByPhone,
  updateAppointmentStatus,
  countUserAppointmentsSameDay,
  getAppointmentsByBarberAndDate,
  getDailyScheduleByBarber,
  obtenerAdminsWeb,
  SheetsUnavailableError,
} from './googleSheetsService.js';
import config from '../config/env.js';
import { puedeEntrar, generarCodigo, VIGENCIA_MS } from './accesoPanel.js';
import geminiAiService from './geminiAiService.js';

class MessageHandler {
  constructor() {
    this.appointmentState = {};
    this.assistantState = {};
    this.cancelState = {};
    this.barberAdminState = {};
    this.barbers = ["Bolon", "Julian", "Ladino"];
    this.barberAdmins = {

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

      "573215342867": {
        name: "Ladino",
        barber: "ladino",
        password: "Ladino001"
      },

    };
    this.errorCount = {};
    this.barberPhones = {
      Bolon: "573146926477",
      Julian: "573002730493",
      Ladino: "573215342867"
    };
    this.adminPhones = [
      "573146926477",
      "573002730493",
      "573215342867"
    ];

    // ============================================================
    // 🧪 BARBERO DE PRUEBA — TEMPORAL
    // ============================================================
    // ⚠️ Mientras esto esté en true, los CLIENTES REALES ven "Prueba"
    //    en la lista de barberos y pueden agendarse con él.
    //
    // Para quitarlo: poner false. Desaparece de la lista de barberos,
    // del panel y de los permisos. No hay que tocar nada más.
    //
    // Su horario queda en googleSheetsService.js y no estorba: sin
    // este interruptor nadie puede llegar a él.
    // ============================================================
    this.testBarberEnabled = true;

    if (this.testBarberEnabled) {
      const TEST_PHONE = "573137127100";

      this.barbers.push("Prueba");
      this.barberPhones.Prueba = TEST_PHONE;
      this.adminPhones.push(TEST_PHONE);

      this.barberAdmins[TEST_PHONE] = {
        name: "Prueba",
        barber: "prueba",
        password: "#prueba001#",
        // 👑 Puede abrir el panel de cualquier barbero, no solo el suyo.
        canSeeAll: true
      };
    }
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

      // Antes de esto no había regla para el paso del nombre: handleBack()
      // devolvía false, el mensaje seguía de largo y "volver" terminaba
      // GUARDADO COMO EL NOMBRE DEL CLIENTE. El barbero recibía la
      // notificación de un turno a nombre de "volver".
      //
      // Antes del nombre no hay ningún paso, así que volver es el menú.
      if (state.step === 'name') {
        this.clearAllStates(to);
        await this.sendMainMenu(to);
        return true;
      }

      if (state.step === 'barber') {
        state.step = 'name';
        this.resetError(to);
        await whatsappService.sendMessage(
          to,
          `👤 Escribe nuevamente tu nombre:\n\n(Ejemplo: Juan Pérez)\n\n5️⃣ Menú principal\n\nTambién puedes escribir *menu* o *volver*.`
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

      if (state.step === 'jornada') {
        state.step = 'date';
        delete state.date;
        delete state.displayDate;
        delete state.allSlots;
        delete state.availableSlots;
        delete state.periodSlots;
        this.resetError(to);
        await this.sendDateOptions(to, state);
        return true;
      }

      if (state.step === 'time') {
        // Si se pasó por la pantalla de jornada, volver lleva ahí, no hasta
        // las fechas. Si se la saltó (cabían todos los turnos), no existe.
        if (state.periodSlots) {
          state.step = 'jornada';
          state.availableSlots = state.allSlots;
          this.resetError(to);
          await this.sendPeriodOptions(to, state);
          return true;
        }

        state.step = 'date';
        delete state.date;
        delete state.displayDate;
        delete state.allSlots;
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

  // Los id de las pantallas del flujo llevan prefijo con nombre
  // (barbero_bolon, nav_volver). Los del menú principal son '1','2','3'
  // desde siempre. Así se distingue una respuesta de la pantalla actual
  // de un botón viejo que quedó arriba en el chat.
  isFlowOption(option) {
    return /^(barbero|fecha|jornada|hora|cancelar|confirmar|panel|nav)_/.test(String(option || ''));
  }

  /**
   * Traduce lo que llegó a la opción elegida, venga como toque en una lista
   * o como número escrito. Los dos caminos tienen que funcionar igual.
   *
   * options: [{ value, label }] en el mismo orden en que se mostraron.
   * Devuelve { type: 'option' | 'back' | 'menu' | 'invalid', index }
   */
  resolveChoice(input, options, prefix) {
    const raw = String(input ?? '').trim().toLowerCase();

    if (raw === 'nav_volver') return { type: 'back' };
    if (raw === 'nav_menu') return { type: 'menu' };

    // Tocó una fila de la lista: barbero_bolon, hora_5:00pm, fecha_2026-08-10
    if (raw.startsWith(`${prefix}_`)) {
      const value = raw.slice(prefix.length + 1);
      const index = options.findIndex(
        option => String(option.value).toLowerCase() === value
      );

      return index >= 0 ? { type: 'option', index } : { type: 'invalid' };
    }

    // Respaldo escrito: el número, con la convención de siempre
    // (N+1 = Volver, N+2 = Menú principal).
    if (/^\d+$/.test(raw)) {
      const number = parseInt(raw, 10);

      if (number >= 1 && number <= options.length) {
        return { type: 'option', index: number - 1 };
      }

      if (number === options.length + 1) return { type: 'back' };
      if (number === options.length + 2) return { type: 'menu' };
    }

    return { type: 'invalid' };
  }

  // Topes de WhatsApp para listas interactivas.
  // ⚠️ Pasarse de CUALQUIERA de estos hace que Meta rechace el mensaje entero
  // y el cliente NO RECIBE NADA. No es que se vea feo: no llega, y el bot
  // no se entera. Por eso todo lo que arma una lista pasa por aquí.
  get listLimits() {
    return {
      rows: 10,          // en total, no por sección
      rowTitle: 24,
      rowDescription: 72,
      rowId: 200,
      sectionTitle: 24,
      button: 20,
      header: 60,
      body: 1024,
      footer: 60,
    };
  }

  cutText(text, max) {
    const clean = String(text ?? '').trim();
    if (clean.length <= max) return clean;
    return clean.slice(0, max - 1).trim() + '…';
  }

  /**
   * Arma y envía una lista respetando los topes de WhatsApp.
   *
   * sections: [{ title, rows: [{ id, title, description, optional }] }]
   *
   * Las filas marcadas `optional: true` (la de "Menú principal") son las
   * primeras en sacrificarse si el mensaje se pasa de 10 filas. Se pierde
   * poco: "menu" sigue funcionando como comando escrito.
   */
  async sendOptionList(to, { header, body, buttonText, sections, footer }) {
    const limits = this.listLimits;

    let rows = [];
    (sections || []).forEach((section, sectionIndex) => {
      (section.rows || []).forEach(row => {
        rows.push({ ...row, sectionIndex });
      });
    });

    // 1. Si sobran filas, se sacrifican primero las opcionales.
    if (rows.length > limits.rows) {
      rows = rows.filter(row => !row.optional);
    }

    // 2. Si aún sobran, se recorta. Mostrar de menos es malo; que el cliente
    //    no reciba nada es peor. Queda en los logs de Railway para saberlo.
    if (rows.length > limits.rows) {
      console.error(
        `⚠️ Lista de ${rows.length} filas para ${to}: se recorta a ${limits.rows}. ` +
        `Esta pantalla hay que partirla en dos.`
      );
      rows = rows.slice(0, limits.rows);
    }

    // 3. Si no quedó ninguna fila no se puede enviar una lista, pero el
    //    cliente no se puede quedar sin respuesta.
    if (rows.length === 0) {
      console.error(`⚠️ Lista sin filas para ${to}. Se envía como texto.`);
      await whatsappService.sendMessage(to, body);
      return;
    }

    const finalSections = (sections || [])
      .map((section, sectionIndex) => ({
        title: this.cutText(section.title, limits.sectionTitle),
        rows: rows
          .filter(row => row.sectionIndex === sectionIndex)
          .map(row => {
            const built = {
              id: this.cutText(row.id, limits.rowId),
              title: this.cutText(row.title, limits.rowTitle),
            };

            if (row.description) {
              built.description = this.cutText(row.description, limits.rowDescription);
            }

            return built;
          }),
      }))
      .filter(section => section.rows.length > 0);

    await whatsappService.sendListMessage(
      to,
      this.cutText(body, limits.body),
      this.cutText(buttonText, limits.button),
      finalSections,
      header ? this.cutText(header, limits.header) : undefined,
      footer ? this.cutText(footer, limits.footer) : undefined
    );
  }

  // El emoji de número solo existe para un dígito (1️⃣ … 9️⃣).
  // Del 10 en adelante se arma pegando un emoji por cada cifra: 12 → 1️⃣2️⃣
  numberToEmoji(number) {
    return String(number)
      .split('')
      .map(digit => `${digit}️⃣`)
      .join('');
  }

  buildNavigationFooter(optionsCount, showBack = true, showMenu = true) {
    let footer = '';

    if (showBack) {
      footer += `\n${this.numberToEmoji(optionsCount + 1)} Volver`;
    }

    if (showMenu) {
      footer += `\n${this.numberToEmoji(optionsCount + 2)} Menú principal`;
    }

    footer += `\n\nTambién puedes escribir *volver* o *menu*.`;

    return footer;
  }

  // WhatsApp manda el id de la opción elegida en un campo distinto según de
  // dónde venga: button_reply si el cliente tocó un botón, list_reply si tocó
  // una fila de una lista. Antes solo se leía el primero, así que las listas
  // llegaban y el bot las ignoraba por completo.
  getInteractiveId(message) {
    return (
      message?.interactive?.button_reply?.id ||
      message?.interactive?.list_reply?.id ||
      null
    );
  }

  async handleIncomingMessage(message, senderInfo) {
    try {
      await this.procesarMensaje(message, senderInfo);
    } catch (error) {
      if (!(error instanceof SheetsUnavailableError)) throw error;

      // Google Sheets no respondió. Antes esto le llegaba al cliente
      // disfrazado de "no hay turnos disponibles" y se iba creyendo que
      // la barbería estaba llena. Un solo sitio para decir la verdad.
      console.error('⚠️', error.message);

      const to = message?.from;
      if (!to) return;

      await whatsappService.sendMessage(
        to,
        '⚠️ No puedo consultar la agenda en este momento.\n\nIntenta de nuevo en un minuto 🙏'
      );
    }
  }

  async procesarMensaje(message, senderInfo) {
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
          canSeeAll: admin.canSeeAll === true,
          lastActivity: Date.now()
        };

        await whatsappService.sendMessage(
          to,
          `💈 Bienvenido ${admin.name}`
        );

        // 👑 Quien puede ver todos los paneles escoge primero de cuál barbero.
        if (admin.canSeeAll) {
          await this.sendBarberPicker(to);
        } else {
          await this.sendBarberAdminMenu(to, admin.name);
        }

        return;
      }

      // 🔐 Código para entrar al panel web.
      // Va aquí arriba, al mismo nivel que la contraseña del barbero: es un
      // comando deliberado y debe funcionar aunque el admin esté a mitad de
      // otro flujo.
      if (incomingMessage === 'acceso') {
        await this.handleAccesoPanel(to);
        await whatsappService.markAsRead(message.id);
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
      const option = this.getInteractiveId(message);

      // Sin id no se puede hacer nada, y dejarlo pasar rompía el panel del
      // barbero: handleBarberAdminFlow() hace option.trim() y reventaba.
      if (!option) {
        await whatsappService.sendMessage(
          to,
          'No pude leer esa opción. Escribe *menu* para ver las opciones disponibles.'
        );
        await whatsappService.markAsRead(message.id);
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

      if (this.barberAdminState[to]) {
        this.barberAdminState[to].lastActivity = Date.now();
        await this.handleBarberAdminFlow(to, option);

      } else if (this.appointmentState[to]) {
        // Durante el agendamiento el bot solo manda texto, nunca botones.
        // Entonces un mensaje interactivo aquí SIEMPRE viene de un menú viejo
        // que quedó más arriba en el chat.
        //
        // Antes esto caía en handleMenuOption() y descuadraba el flujo. El caso
        // peor era tocar "Cancelar turno": creaba cancelState mientras
        // appointmentState seguía vivo, y como la rama de texto revisa
        // appointmentState primero, el cliente veía la lista de turnos para
        // cancelar, escribía "1" creyendo que cancelaba, y el bot lo leía como
        // "elegí al barbero 1". Creía haber cancelado sin cancelar nada.
        this.appointmentState[to].lastActivity = Date.now();

        if (this.isFlowOption(option)) {
          // Respuesta real de una pantalla del flujo (lista o botón).
          await this.handleAppointmentFlow(to, option);
        } else {
          // Un id del menú principal ('1','2','3'): viene del historial.
          await whatsappService.sendMessage(
            to,
            '⚠️ Esa opción es de un menú anterior.\n\nSigue donde ibas escribiendo tu respuesta, o escribe *menu* para empezar de nuevo.'
          );
        }

      } else if (this.cancelState[to]) {
        this.cancelState[to].lastActivity = Date.now();

        // Misma protección que en el agendamiento: un id sin prefijo viene de
        // un menú viejo del historial, no de la pantalla actual.
        if (this.isFlowOption(option)) {
          await this.handleCancelFlow(to, option);
        } else {
          await whatsappService.sendMessage(
            to,
            '⚠️ Esa opción es de un menú anterior.\n\nElige un turno de la lista, o escribe *menu* para empezar de nuevo.'
          );
        }

      } else if (this.assistantState[to]) {
        this.assistantState[to].lastActivity = Date.now();
        await this.handleAssistantFlow(to, option, message.id);

      } else {
        await this.handleMenuOption(to, option);
      }

      await whatsappService.markAsRead(message.id);

    } else if (
      message?.from &&
      message?.type &&
      message.type !== 'reaction' &&
      message.type !== 'system'
    ) {
      // Audio, imagen, sticker, ubicación, documento...
      // Antes de esto el bot no respondía absolutamente nada y el cliente
      // quedaba esperando una respuesta que nunca llegaba.
      // Las reacciones y los avisos del sistema se ignoran a propósito:
      // no son una pregunta del cliente.
      const to = message.from;

      const hasActiveFlow =
        this.appointmentState[to] ||
        this.cancelState[to] ||
        this.assistantState[to] ||
        this.barberAdminState[to];

      await whatsappService.sendMessage(
        to,
        hasActiveFlow
          ? '🙏 Por ahora solo puedo leer mensajes de *texto*.\n\nSigue donde ibas escribiendo tu respuesta, o escribe *menu* para empezar de nuevo.'
          : '🙏 Por ahora solo puedo leer mensajes de *texto*.\n\nEscribe *menu* para ver las opciones disponibles.'
      );

      await whatsappService.markAsRead(message.id);
    }
  }

  /**
   * Responde al comando `acceso`: entrega un código para el panel web.
   *
   * A quien no tiene permiso se le responde algo genérico a propósito, para
   * no confirmarle a un desconocido que existe un panel.
   */
  async handleAccesoPanel(to) {
    let adminsExtra = [];

    try {
      adminsExtra = (await obtenerAdminsWeb()).map(admin => admin.telefono);
    } catch (error) {
      // La pestaña de admins es opcional. Si falla, queda el principal.
      console.log('No se pudo leer la lista de admins:', error?.message || error);
    }

    if (!puedeEntrar(to, adminsExtra)) {
      console.log(`🔐 Código de panel negado a ${to}: no está autorizado.`);

      await whatsappService.sendMessage(
        to,
        'No entendí tu mensaje. Escribe *menu* para ver las opciones disponibles.'
      );
      return;
    }

    const codigo = generarCodigo(to);
    const minutos = Math.round(VIGENCIA_MS / 60000);

    console.log(`🔐 Código de panel entregado a ${to}.`);

    await whatsappService.sendMessage(
      to,
      `🔐 *Acceso al panel*

Tu código es:

*${codigo}*

Válido por ${minutos} minutos y de un solo uso.

Entra a:
${config.URL_PUBLICA}/panel

Si no fuiste tú quien lo pidió, ignora este mensaje.`
    );
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
        response = `👤 Para comenzar, escribe tu nombre:\n\n(Ejemplo: Juan Pérez)\n\n5️⃣ Menú principal\n\nTambién puedes escribir *menu* o *volver*.`;
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
            '❌ Escribe tu nombre para continuar.\n\n5️⃣ Menú principal\n\nTambién puedes escribir *menu* o *volver*.'
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
        const choice = this.resolveChoice(message, this.barberOptions(), 'barbero');

        if (choice.type === 'back') {
          await this.handleBack(to);
          return;
        }

        if (choice.type === 'menu') {
          this.clearAllStates(to);
          await this.sendMainMenu(to);
          return;
        }

        if (choice.type !== 'option') {
          if (this.incrementError(to)) {
            await whatsappService.sendMessage(
              to,
              "❌ Parece que hay un error.\nEscribe *menu* para empezar de nuevo."
            );
            return;
          }

          // Se reenvía la lista con el aviso adentro, en vez de mandar dos
          // mensajes: el botón de la lista anterior ya quedó arriba en el chat.
          await this.sendBarberOptions(
            to,
            '❌ No entendí esa opción.\n\n✂️ Elige tu barbero'
          );
          return;
        }

        this.resetError(to);
        state.barber = this.barbers[choice.index];
        state.step = 'date';

        await this.sendDateOptions(to, state);
        return;
      }

      case 'date': {
        const dates = state.availableDates || [];
        const choice = this.resolveChoice(message, dates, 'fecha');

        if (choice.type === 'back') {
          await this.handleBack(to);
          return;
        }

        if (choice.type === 'menu') {
          this.clearAllStates(to);
          await this.sendMainMenu(to);
          return;
        }

        if (choice.type !== 'option') {
          if (this.incrementError(to)) {
            await whatsappService.sendMessage(
              to,
              "❌ Parece que hay un error.\nEscribe *menu* para empezar de nuevo."
            );
            return;
          }

          await this.sendDateOptions(
            to,
            state,
            '❌ No entendí esa opción.\n\n📅 Selecciona una fecha de la lista:'
          );
          return;
        }

        const selectedDate = dates[choice.index];

        if (!selectedDate.hasAvailability) {
          if (this.incrementError(to)) {
            await whatsappService.sendMessage(
              to,
              "❌ Parece que hay un error.\nEscribe *menu* para empezar de nuevo."
            );
            return;
          }

          await this.sendDateOptions(
            to,
            state,
            `❌ ${selectedDate.label} no tiene turnos disponibles.\n\n📅 Elige otro día:`
          );
          return;
        }

        this.resetError(to);
        state.date = selectedDate.value;
        state.displayDate = selectedDate.label;

        const availableSlots = await getAvailableSlots(state.barber, state.date);

        // Entre que se pintó la lista y el cliente escogió pueden pasar
        // minutos, y alguien más pudo tomar el último turno.
        if (availableSlots.length === 0) {
          // Se marca ese día como lleno en la lista ya guardada, para que el
          // cliente no lo vuelva a elegir en bucle.
          //
          // A propósito NO se vuelve a consultar la agenda: regenerar las
          // fechas son 7 lecturas más de Google Sheets, y este camino se
          // dispara justo cuando Sheets puede estar fallando — getSheetData()
          // devuelve [] cuando hay error, así que un fallo de lectura llega
          // aquí disfrazado de "no quedan turnos" (punto 4 del backlog).
          selectedDate.hasAvailability = false;
          selectedDate.availableCount = 0;

          await this.sendDateOptions(
            to,
            state,
            `❌ ${state.displayDate} ya no tiene turnos libres.\n\n📅 Elige otro día:`
          );
          return;
        }

        state.allSlots = availableSlots;

        // La pantalla de jornada existe solo porque los turnos no caben en una
        // lista (tope 10 filas, menos 2 de navegación). Si caben todos, se
        // salta: el cliente ve todo de una y se ahorra un toque.
        if (availableSlots.length <= this.listLimits.rows - 2) {
          delete state.periodSlots;
          state.availableSlots = availableSlots;
          state.step = 'time';

          await this.sendTimeOptions(to, state);
          return;
        }

        state.step = 'jornada';
        await this.sendPeriodOptions(to, state);
        return;
      }

      case 'jornada': {
        const periods = this.periodOptions(state);
        const choice = this.resolveChoice(message, periods, 'jornada');

        if (choice.type === 'back') {
          await this.handleBack(to);
          return;
        }

        if (choice.type === 'menu') {
          this.clearAllStates(to);
          await this.sendMainMenu(to);
          return;
        }

        if (choice.type !== 'option') {
          if (this.incrementError(to)) {
            await whatsappService.sendMessage(
              to,
              "❌ Parece que hay un error.\nEscribe *menu* para empezar de nuevo."
            );
            return;
          }

          await this.sendPeriodOptions(to, state);
          return;
        }

        this.resetError(to);
        state.availableSlots = periods[choice.index].slots;
        state.step = 'time';

        await this.sendTimeOptions(to, state);
        return;
      }

      case 'time': {
        const slots = state.availableSlots || [];
        const choice = this.resolveChoice(
          message,
          slots.map(slot => ({ value: slot })),
          'hora'
        );

        if (choice.type === 'back') {
          await this.handleBack(to);
          return;
        }

        if (choice.type === 'menu') {
          this.clearAllStates(to);
          await this.sendMainMenu(to);
          return;
        }

        if (choice.type !== 'option') {
          if (this.incrementError(to)) {
            await whatsappService.sendMessage(
              to,
              "❌ Parece que hay un error.\nEscribe *menu* para empezar de nuevo."
            );
            return;
          }

          await this.sendTimeOptions(
            to,
            state,
            '❌ No entendí esa opción.\n\n⏰ Elige una hora de la lista:'
          );
          return;
        }

        const finalTime = slots[choice.index];
        const optionsCount = slots.length;

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

    if (state.step === 'select_cancel') {
      const appointments = state.appointments || [];
      const choice = this.resolveChoice(
        message,
        appointments.map(appointment => ({ value: appointment.rowNumber })),
        'cancelar'
      );

      if (choice.type === 'back' || choice.type === 'menu') {
        delete this.cancelState[to];
        this.resetError(to);
        await this.sendMainMenu(to);
        return;
      }

      if (choice.type !== 'option') {
        await this.sendCancelAppointmentList(
          to,
          appointments,
          '❌ No entendí esa opción.\n\n✍️ Elige el turno que deseas cancelar:'
        );
        return;
      }

      state.selectedAppointment = appointments[choice.index];
      state.step = 'confirm_cancel';

      await this.sendCancelConfirmation(to, state.selectedAppointment);
      return;
    }

    if (state.step === 'confirm_cancel') {
      const choice = this.resolveChoice(
        message,
        [{ value: 'si' }, { value: 'no' }],
        'confirmar'
      );

      if (choice.type === 'back') {
        state.step = 'select_cancel';
        delete state.selectedAppointment;
        this.resetError(to);
        await this.sendCancelAppointmentList(to, state.appointments);
        return;
      }

      if (choice.type === 'menu') {
        this.clearAllStates(to);
        await this.sendMainMenu(to);
        return;
      }

      if (choice.type === 'option' && choice.index === 0) {
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

      if (choice.type === 'option' && choice.index === 1) {
        delete this.cancelState[to];
        this.resetError(to);

        await whatsappService.sendMessage(
          to,
          'Perfecto, tu turno sigue activo.'
        );
        return;
      }

      await this.sendCancelConfirmation(to, state.selectedAppointment);
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
          hasAvailability: slots.length > 0,
          availableCount: slots.length
        });
      }

      i++;
    }

    return dates;
  }

  // Las opciones en el mismo orden en que se muestran, para que el número
  // escrito y la fila tocada apunten siempre a lo mismo.
  barberOptions() {
    return this.barbers.map(barber => ({
      value: barber.toLowerCase(),
      label: barber,
    }));
  }

  async sendBarberOptions(to, customBody) {
    const total = this.barbers.length;

    await this.sendOptionList(to, {
      body: customBody || '✂️ Elige tu barbero',
      buttonText: 'Elegir barbero',
      sections: [
        {
          title: 'BARBEROS',
          rows: this.barberOptions().map((option, index) => ({
            id: `barbero_${option.value}`,
            title: `${index + 1}. ${option.label}`,
          })),
        },
        {
          title: 'MÁS OPCIONES',
          rows: [
            { id: 'nav_volver', title: `${total + 1}. ⬅️ Volver` },
            { id: 'nav_menu', title: `${total + 2}. 🏠 Menú principal`, optional: true },
          ],
        },
      ],
      footer: 'También puedes escribir el número',
    });
  }

  // "Lunes 10 de agosto" → "Lunes 10", para que quepa en el título de la fila
  // (tope 24 caracteres). La fecha completa va en la descripción.
  formatShortDate(dateString) {
    return this.formatDisplayDate(dateString).split(' de ')[0];
  }

  async sendDateOptions(to, state, customBody = null) {
    // Generar las fechas son 7 lecturas completas de Google Sheets. Cuando la
    // lista se reenvía por un error, se reutiliza lo ya consultado.
    if (!customBody || !state.availableDates) {
      state.availableDates = await this.generateNextAvailableDates(state.barber);
    }

    const nextDates = state.availableDates;
    const total = nextDates.length;

    const rows = nextDates.map((date, index) => {
      const turnos = date.availableCount === 1
        ? '1 turno libre'
        : `${date.availableCount} turnos libres`;

      return {
        id: `fecha_${date.value}`,
        title: `${index + 1}. ${this.formatShortDate(date.value)}`,
        description: date.hasAvailability
          ? `${date.label} · ${turnos}`
          : `${date.label} · ❌ sin cupos`,
      };
    });

    await this.sendOptionList(to, {
      body: customBody
        || `✅ Perfecto, *${state.name}*.\nHas elegido a *${state.barber}* 💈\n\n📅 Selecciona una fecha disponible:`,
      buttonText: 'Elegir fecha',
      sections: [
        { title: 'PRÓXIMOS DÍAS', rows },
        {
          title: 'MÁS OPCIONES',
          rows: [
            { id: 'nav_volver', title: `${total + 1}. ⬅️ Volver` },
            { id: 'nav_menu', title: `${total + 2}. 🏠 Menú principal`, optional: true },
          ],
        },
      ],
      footer: 'También puedes escribir el número',
    });
  }

  /**
   * Parte los turnos en mañana y tarde, cortando a las 12:00.
   *
   * El diseño original decía cortar en el almuerzo de cada barbero, pero eso
   * se rompe: el miércoles Julian hace jornada corta seguida, sin almuerzo,
   * y ahí no hay dónde cortar. Las 12:00 además es como lo piensa el cliente.
   */
  splitSlotsByPeriod(slots) {
    const manana = [];
    const tarde = [];

    (slots || []).forEach(slot => {
      const parsed = this.parseTime(slot);
      const minutes = parsed ? parsed.hour * 60 + parsed.minutes : 0;

      if (minutes < 12 * 60) {
        manana.push(slot);
      } else {
        tarde.push(slot);
      }
    });

    return { manana, tarde };
  }

  // Solo las jornadas que tienen turnos, en orden. El número escrito y el
  // botón tocado tienen que apuntar siempre a lo mismo.
  periodOptions(state) {
    return [
      { value: 'manana', label: '☀️ Mañana', slots: state.periodSlots?.manana || [] },
      { value: 'tarde', label: '🌤️ Tarde', slots: state.periodSlots?.tarde || [] },
    ].filter(period => period.slots.length > 0);
  }

  async sendPeriodOptions(to, state, customBody = null) {
    state.periodSlots = this.splitSlotsByPeriod(state.allSlots);

    const disponibles = this.periodOptions(state);

    // Se informa de las dos jornadas, pero solo se muestra botón de las que
    // tienen cupos: WhatsApp no tiene botones deshabilitados, así que un
    // botón de "Tarde (sin cupos)" sería un callejón sin salida.
    const linea = (label, slots) => {
      if (slots.length === 0) return `${label} — ❌ sin turnos`;

      const numero = disponibles.findIndex(p => p.label === label) + 1;
      const turnos = slots.length === 1 ? '1 turno disponible' : `${slots.length} turnos disponibles`;

      return `${numero}. ${label} — ${turnos}`;
    };

    const body = customBody || `🕐 ¿A qué hora prefieres?

Para *${state.displayDate}* con *${state.barber}*:

${linea('☀️ Mañana', state.periodSlots.manana)}
${linea('🌤️ Tarde', state.periodSlots.tarde)}

${disponibles.length + 1}. ⬅️ Volver`;

    const buttons = disponibles.map(period => ({
      type: 'reply',
      reply: { id: `jornada_${period.value}`, title: period.label },
    }));

    buttons.push({ type: 'reply', reply: { id: 'nav_volver', title: '⬅️ Volver' } });

    await whatsappService.sendInteractiveButtons(to, body, buttons);
  }

  async sendTimeOptions(to, state, customBody = null) {
    const slots = state.availableSlots || [];
    const { manana, tarde } = this.splitSlotsByPeriod(slots);

    // La numeración corre seguida entre secciones, para que el número escrito
    // coincida con lo que se ve.
    let contador = 0;
    const armarFilas = (lista) => lista.map(slot => {
      contador++;
      return { id: `hora_${slot}`, title: `${contador}. ${slot}` };
    });

    const sections = [];

    const filasManana = armarFilas(manana);
    if (filasManana.length) sections.push({ title: '☀️ MAÑANA', rows: filasManana });

    const filasTarde = armarFilas(tarde);
    if (filasTarde.length) sections.push({ title: '🌤️ TARDE', rows: filasTarde });

    sections.push({
      title: 'MÁS OPCIONES',
      rows: [
        { id: 'nav_volver', title: `${slots.length + 1}. ⬅️ Volver` },
        { id: 'nav_menu', title: `${slots.length + 2}. 🏠 Menú principal`, optional: true },
      ],
    });

    await this.sendOptionList(to, {
      body: customBody
        || `⏰ Horarios disponibles con *${state.barber}* para *${state.displayDate}*:`,
      buttonText: 'Elegir hora',
      sections,
      footer: 'También puedes escribir el número',
    });
  }

  async sendCancelAppointmentList(to, appointments, customBody = null) {
    const total = appointments.length;

    await this.sendOptionList(to, {
      body: customBody
        || `📋 *Estos son tus turnos próximos:*\n\n✍️ Elige el turno que deseas cancelar.`,
      buttonText: 'Elegir turno',
      sections: [
        {
          title: 'TURNOS CONFIRMADOS',
          rows: appointments.map((appointment, index) => ({
            id: `cancelar_${appointment.rowNumber}`,
            title: `${index + 1}. ${this.formatShortDate(appointment.date)} · ${appointment.time}`,
            description: `${appointment.displayDate} · 💈 ${appointment.barber}`,
          })),
        },
        {
          title: 'MÁS OPCIONES',
          rows: [
            { id: 'nav_volver', title: `${total + 1}. ⬅️ Volver` },
            { id: 'nav_menu', title: `${total + 2}. 🏠 Menú principal`, optional: true },
          ],
        },
      ],
      footer: 'También puedes escribir el número',
    });
  }

  async sendCancelConfirmation(to, appointment) {
    const body = `📋 *Confirma la cancelación:*

👤 ${appointment.name}
💈 ${appointment.barber}
📅 ${appointment.displayDate}
⏰ ${appointment.time}

1. ✅ Sí, cancelar
2. ❌ No, dejarlo
3. ⬅️ Volver`;

    await whatsappService.sendInteractiveButtons(to, body, [
      { type: 'reply', reply: { id: 'confirmar_si', title: '✅ Sí, cancelar' } },
      { type: 'reply', reply: { id: 'confirmar_no', title: '❌ No, dejarlo' } },
      { type: 'reply', reply: { id: 'nav_volver', title: '⬅️ Volver' } },
    ]);
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

    // 👑 Admin general: antes de nada escoge de cuál barbero ver la agenda.
    if (admin.pickingBarber) {
      if (
        normalizedOption === 'panel_salir' ||
        normalizedOption === 'salir' ||
        normalizedOption === String(this.barbers.length + 1)
      ) {
        delete this.barberAdminState[to];
        await whatsappService.sendMessage(to, "✅ Has salido del panel barbero.");
        return;
      }

      const choice = this.resolveChoice(
        rawOption,
        this.barbers.map(barber => ({ value: barber.toLowerCase() })),
        'panel_ver'
      );

      if (choice.type !== 'option') {
        await this.sendBarberPicker(to);
        return;
      }

      admin.pickingBarber = false;
      admin.barber = this.barbers[choice.index].toLowerCase();
      admin.viewingName = this.barbers[choice.index];

      await this.sendBarberAdminMenu(to, admin.viewingName);
      return;
    }

    // De quién es la agenda que se está mirando. Para un barbero normal es
    // siempre la suya; el admin general puede estar viendo la de otro.
    const viewedName = admin.viewingName || admin.name;

    // 👑 Cambiar de barbero sin tener que salir y volver a entrar.
    if (admin.canSeeAll && (normalizedOption === "5" || normalizedOption === "panel_cambiar")) {
      await this.sendBarberPicker(to);
      return;
    }

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
        this.formatDailySchedule(schedule, viewedName, rawOption)
      );

      await this.sendBarberAdminMenu(to, viewedName);
      return;
    }

    if (normalizedOption === "1" || normalizedOption === "hoy" || normalizedOption === "panel_hoy") {
      const today = this.getBogotaDate(0);
      const schedule = await getDailyScheduleByBarber(admin.barber, today);

      await whatsappService.sendMessage(
        to,
        this.formatDailySchedule(schedule, viewedName, "hoy")
      );

      await this.sendBarberAdminMenu(to, viewedName);
      return;
    }

    if (normalizedOption === "2" || normalizedOption === "manana" || normalizedOption === "mañana" || normalizedOption === "panel_manana") {
      const tomorrow = this.getBogotaDate(1);
      const schedule = await getDailyScheduleByBarber(admin.barber, tomorrow);

      await whatsappService.sendMessage(
        to,
        this.formatDailySchedule(schedule, viewedName, "mañana")
      );

      await this.sendBarberAdminMenu(to, viewedName);
      return;
    }

    if (normalizedOption === "3" || normalizedOption === "panel_fecha") {
      admin.waitingForDate = true;

      await whatsappService.sendMessage(
        to,
        "📅 Escribe la fecha que quieres consultar.\n\nFormato:\nDD/MM/AAAA\n\nEjemplo:\n16/05/2026"
      );

      return;
    }

    if (normalizedOption === "4" || normalizedOption === "salir" || normalizedOption === "panel_salir") {
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

    await this.sendBarberAdminMenu(to, viewedName);
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
      message += `📱 ${appointment.phone.replace(/^57/, '')}\n\n`;
    });

    return message.trim();
  }

  // 👑 Solo para quien puede ver todos los paneles: escoger de cuál barbero.
  async sendBarberPicker(to) {
    const admin = this.barberAdminState[to];
    if (!admin) return;

    admin.pickingBarber = true;

    await this.sendOptionList(to, {
      body: '👑 ¿De cuál barbero quieres ver la agenda?',
      buttonText: 'Elegir barbero',
      sections: [
        {
          title: 'BARBEROS',
          rows: this.barbers.map((barber, index) => ({
            id: `panel_ver_${barber.toLowerCase()}`,
            title: `${index + 1}. ${barber}`,
          })),
        },
        {
          title: 'MÁS OPCIONES',
          rows: [
            { id: 'panel_salir', title: `${this.barbers.length + 1}. Salir del panel` },
          ],
        },
      ],
      footer: 'También puedes escribir el número',
    });
  }

  async sendBarberAdminMenu(to, barberName) {
    const admin = this.barberAdminState[to];

    // "Salir" se queda en el 4 para todos: los barberos llevan meses con esa
    // costumbre. La opción extra del admin general va después.
    const extras = [
      { id: 'panel_salir', title: '4. Salir del panel' },
    ];

    if (admin?.canSeeAll) {
      extras.push({ id: 'panel_cambiar', title: '5. Cambiar de barbero' });
    }

    await this.sendOptionList(to, {
      body: admin?.canSeeAll
        ? `💈 Panel ${barberName}\n👑 Entraste como *${admin.name}*`
        : `💈 Panel ${barberName}`,
      buttonText: 'Ver opciones',
      sections: [
        {
          title: 'AGENDA',
          rows: [
            { id: 'panel_hoy', title: '1. Ver agenda de hoy' },
            { id: 'panel_manana', title: '2. Ver agenda de mañana' },
            { id: 'panel_fecha', title: '3. Buscar por fecha' },
          ],
        },
        { title: 'MÁS OPCIONES', rows: extras },
      ],
      footer: 'También puedes escribir el número',
    });
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
        message += `📱 ${item.phone.replace(/^57/, '')}\n\n`;
      } else {
        message += `🟢 ${item.time} - Libre\n`;
      }
    });

    return message.trim();
  }
}



export default new MessageHandler();
