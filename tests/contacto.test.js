/**
 * Clientes que escondieron su número (nombre de usuario de WhatsApp).
 *
 * El 26 de septiembre de 2026 un cliente real escribió tres veces y el bot
 * nunca le respondió: Meta mandó un código de usuario en vez del teléfono,
 * el bot leyó `from` (vacío) y le respondió a `undefined`. Meta devolvió
 * 400 y el cliente se quedó esperando, sin que nadie se enterara.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  esUsuarioSinNumero,
  remitenteDe,
  telefonoVisible,
  SIN_NUMERO,
} from '../src/config/contacto.js';

import { conDestinatarioCorrecto } from '../src/services/httpRequest/sendToWhatsApp.js';

const BSUID = 'CO.1429929462353188';
const TELEFONO = '573001112233';

describe('distinguir un teléfono de un código de usuario', () => {
  test('un teléfono son solo dígitos', () => {
    for (const bueno of [TELEFONO, '3001112233', '1']) {
      assert.equal(esUsuarioSinNumero(bueno), false, `${bueno} es un teléfono`);
    }
  });

  test('un código de usuario trae letras y punto', () => {
    for (const codigo of [BSUID, 'CO.1', 'US.999', ' CO.123 ']) {
      assert.ok(esUsuarioSinNumero(codigo), `${codigo} es un código`);
    }
  });

  test('vacío no es ninguna de las dos', () => {
    for (const nada of ['', null, undefined, '   ']) {
      assert.equal(esUsuarioSinNumero(nada), false);
    }
  });
});

describe('de dónde se lee el remitente', () => {
  test('el teléfono de siempre', () => {
    assert.equal(remitenteDe({ from: TELEFONO }), TELEFONO);
  });

  test('el webhook que rompió el bot: sin `from`, con `from_user_id`', () => {
    const mensaje = { from_user_id: BSUID, type: 'text', text: { body: 'Hola' } };
    const contacto = { profile: { name: '777', username: 'Anddy7777' }, user_id: BSUID };

    assert.equal(remitenteDe(mensaje, contacto), BSUID);
  });

  test('si no viene en el mensaje, se busca en el contacto', () => {
    assert.equal(remitenteDe({}, { wa_id: TELEFONO }), TELEFONO);
    assert.equal(remitenteDe({}, { user_id: BSUID }), BSUID);
  });

  test('el teléfono MANDA sobre el código cuando vienen los dos', () => {
    // Meta ya manda `user_id` también a los clientes de siempre. Si se
    // prefiriera el código, se dejarían de reconocer sus turnos históricos.
    const mensaje = { from: TELEFONO, from_user_id: BSUID };
    const contacto = { wa_id: TELEFONO, user_id: BSUID };

    assert.equal(remitenteDe(mensaje, contacto), TELEFONO);
  });

  test('sin nada devuelve vacío, no explota', () => {
    for (const nada of [undefined, null, {}]) {
      assert.equal(remitenteDe(nada, nada), '');
    }
  });
});

describe('cómo se le muestra a un humano', () => {
  test('a un teléfono se le quita el 57', () => {
    assert.equal(telefonoVisible(TELEFONO), '3001112233');
  });

  test('un código de usuario NUNCA se le enseña al barbero', () => {
    assert.equal(telefonoVisible(BSUID), SIN_NUMERO);
    assert.ok(!telefonoVisible(BSUID).includes('CO.'));
  });

  test('vacío se queda vacío', () => {
    assert.equal(telefonoVisible(''), '');
    assert.equal(telefonoVisible(null), '');
  });
});

describe('cómo se le manda a Meta', () => {
  test('a un teléfono se le sigue mandando con `to`, igual que siempre', () => {
    const data = { messaging_product: 'whatsapp', to: TELEFONO, type: 'text', text: { body: 'x' } };
    const salida = conDestinatarioCorrecto(data);

    assert.deepEqual(salida, data, 'no debería tocarse nada');
  });

  test('a un código de usuario se le manda con `recipient`', () => {
    const salida = conDestinatarioCorrecto({
      messaging_product: 'whatsapp',
      to: BSUID,
      type: 'text',
      text: { body: 'x' },
    });

    assert.equal(salida.recipient, BSUID);
    assert.equal(salida.recipient_type, 'individual');
  });

  test('y `to` DESAPARECE: si va, Meta le hace caso a él y rechaza el envío', () => {
    const salida = conDestinatarioCorrecto({ messaging_product: 'whatsapp', to: BSUID, type: 'text' });

    assert.ok(!('to' in salida), '`to` no puede quedar en el cuerpo');
  });

  test('el resto del mensaje llega intacto', () => {
    const salida = conDestinatarioCorrecto({
      messaging_product: 'whatsapp',
      to: BSUID,
      type: 'interactive',
      interactive: { type: 'list', body: { text: 'hola' } },
    });

    assert.equal(salida.messaging_product, 'whatsapp');
    assert.equal(salida.type, 'interactive');
    assert.deepEqual(salida.interactive, { type: 'list', body: { text: 'hola' } });
  });

  test('marcar como leído no lleva destinatario y no se toca', () => {
    const data = { messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.X' };

    assert.deepEqual(conDestinatarioCorrecto(data), data);
  });
});
