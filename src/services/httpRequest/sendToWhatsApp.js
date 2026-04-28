import axios from "axios";
import config from '../../config/env.js';

const sendToWhatsApp = async (data) => {
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