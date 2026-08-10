import express from 'express';
import config from './config/env.js';
import webhookRoutes from './routes/webhookRoutes.js';
import cron from 'node-cron';
import reminderService from './services/reminderService.js';

const app = express();

// Se guarda el cuerpo CRUDO además del JSON parseado: la firma de Meta se
// calcula sobre el texto original, y volver a serializar el JSON da otro
// texto distinto (orden de claves, espacios) que nunca coincidiría.
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; },
}));

// Webhook de WhatsApp
app.use('/', webhookRoutes);

// Ruta básica
app.get('/', (req, res) => {
  res.send(`<pre>Barber Bot Running 💈</pre>`);
});

/**
 * 🔔 CRON JOB
 * Se ejecuta cada 5 minutos
 */
cron.schedule('*/5 * * * *', async () => {
  console.log('⏰ Revisando recordatorios...');
  await reminderService.processReminders();
});

/**
 * 🚀 Iniciar servidor
 */
app.listen(config.PORT, () => {
  console.log(`Server is listening on port: ${config.PORT}`);
});