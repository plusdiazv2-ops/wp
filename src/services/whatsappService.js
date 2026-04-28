import sendToWhatsApp from '../services/httpRequest/sendToWhatsApp.js';

class WhatsAppService {
  async sendMessage(to, bodyText, messageId) {
    const data = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: bodyText },
    };

    console.log('📤 Enviando mensaje WhatsApp');
    console.log('📱 Para:', to);
    console.log('💬 Mensaje:', bodyText);

    try {
      const response = await sendToWhatsApp(data);

      console.log('✅ WhatsApp respondió OK:', response);
      return response;
    } catch (error) {
      console.error('❌ Error enviando mensaje WhatsApp');

      if (error.response) {
        console.error('📛 Status:', error.response.status);
        console.error('📛 Data:', JSON.stringify(error.response.data, null, 2));
      } else {
        console.error('📛 Error:', error.message);
      }

      throw error;
    }
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

  async sendTemplate(to, templateName, variables = []) {
    const data = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: 'es_CO',
        },
        components: [
          {
            type: 'body',
            parameters: variables.map(value => ({
              type: 'text',
              text: value,
            })),
          },
        ],
      },
    };

    await sendToWhatsApp(data);
  }
}

export default new WhatsAppService();