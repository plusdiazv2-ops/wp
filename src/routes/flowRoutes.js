import express from 'express';
import { verificarFirmaMeta } from '../middlewares/verifyMetaSignature.js';
import { descifrarPedido, cifrarRespuesta } from '../services/flowCifrado.js';
import { responderFormulario } from '../services/flowAgendar.js';
import messageHandler from '../services/messageHandler.js';

/**
 * Endpoint del formulario de agendar (WhatsApp Flows).
 *
 * Meta lo llama cada vez que el cliente pasa de pantalla. Todo llega y sale
 * cifrado (services/flowCifrado.js); la lógica está en services/flowAgendar.js.
 *
 * Códigos que Meta entiende:
 *   421 → no se pudo descifrar: Meta refresca la llave pública y reintenta.
 *   427 → el pase del formulario venció: se le pide al cliente empezar de nuevo.
 *
 * Meta exige respuesta en menos de 10 segundos.
 */
const router = express.Router();

router.post('/flows', verificarFirmaMeta, async (req, res) => {
  let abierto;

  try {
    abierto = descifrarPedido(req.body);
  } catch (error) {
    console.error('Formulario: no se pudo descifrar el pedido:', error.message);
    return res.sendStatus(421);
  }

  try {
    const respuesta = await responderFormulario(abierto.pedido, messageHandler);

    if (respuesta?.estado === 427) return res.sendStatus(427);

    res.type('text/plain');
    return res.send(cifrarRespuesta(respuesta, abierto.aes, abierto.iv));
  } catch (error) {
    console.error('Formulario: error atendiendo el pedido:', error?.message || error);
    return res.sendStatus(500);
  }
});

export default router;
