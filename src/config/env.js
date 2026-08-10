import dotenv from 'dotenv';

dotenv.config();

export default {
  WEBHOOK_VERIFY_TOKEN: process.env.WEBHOOK_VERIFY_TOKEN,
  // App Secret de Meta, para verificar la firma del webhook.
  // Si no está puesto, la verificación queda apagada (ver middlewares).
  META_APP_SECRET: process.env.META_APP_SECRET,

  // Números que SIEMPRE pueden entrar al panel, separados por coma.
  // No se pueden quitar desde la web: son el seguro por si alguien se
  // equivoca editando la lista de admins. Si falta, nadie entra al panel.
  ADMIN_PRINCIPAL: process.env.ADMIN_PRINCIPAL,

  // Dirección pública, para armar el enlace que se le manda al admin.
  URL_PUBLICA: process.env.URL_PUBLICA || 'https://exclusivebarber.up.railway.app',
  API_TOKEN: process.env.API_TOKEN,
  PORT: process.env.PORT,
  BUSINESS_PHONE: process.env.BUSINESS_PHONE,
  API_VERSION: process.env.API_VERSION,
  CHATGPT_API_KEY: process.env.CHATGPT_API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
};