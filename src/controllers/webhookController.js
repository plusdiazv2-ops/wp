import config from '../config/env.js';
import messageHandler from '../services/messageHandler.js';
import { esRepetido, esDemasiadoViejo } from '../services/entregasMeta.js';

class WebhookController {
  async handleIncoming(req, res) {
    try {
      console.log("📩 WEBHOOK COMPLETO:", JSON.stringify(req.body, null, 2));

      const value = req.body.entry?.[0]?.changes?.[0]?.value;

      const message = value?.messages?.[0];
      const senderInfo = value?.contacts?.[0];
      const status = value?.statuses?.[0];

      // ⚡ El 200 va PRIMERO, antes de procesar.
      //
      // Antes estaba después del await: Meta se quedaba esperando mientras
      // corrían las lecturas de Sheets y los envíos de WhatsApp, daba la
      // entrega por fallida y reenviaba el mismo mensaje. El cliente recibía
      // respuestas que nunca pidió.
      res.sendStatus(200);

      if (status) {
        console.log("📬 STATUS WHATSAPP:", JSON.stringify(status, null, 2));
      }

      if (!message) return;

      // 🔁 El mismo mensaje otra vez: es un reenvío de Meta.
      if (esRepetido(message.id)) {
        console.log(`🔁 Mensaje repetido, se ignora: ${message.id}`);
        return;
      }

      // 🕰️ Mensaje viejo: pasa cuando el webhook estuvo caído y Meta suelta
      // de golpe todo lo que tenía guardado. Responderle a alguien que
      // escribió hace horas es peor que no responderle.
      if (esDemasiadoViejo(message.timestamp)) {
        console.log(
          `🕰️ Mensaje viejo, se ignora: ${message.id} (timestamp ${message.timestamp})`
        );
        return;
      }

      // Ya se respondió el 200, así que esto corre por su cuenta. Si algo
      // falla no puede tumbar el proceso: se registra y ya.
      messageHandler
        .handleIncomingMessage(message, senderInfo)
        .catch(error => {
          console.error("❌ Error procesando el mensaje:", error?.message || error);
        });

    } catch (error) {
      console.error("❌ Error procesando webhook:", error);

      if (!res.headersSent) {
        res.sendStatus(200);
      }
    }
  }

  verifyWebhook(req, res) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === config.WEBHOOK_VERIFY_TOKEN) {
      res.status(200).send(challenge);
      console.log('Webhook verified successfully!');
    } else {
      res.sendStatus(403);
    }
  }
}

export default new WebhookController();