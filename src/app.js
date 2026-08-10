import express from 'express';
import path from 'node:path';
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

// Webhook de WhatsApp. Va PRIMERO: el bot manda sobre la web.
app.use('/', webhookRoutes);

// Web de presentación de la barbería.
// Son archivos estáticos: no ejecutan nada y no pueden tumbar el bot.
app.use(express.static(path.join(process.cwd(), 'public'), {
  maxAge: '1h',
}));

// Señal de vida, para revisar que el proceso está arriba sin abrir la web.
app.get('/estado', (req, res) => {
  res.json({ ok: true, servicio: 'barber-bot' });
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