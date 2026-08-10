import express from 'express';
import webhookController from '../controllers/webhookController.js';
import { verificarFirmaMeta } from '../middlewares/verifyMetaSignature.js';

const router = express.Router();

// La firma solo aplica al POST. El GET es la verificación inicial de Meta y
// se protege con WEBHOOK_VERIFY_TOKEN, que es otra cosa.
router.post('/webhook', verificarFirmaMeta, webhookController.handleIncoming);
router.get('/webhook', webhookController.verifyWebhook);

export default router;