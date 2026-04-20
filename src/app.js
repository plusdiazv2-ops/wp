import express from 'express';
import config from './config/env.js';
import webhookRoutes from './routes/webhookRoutes.js';
import cron from 'node-cron';
import reminderService from './services/reminderService.js';

const app = express();
app.use(express.json());

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