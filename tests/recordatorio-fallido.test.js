/**
 * Tests de lo que pasa cuando Meta rechaza un recordatorio ya marcado "Sí".
 *
 * La fila vuelve a "No" solo si sigue siendo la misma: mismo teléfono y J
 * en "Sí". Si alguien movió filas a mano, no se toca la de otro cliente.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { esElRecordatorioMarcado } from '../src/services/googleSheetsService.js';
const { recordatorioFallido, olvidarEnvios } = await import('../src/services/reminderService.js');

// Columnas: A fecha · B día · C hora · D nombre · E teléfono · F barbero ·
//           G estado · H registro · I fecha-hora · J recordatorio
const fila = ({ telefono = '573137127100', j = 'Sí' } = {}) => [
  '2026-11-05', 'Jueves 5 de noviembre', '9am', 'Prueba', telefono, 'Prueba',
  'Confirmado', '2026-11-05T01:23:12.926Z', '2026-11-04 22:28:00', j,
];

beforeEach(() => olvidarEnvios());

describe('reconocer la fila antes de devolverla a "No"', () => {
  test('mismo teléfono y J en "Sí": es la misma', () => {
    assert.equal(esElRecordatorioMarcado(fila(), '573137127100'), true);
    assert.equal(esElRecordatorioMarcado(fila({ j: 'si' }), '573137127100'), true);
  });

  test('otro teléfono en esa fila: NO se toca', () => {
    assert.equal(esElRecordatorioMarcado(fila({ telefono: '573009998877' }), '573137127100'), false);
  });

  test('J en "No": ya está como debe, no se toca', () => {
    assert.equal(esElRecordatorioMarcado(fila({ j: 'No' }), '573137127100'), false);
  });

  test('una fila de bloqueo (sin teléfono) nunca coincide', () => {
    assert.equal(esElRecordatorioMarcado(fila({ telefono: '' }), ''), false);
  });

  test('una fila vacía o ausente no rompe nada', () => {
    assert.equal(esElRecordatorioMarcado(undefined, '573137127100'), false);
    assert.equal(esElRecordatorioMarcado([], '573137127100'), false);
  });
});

describe('qué estados se atienden', () => {
  test('un mensaje que no era recordatorio no toca la hoja', async () => {
    assert.equal(await recordatorioFallido({ id: 'wamid.otro', status: 'failed' }), null);
  });

  test('entregado o leído no desmarca nada', async () => {
    assert.equal(await recordatorioFallido({ id: 'wamid.x', status: 'delivered' }), null);
    assert.equal(await recordatorioFallido({ id: 'wamid.x', status: 'read' }), null);
  });
});
