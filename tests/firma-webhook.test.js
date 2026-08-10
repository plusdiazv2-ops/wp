/**
 * Tests de la verificación de la firma del webhook.
 *
 * Importa: si esto queda mal, o entra cualquiera, o el bot deja de recibir
 * mensajes sin que se note por qué.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { calcularFirma, firmaEsValida } from '../src/middlewares/verifyMetaSignature.js';

const SECRETO = 'un-app-secret-de-mentira';
const CUERPO = Buffer.from(JSON.stringify({
  entry: [{ changes: [{ value: { messages: [{ from: '573001112233', type: 'text' }] } }] }],
}));

describe('firma del webhook', () => {
  test('acepta una firma calculada con el secreto correcto', () => {
    const firma = calcularFirma(CUERPO, SECRETO);

    assert.ok(firmaEsValida(firma, CUERPO, SECRETO));
  });

  test('la firma sale con el prefijo que manda Meta', () => {
    assert.match(calcularFirma(CUERPO, SECRETO), /^sha256=[0-9a-f]{64}$/);
  });

  test('rechaza si el secreto no es el mismo', () => {
    const firmaAjena = calcularFirma(CUERPO, 'otro-secreto');

    assert.equal(firmaEsValida(firmaAjena, CUERPO, SECRETO), false);
  });

  test('rechaza si el cuerpo fue alterado después de firmar', () => {
    const firma = calcularFirma(CUERPO, SECRETO);
    const alterado = Buffer.from(
      CUERPO.toString().replace('573001112233', '573009999999')
    );

    assert.equal(firmaEsValida(firma, alterado, SECRETO), false);
  });

  test('rechaza cuando falta la firma o está vacía', () => {
    for (const firma of [undefined, null, '', 'sha256=']) {
      assert.equal(firmaEsValida(firma, CUERPO, SECRETO), false,
        `no debería aceptar ${JSON.stringify(firma)}`);
    }
  });

  test('rechaza una firma con la longitud correcta pero mal contenido', () => {
    const falsa = 'sha256=' + 'a'.repeat(64);

    assert.equal(firmaEsValida(falsa, CUERPO, SECRETO), false);
  });

  test('rechaza si no hay cuerpo crudo', () => {
    // Pasaría si alguien quita el `verify` de express.json en app.js.
    const firma = calcularFirma(CUERPO, SECRETO);

    assert.equal(firmaEsValida(firma, undefined, SECRETO), false);
  });

  test('sin secreto no valida nada', () => {
    const firma = calcularFirma(CUERPO, SECRETO);

    assert.equal(firmaEsValida(firma, CUERPO, ''), false);
    assert.equal(firmaEsValida(firma, CUERPO, undefined), false);
  });

  test('coincide con el cálculo de referencia de Meta', () => {
    const esperada = 'sha256=' + crypto
      .createHmac('sha256', SECRETO)
      .update(CUERPO)
      .digest('hex');

    assert.equal(calcularFirma(CUERPO, SECRETO), esperada);
  });
});
