import config from '../config/env.js';
import messageHandler from '../services/messageHandler.js';

class WebhookController {
  async handleIncoming(req, res) {
    try {
      console.log("📩 WEBHOOK COMPLETO:", JSON.stringify(req.body, null, 2));

      const value = req.body.entry?.[0]?.changes?.[0]?.value;

      const message = value?.messages?.[0];
      const senderInfo = value?.contacts?.[0];
      const status = value?.statuses?.[0];

      if (status) {
        console.log("📬 STATUS WHATSAPP:", JSON.stringify(status, null, 2));
      }

      if (message) {
        await messageHandler.handleIncomingMessage(message, senderInfo);
      }

      res.sendStatus(200);

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