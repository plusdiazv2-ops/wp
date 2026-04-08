import whatsappService from './whatsappService.js';
import appendToSheet from './googleSheetsService.js';
import geminiAiService from './geminiAiService.js';

class MessageHandler {

  constructor() {
    this.appointmentState = {};
    this.assistantState = {};
  }

  normalizeText(text) {
    return (text || '')
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }

  async handleIncomingMessage(message, senderInfo) {
    if (message?.type === 'text') {
      const incomingMessage = this.normalizeText(message.text.body);

      if (this.appointmentState[message.from]) {
        await this.handleAppointmentFlow(message.from, message.text.body);

      } else if (this.assistantState[message.from]) {
        await this.handleAssistantFlow(message.from, message.text.body, message.id);

      } else if (this.isGreeting(incomingMessage)) {
        await this.sendWelcomeMessage(message.from, message.id, senderInfo);
        await this.sendWelcomeMenu(message.from);

      // opcional, solo si sigues usando media para pruebas
      } else if (incomingMessage === 'media') {
        await this.sendMedia(message.from);

      } else {
        await this.handleMenuOption(message.from, incomingMessage);
      }

      await whatsappService.markAsRead(message.id);

    } else if (message?.type === 'interactive') {
      const option = this.normalizeText(message?.interactive?.button_reply?.title);

      if (this.assistantState[message.from]) {
        await this.handleAssistantFlow(message.from, option, message.id);
      } else {
        await this.handleMenuOption(message.from, option);
      }

      await whatsappService.markAsRead(message.id);
    }
  }

  isGreeting(message) {
    const greetings = [
      'hi',
      'hello',
      'hey',
      'hola',
      'alo',
      'oe',
      'buenas',
      'buenos',
      'buenas tardes',
      'buenos dias',
      'buenas noches',
      'menu'
    ];
    return greetings.includes(message);
  }

  getSenderName(senderInfo) {
    const fullName = senderInfo?.profile?.name || senderInfo?.wa_id || "Cliente";
    return fullName.split(' ')[0];
  }

  async sendWelcomeMessage(to, messageId, senderInfo) {
    const name = this.getSenderName(senderInfo);
    const welcomeMessage = `Hola ${name}, Bienvenido a Exclusive Barber. ¿Cuéntame en qué te puedo ayudar?`;
    await whatsappService.sendMessage(to, welcomeMessage, messageId);
  }

  async sendWelcomeMenu(to) {
    const menuMessage = "Elige una opción";
    const buttons = [
      {
        type: 'reply',
        reply: { id: 'option_1', title: 'Agendar Turno' }
      },
      {
        type: 'reply',
        reply: { id: 'option_2', title: 'Hablar con BarberIA' }
      },
      {
        type: 'reply',
        reply: { id: 'option_3', title: 'Ubicación' }
      },
    ];

    await whatsappService.sendInteractiveButtons(to, menuMessage, buttons);
  }

  async handleMenuOption(to, option) {
    let response;
    switch (option) {
      case 'agendar turno':
        this.appointmentState[to] = { step: 'name' };
        response = '¿Cuál es tu nombre?';
        await whatsappService.sendMessage(to, response);
        break;

      case 'hablar con barberia':
        this.assistantState[to] = { step: 'question' };
        response = '🤖 Hola, soy el asistente virtual de Exclusive Barber.\n\nPuedes preguntarme sobre turnos, horarios, servicios o ubicación.';
        await whatsappService.sendMessage(to, response);
        break;

      case 'ubicacion':
        response = '📍 Estamos ubicados en:';
        await this.sendLocation(to);
        break;

      default:
        response = 'Lo siento, no entendí tu selección. Por favor, elige una opción válida escribiendo *hola* o *menu*.';
        await whatsappService.sendMessage(to, response);
        break;
    }
  }

  // opcional: solo si sigues usando media para pruebas
  async sendMedia(to) {
    // Descomenta y define una opción si quieres probar multimedia
    // const mediaUrl = 'https://tu-url.com/archivo.jpg';
    // const caption = 'Bienvenido a Exclusive Barber';
    // const type = 'image';

    // await whatsappService.sendMediaMessage(to, type, mediaUrl, caption);
  }

  completeAppointment(to) {
    const appointment = this.appointmentState[to];
    delete this.appointmentState[to];

    const userData = [
      to,
      appointment.name,
      appointment.date,
      appointment.time,
      new Date().toISOString()
    ];

    appendToSheet(userData);

    return `Gracias por agendar tu turno!
👤 Nombre: ${appointment.name}
📅 Día: ${appointment.date}
⏰ Hora: ${appointment.time}

Llega puntual a tu turno, ¡gracias!`;
  }

  async handleAppointmentFlow(to, message) {
    const state = this.appointmentState[to];
    let response;

    switch (state.step) {
      case 'name':
        state.name = message;
        state.phone = to;
        state.step = 'date';
        response = `Gracias ${message}! ¿Qué día quieres tu turno? (Ej: Lunes 28)`;
        break;

      case 'date':
        state.date = message;
        state.step = 'time';
        response = '¿A qué hora? (Ej: 3pm)';
        break;

      case 'time':
        state.time = message;
        response = this.completeAppointment(to);
        break;
    }

    await whatsappService.sendMessage(to, response);
  }

  async handleAssistantFlow(to, message, messageId) {
    const state = this.assistantState[to];

    if (state.step === 'question') {
      const iaResponse = await geminiAiService(message);

      await whatsappService.sendMessage(
        to,
        iaResponse || "Lo siento, en este momento no puedo responder esa consulta.",
        messageId
      );

      const followUpMessage = "¿Te fue útil la respuesta?";
      const buttons = [
        {
          type: 'reply',
          reply: { id: 'assistant_yes', title: 'Sí, gracias' }
        },
        {
          type: 'reply',
          reply: { id: 'assistant_again', title: 'Otra consulta' }
        },
        {
          type: 'reply',
          reply: { id: 'assistant_menu', title: 'Menú principal' }
        },
      ];

      await whatsappService.sendInteractiveButtons(to, followUpMessage, buttons);

      this.assistantState[to] = { step: 'post_question_menu' };
      return;
    }

    if (state.step === 'post_question_menu') {
      const option = this.normalizeText(message);

      if (option === 'si, gracias') {
        delete this.assistantState[to];
        await whatsappService.sendMessage(
          to,
          '¡Perfecto! 😎\n\nSi necesitas algo más, escribe *hola* o *menu* para volver al inicio.',
          messageId
        );
        return;
      }

      if (option === 'otra consulta') {
        this.assistantState[to] = { step: 'question' };
        await whatsappService.sendMessage(
          to,
          '✂️ Escríbeme tu nueva consulta sobre barbería.',
          messageId
        );
        return;
      }

      if (option === 'menu principal') {
        delete this.assistantState[to];
        await this.sendWelcomeMenu(to);
        return;
      }

      const followUpMessage = "Por favor elige una opción:";
      const buttons = [
        {
          type: 'reply',
          reply: { id: 'assistant_yes', title: 'Sí, gracias' }
        },
        {
          type: 'reply',
          reply: { id: 'assistant_again', title: 'Otra consulta' }
        },
        {
          type: 'reply',
          reply: { id: 'assistant_menu', title: 'Menú principal' }
        },
      ];

      await whatsappService.sendInteractiveButtons(to, followUpMessage, buttons);
    }
  }

  async sendLocation(to) {
    const latitude = 6.2071694
    const longitude = -75.579655
    const name = 'Manizales'
    const address = 'San sebastian'

    await whatsappService.sendLocation(to, latitude, longitude, name, address);
  }

  async sendLocation(to) {
    const latitude = 5.087854
    const longitude = -75.488756
    const name = 'Manizales'
    const address = 'San sebastian'

    await whatsappService.sendLocationMessage(to, latitude, longitude, name, address);
  }
}

export default new MessageHandler();