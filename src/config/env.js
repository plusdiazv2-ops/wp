import dotenv from 'dotenv';

dotenv.config();

export default {
  WEBHOOK_VERIFY_TOKEN: process.env.WEBHOOK_VERIFY_TOKEN,
  API_TOKEN: process.env.API_TOKEN,
  PORT: process.env.PORT,
  BUSINESS_PHONE: process.env.BUSINESS_PHONE,
  API_VERSION: process.env.API_VERSION,
  CHATGPT_API_KEY: process.env.CHATGPT_API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
};