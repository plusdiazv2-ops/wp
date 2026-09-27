import axios from "axios";
import config from '../../config/env.js';
import { esUsuarioSinNumero } from '../../config/contacto.js';

/**
 * Meta NO acepta un código de usuario en el campo `to`: exige `recipient`.
 *
 * Y si van los dos, `to` manda — así que no basta con agregar `recipient`,
 * hay que quitar `to`. Por eso la traducción se hace aquí, en la única
 * salida hacia Meta: así ningún envío se puede escapar sin pasar por esto,
 * ni los que existen hoy ni los que se agreguen mañana.
 *
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/
 */
export const conDestinatarioCorrecto = (data) => {
  if (!esUsuarioSinNumero(data?.to)) return data;

  const { to, ...resto } = data;

  return {
    ...resto,
    recipient_type: 'individual',
    recipient: to,
  };
};

const sendToWhatsApp = async (datosCrudos) => {
  const data = conDestinatarioCorrecto(datosCrudos);
  const baseUrl = `https://graph.facebook.com/${config.API_VERSION}/${config.BUSINESS_PHONE}/messages`;

  const headers = {
    Authorization: `Bearer ${config.API_TOKEN}`,
    'Content-Type': 'application/json',
  };

  console.log("📡 Enviando request a WhatsApp API");
  console.log("📍 URL:", baseUrl);
  console.log("📦 Data:", JSON.stringify(data, null, 2));

  try {
    const response = await axios({
      method: 'POST',
      url: baseUrl,
      headers,
      data,
    });

    console.log("✅ Respuesta WhatsApp API:", JSON.stringify(response.data, null, 2));

    return response.data;
  } catch (error) {
    console.error("❌ Error sending to WhatsApp");

    if (error.response) {
      console.error("📛 Status:", error.response.status);
      console.error("📛 Data:", JSON.stringify(error.response.data, null, 2));
    } else {
      console.error("📛 Error:", error.message);
    }

    throw error;
  }
};

export default sendToWhatsApp;