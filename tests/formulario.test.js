/**
 * Tests del formulario de agendar (WhatsApp Flows).
 *
 * Se simula a Meta: se cifra un pedido como lo hace Meta, el bot lo abre y
 * responde, y se comprueba que Meta podría leer la respuesta.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.FLOW_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });
process.env.FLOW_ID = '123';
process.env.SESION_SECRETO = 'secreto-de-sesiones-de-prueba';

const { descifrarPedido, cifrarRespuesta, llavePublicaPem } = await import('../src/services/flowCifrado.js');
const { crearToken, leerToken, responderFormulario, mensajeFormulario } = await import('../src/services/flowAgendar.js');
const { leerSesion } = await import('../src/services/sesionPanel.js');

/** Lo que hace Meta: cifra el pedido con una AES nueva y nuestra llave pública. */
function pedidoDeMeta(pedido) {
  const aes = crypto.randomBytes(16);
  const iv = crypto.randomBytes(16);
  const cifrador = crypto.createCipheriv('aes-128-gcm', aes, iv);
  const datos = Buffer.concat([cifrador.update(JSON.stringify(pedido)), cifrador.final(), cifrador.getAuthTag()]);

  return {
    aes,
    iv,
    cuerpo: {
      encrypted_flow_data: datos.toString('base64'),
      encrypted_aes_key: crypto.publicEncrypt(
        { key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, aes
      ).toString('base64'),
      initial_vector: iv.toString('base64'),
    },
  };
}

/** Lo que hace Meta al recibir la respuesta: descifra con el vector volteado. */
function leerComoMeta(respuestaB64, aes, iv) {
  const datos = Buffer.from(respuestaB64, 'base64');
  const volteado = Buffer.from(iv.map(b => ~b & 0xff));
  const descifrador = crypto.createDecipheriv('aes-128-gcm', aes, volteado);
  descifrador.setAuthTag(datos.subarray(-16));
  return JSON.parse(Buffer.concat([descifrador.update(datos.subarray(0, -16)), descifrador.final()]).toString());
}

describe('el cifrado que exige Meta', () => {
  test('ida y vuelta: abrimos el pedido y Meta puede leer la respuesta', () => {
    const { cuerpo, aes, iv } = pedidoDeMeta({ action: 'ping', version: '3.0' });

    const abierto = descifrarPedido(cuerpo);
    assert.deepEqual(abierto.pedido, { action: 'ping', version: '3.0' });

    const respuesta = cifrarRespuesta({ data: { status: 'active' } }, abierto.aes, abierto.iv);
    assert.deepEqual(leerComoMeta(respuesta, aes, iv), { data: { status: 'active' } });
  });

  test('un pedido manipulado no se abre (la ruta responde 421)', () => {
    const { cuerpo } = pedidoDeMeta({ action: 'ping' });
    const datos = Buffer.from(cuerpo.encrypted_flow_data, 'base64');
    datos[0] ^= 0xff;

    assert.throws(() => descifrarPedido({ ...cuerpo, encrypted_flow_data: datos.toString('base64') }));
  });

  test('la llave pública que se le registra a Meta es la pareja de la privada', () => {
    assert.equal(llavePublicaPem().trim(), publicKey.export({ type: 'spki', format: 'pem' }).trim());
  });
});

describe('el pase del formulario (flow_token)', () => {
  test('lleva el teléfono y el nombre, firmados', () => {
    assert.deepEqual(leerToken(crearToken('573137127100', 'Juan')), { telefono: '573137127100', nombre: 'Juan' });
  });

  test('cambiarle el teléfono invalida la firma', () => {
    const [, firma] = crearToken('573137127100').split('.');
    const otro = Buffer.from(JSON.stringify({ t: '573009998877', n: '', e: Date.now() + 3600000 })).toString('base64url');
    assert.equal(leerToken(`${otro}.${firma}`), null);
  });

  test('vence a las 2 horas', () => {
    const ahora = Date.now();
    const token = crearToken('573137127100', '', ahora);
    assert.ok(leerToken(token, ahora + 60 * 60 * 1000));
    assert.equal(leerToken(token, ahora + 3 * 60 * 60 * 1000), null);
  });

  test('⚠️ un pase del formulario NO sirve como sesión del panel web', () => {
    assert.equal(leerSesion(crearToken('573137127100')), null);
  });
});

describe('las pantallas', () => {
  const bot = {
    barbers: ['Bolon', 'Julian'],
    async generateNextAvailableDates() {
      return [
        { value: '2026-11-14', label: 'Sábado 14 de noviembre', hasAvailability: true, availableCount: 9 },
        { value: '2026-11-16', label: 'Lunes 16 de noviembre', hasAvailability: true, availableCount: 1 },
        { value: '2026-11-17', label: 'Martes 17 de noviembre', hasAvailability: false, availableCount: 0 },
      ];
    },
    formatDisplayDate: (iso) => iso,
  };
  const token = crearToken('573137127100', 'Juan');

  test('ping (revisión de Meta): activo', async () => {
    assert.deepEqual(await responderFormulario({ action: 'ping' }, bot), { data: { status: 'active' } });
  });

  test('Meta avisa un error del cliente: se acusa recibo', async () => {
    const r = await responderFormulario({ action: 'data_exchange', flow_token: token, data: { error: 'x' } }, bot);
    assert.deepEqual(r, { data: { acknowledged: true } });
  });

  test('pase falso o vencido: 427 (Meta le pide empezar de nuevo)', async () => {
    assert.deepEqual(await responderFormulario({ action: 'INIT', flow_token: 'falso.falso' }, bot), { estado: 427 });
  });

  test('al abrir: nombre escrito y barberos con su nombre visible', async () => {
    const r = await responderFormulario({ action: 'INIT', flow_token: token }, bot);

    assert.equal(r.screen, 'DATOS');
    assert.equal(r.data.nombre_inicial, 'Juan');
    assert.deepEqual(r.data.barberos, [{ id: 'Bolon', title: 'Bolon' }, { id: 'Julian', title: 'Juli' }]);
    assert.equal(r.data.hay_aviso, false);
  });

  test('sin barbero no avanza', async () => {
    const r = await responderFormulario({ action: 'data_exchange', screen: 'DATOS', flow_token: token, data: { nombre: 'Juan' } }, bot);
    assert.equal(r.screen, 'DATOS');
    assert.equal(r.data.hay_aviso, true);
  });

  test('un barbero que no existe (o apagado) no avanza', async () => {
    const r = await responderFormulario({ action: 'data_exchange', screen: 'DATOS', flow_token: token, data: { nombre: 'Juan', barbero: 'Ladino' } }, bot);
    assert.equal(r.screen, 'DATOS');
  });

  test('fechas: festivo marcado, días sin cupo deshabilitados', async () => {
    const r = await responderFormulario({ action: 'data_exchange', screen: 'DATOS', flow_token: token, data: { nombre: 'Juan', barbero: 'Julian' } }, bot);

    assert.equal(r.screen, 'FECHA');
    assert.equal(r.data.barbero, 'Julian');
    assert.match(r.data.fechas[1].description, /Festivo · 1 turno libre/);
    assert.equal(r.data.fechas[2].enabled, false);
    assert.match(r.data.fechas[2].description, /sin cupos/);
  });
});

describe('el mensaje que abre el formulario', () => {
  test('modo borrador solo cuando se pide', () => {
    const borrador = mensajeFormulario('573137127100', 'Juan', { borrador: true });
    const publicado = mensajeFormulario('573137127100', 'Juan');

    assert.equal(borrador.interactive.action.parameters.mode, 'draft');
    assert.equal(publicado.interactive.action.parameters.mode, undefined);
    assert.equal(publicado.interactive.action.parameters.flow_action, 'data_exchange');
    assert.match(publicado.interactive.footer.text, /lista/);
  });
});
