import sendToWhatsApp from '../services/httpRequest/sendToWhatsApp.js';

class WhatsAppService {
  async sendMessage(to, bodyText, messageId) {
    const data = {
      messaging_product: 'whatsapp',
      to,
      text: { body: bodyText },

      // Si luego quieres responder citando mensaje:
      // context: {
      //   message_id: messageId,
      // },
    };

    await sendToWhatsApp(data);
  }

  async markAsRead(messageId) {
    const data = {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    };

    await sendToWhatsApp(data);
  }

  async sendInteractiveButtons(to, body, buttons) {
    const data = {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: body },
        action: {
          buttons: buttons,
        },
      },
    };

    await sendToWhatsApp(data);
  }

  // Esto es para enviar archivos multimedia
  async sendMediaMessage(to, type, mediaUrl, caption) {
    const mediaObject = {};

    switch (type) {
      case 'image':
        mediaObject.image = { link: mediaUrl, caption: caption };
        break;
      case 'audio':
        mediaObject.audio = { link: mediaUrl };
        break;
      case 'video':
        mediaObject.video = { link: mediaUrl, caption: caption };
        break;
      case 'document':
        mediaObject.document = {
          link: mediaUrl,
          caption: caption,
          filename: 'barber.pdf',
        };
        break;
      default:
        throw new Error('Not supported media type');
    }

    const data = {
      messaging_product: 'whatsapp',
      to,
      type: type,
      ...mediaObject,
    };

    await sendToWhatsApp(data);
  }

  async sendLocationMessage(to, latitude, longitude, name, address) {
    const data = {
      messaging_product: 'whatsapp',
      to,
      type: 'location',
      location: {
        latitude,
        longitude,
        name,
        address,
      },
    };

    await sendToWhatsApp(data);
  }

  async sendListMessage(to, body, buttonText, sections) {
    const data = {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: body },
        action: {
          button: buttonText,
          sections: sections,
        },
      },
    };

    await sendToWhatsApp(data);
  }
}



export default new WhatsAppService();