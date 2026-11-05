/**
 * Tests de la vigilancia contra fallos silenciosos.
 *
 * Tiene que avisar cuando el bot queda mudo o sordo, y NO avisar por un
 * hipo de la API de Meta o por un domingo tranquilo: una alarma que suena
 * de más termina ignorada.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { evaluar, esHorarioDeAtencion, SILENCIO_MAXIMO_MS } = await import('../src/services/vigilancia.js');

const TODO_BIEN = {
  estadoNumero: 'CONNECTED',
  appsSuscritas: 1,
  msDesdeUltimoWebhook: 10 * 60 * 1000,
  enHorario: true,
};

const claves = (problemas) => problemas.map(p => p.clave);

describe('qué cuenta como problema', () => {
  test('todo en orden: ningún problema', () => {
    assert.deepEqual(evaluar(TODO_BIEN), []);
  });

  test('número desconectado', () => {
    assert.deepEqual(claves(evaluar({ ...TODO_BIEN, estadoNumero: 'DISCONNECTED' })), ['numero_desconectado']);
  });

  test('ninguna app suscrita: el bot está sordo', () => {
    assert.deepEqual(claves(evaluar({ ...TODO_BIEN, appsSuscritas: 0 })), ['app_sin_suscripcion']);
  });

  test('4 horas sin nada en horario de atención', () => {
    const silencio = { ...TODO_BIEN, msDesdeUltimoWebhook: SILENCIO_MAXIMO_MS + 60000 };
    assert.deepEqual(claves(evaluar(silencio)), ['webhook_en_silencio']);
  });
});

describe('lo que NO debe despertar a nadie', () => {
  test('si no se pudo consultar a Meta (null), no es alerta', () => {
    assert.deepEqual(evaluar({ ...TODO_BIEN, estadoNumero: null, appsSuscritas: null }), []);
  });

  test('silencio fuera de horario (noche o domingo) no es alerta', () => {
    const silencio = { ...TODO_BIEN, msDesdeUltimoWebhook: 12 * 3600000, enHorario: false };
    assert.deepEqual(evaluar(silencio), []);
  });

  test('3 horas sin mensajes en horario todavía es normal', () => {
    assert.deepEqual(evaluar({ ...TODO_BIEN, msDesdeUltimoWebhook: 3 * 3600000 }), []);
  });
});

describe('horario de atención', () => {
  // 5 de noviembre de 2026 es jueves; 8 de noviembre, domingo.
  test('jueves a las 11am: sí', () => {
    assert.equal(esHorarioDeAtencion(new Date(2026, 10, 5, 11, 0)), true);
  });

  test('jueves a las 9pm: no', () => {
    assert.equal(esHorarioDeAtencion(new Date(2026, 10, 5, 21, 0)), false);
  });

  test('domingo a mediodía: no', () => {
    assert.equal(esHorarioDeAtencion(new Date(2026, 10, 8, 12, 0)), false);
  });
});
