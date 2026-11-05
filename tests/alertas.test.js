/**
 * Tests de las alertas de fallos silenciosos.
 *
 * Nacieron del 131042 de noviembre de 2026: Meta rechazaba todos los
 * recordatorios por un cobro fallido y el bot los daba por enviados.
 * Aquí no se manda nada: solo se prueba el freno y qué dice la alerta.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const {
  debeAvisar,
  olvidarAlertas,
  alertaDeEntrega,
  FRENO_MS,
} = await import('../src/services/alertas.js');

beforeEach(() => olvidarAlertas());

// Tal cual llegó en los logs de Railway el 4 de noviembre de 2026.
const PAGO_FALLIDO = {
  id: 'wamid.prueba',
  status: 'failed',
  recipient_id: '573137127100',
  errors: [{
    code: 131042,
    title: 'Business eligibility payment issue',
    message: 'Business eligibility payment issue',
    error_data: { details: 'Message failed to send because there were one or more errors related to your payment method.' },
  }],
};

describe('el freno', () => {
  test('la primera vez avisa; la segunda, enseguida, no', () => {
    const ahora = Date.now();
    assert.equal(debeAvisar('x', ahora), true);
    assert.equal(debeAvisar('x', ahora + 1000), false);
  });

  test('pasadas 6 horas vuelve a avisar', () => {
    const ahora = Date.now();
    debeAvisar('x', ahora);
    assert.equal(debeAvisar('x', ahora + FRENO_MS + 1), true);
  });

  test('claves distintas no se frenan entre sí', () => {
    const ahora = Date.now();
    debeAvisar('pago', ahora);
    assert.equal(debeAvisar('desconectado', ahora), true);
  });
});

describe('qué dice la alerta de un mensaje no entregado', () => {
  test('el 131042 dice el código, el detalle y qué hacer', () => {
    const alerta = alertaDeEntrega(PAGO_FALLIDO);

    assert.equal(alerta.clave, 'entrega_fallida_131042');
    assert.match(alerta.asunto, /131042/);
    assert.match(alerta.texto, /payment method/);
    assert.match(alerta.texto, /Facturación y pagos/);
    assert.match(alerta.texto, /3137127100/, 'muestra el número sin el 57');
  });

  test('entregado, leído o enviado no es alerta', () => {
    for (const status of ['sent', 'delivered', 'read']) {
      assert.equal(alertaDeEntrega({ ...PAGO_FALLIDO, status, errors: undefined }), null, status);
    }
  });

  test('un cliente sin número (código de usuario) también se nombra', () => {
    const alerta = alertaDeEntrega({ ...PAGO_FALLIDO, recipient_id: undefined, recipient_user_id: 'CO.1429929462353188' });
    assert.match(alerta.texto, /sin número/);
  });

  test('sin errores en el estado no se rompe', () => {
    const alerta = alertaDeEntrega({ id: 'x', status: 'failed' });
    assert.equal(alerta.clave, 'entrega_fallida_sin código');
  });
});
