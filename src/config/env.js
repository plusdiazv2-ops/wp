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

  // Con qué se firman las cookies de sesión del panel. Si falta, se genera
  // uno al azar al arrancar: el panel funciona, pero cada despliegue cierra
  // las sesiones abiertas.
  SESION_SECRETO: process.env.SESION_SECRETO,

  // Dirección pública, para armar el enlace que se le manda al admin.
  URL_PUBLICA: process.env.URL_PUBLICA || 'https://exclusivebarber.up.railway.app',
  // Identificador de la hoja de cálculo. Se puede sobrescribir desde Railway,
  // pero lleva el valor de siempre como respaldo: sin él NADA funciona, y no
  // vale la pena arriesgar una caída total por una variable que se olvide.
  // Además no es un secreto real: sin las credenciales de Google no sirve.
  SPREADSHEET_ID: process.env.SPREADSHEET_ID
    || '1vejgS9KOgo2FDm7sIG8v6SVMM1BFSPABMmwk43RbaVQ',

  // Contraseñas del panel de cada barbero.
  // ⚠️ Estas NO llevan respaldo a propósito: el punto de sacarlas del código
  // es que dejen de estar en el código. Si a un barbero le falta la suya, no
  // puede entrar a su panel — y se avisa en los logs al arrancar. El bot
  // sigue atendiendo clientes con normalidad.
  PASSWORD_BOLON: process.env.PASSWORD_BOLON,
  PASSWORD_JULIAN: process.env.PASSWORD_JULIAN,
  PASSWORD_LADINO: process.env.PASSWORD_LADINO,
  PASSWORD_PRUEBA: process.env.PASSWORD_PRUEBA,

  API_TOKEN: process.env.API_TOKEN,
  PORT: process.env.PORT,
  BUSINESS_PHONE: process.env.BUSINESS_PHONE,
  API_VERSION: process.env.API_VERSION,
  CHATGPT_API_KEY: process.env.CHATGPT_API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
};