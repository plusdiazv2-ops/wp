import axios from "axios";
import config from '../../config/env.js';

const sendToWhatsApp = async (data) => {
  const baseUrl = `https://graph.facebook.com/${config.API_VERSION}/${config.BUSINESS_PHONE}/messages`;

  const headers = {
    Authorization: `Bearer ${config.API_TOKEN}`,
    'Content-Type': 'application/json',
  };

  try {
    const response = await axios({
      method: 'POST',
      url: baseUrl,
      headers,
      data,
    });

    return response.data;
  } catch (error) {
    console.error('Error sending to WhatsApp:', error?.response?.data || error.message);
  }
};

export default sendToWhatsApp;