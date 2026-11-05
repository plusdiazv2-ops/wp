import express from 'express';
import path from 'node:path';
import config from './config/env.js';
import webhookRoutes from './routes/webhookRoutes.js';
import panelRoutes from './routes/panelRoutes.js';
import cron from 'node-cron';
import reminderService from './services/reminderService.js';
import { revisarSalud, resumenDeSalud } from './services/vigilancia.js';

const app = express();

// Railway termina el HTTPS antes de llegar a Node. Sin esto, req.secure sería
// siempre false y la cookie del panel nunca saldría marcada como segura.
app.set('trust proxy', 1);

// Se guarda el cuerpo CRUDO además del JSON parseado: la firma de Meta se
// calcula sobre el texto original, y volver a serializar el JSON da otro
// texto distinto (orden de claves, espacios) que nunca coincidiría.
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; },
}));

// Webhook de WhatsApp. Va PRIMERO: el bot manda sobre la web.
app.use('/', webhookRoutes);

// Panel de administración. Va ANTES de los archivos estáticos para poder
// mandar directo adentro a quien ya tiene sesión, en vez de mostrarle otra
// vez la pantalla de entrar.
app.use('/', panelRoutes);

// Web de presentación de la barbería.
// Son archivos estáticos: no ejecutan nada y no pueden tumbar el bot.
// Caché corto a propósito: mientras la web esté cambiando, una hora de caché
// significa desplegar y no ver el cambio. Cuando se estabilice se puede subir.
app.use(express.static(path.join(process.cwd(), 'public'), {
  maxAge: '5m',
}));

// Señal de vida, para revisar que el proceso está arriba sin abrir la web.
app.get('/estado', (req, res) => {
  res.json({ ok: true, servicio: 'barber-bot' });
});

// Salud de verdad: número conectado, app suscrita y webhook recibiendo.
// 503 si algo está mal, para que un monitor externo (UptimeRobot) avise.
// No consulta a Meta en cada visita: muestra la última revisión.
// `revisado: null` en Railway = las tareas de fondo NO están corriendo.
app.get('/salud', (req, res) => {
  const salud = resumenDeSalud();
  res.status(salud.ok ? 200 : 503).json(salud);
});

/**
 * 🔒 TRABA DE TAREAS DE FONDO
 *
 * Recordatorios y vigilancia corren SOLO en Railway, que se reconoce por sus
 * propias variables. Una copia en otro computador con el .env de producción
 * mandaría recordatorios reales a clientes reales, repetidos.
 *
 * Se puede forzar con TAREAS_FONDO=encendidas o =apagadas.
 */
const enRailway = Boolean(
  process.env.RAILWAY_ENVIRONMENT_NAME
  || process.env.RAILWAY_ENVIRONMENT
  || process.env.RAILWAY_PROJECT_ID
  || process.env.RAILWAY_SERVICE_ID
);

const tareasDeFondo = process.env.TAREAS_FONDO
  ? process.env.TAREAS_FONDO === 'encendidas'
  : enRailway;

if (tareasDeFondo) {
  /**
   * 🔔 CRON JOB
   * Se ejecuta cada 5 minutos
   */
  cron.schedule('*/5 * * * *', async () => {
    console.log('⏰ Revisando recordatorios...');
    await reminderService.processReminders();
  });

  // 🩺 Vigilancia: cada 15 minutos, y una vez al arrancar.
  cron.schedule('*/15 * * * *', () => {
    revisarSalud().catch(error => console.error('Vigilancia falló:', error?.message || error));
  });
  revisarSalud().catch(error => console.error('Vigilancia falló:', error?.message || error));

  console.log('🔓 Tareas de fondo ENCENDIDAS: recordatorios y vigilancia.');
} else {
  console.warn(
    '🔒 Tareas de fondo APAGADAS: no se mandan recordatorios ni se vigila. ' +
    'Es lo correcto fuera de Railway. En Railway, revisa TAREAS_FONDO.'
  );
}

/**
 * 🚀 Iniciar servidor
 */
app.listen(config.PORT, () => {
  console.log(`Server is listening on port: ${config.PORT}`);
});