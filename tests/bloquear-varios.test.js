/**
 * Tests de bloquear y liberar varios turnos a la vez desde el panel.
 *
 * Lo que no puede pasar: que "Liberar día" le cancele el turno a un cliente,
 * o que "Bloquear día" escriba un Descanso encima de un turno ya vendido.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  separarParaBloquear,
  buscarBloqueos,
  filaDeBloqueo,
} from '../src/services/googleSheetsService.js';

// Columnas: A fecha · B día · C hora · D nombre · E teléfono · F barbero · G estado
const ENCABEZADO = ['Fecha', 'Dia', 'Hora', 'Nombre', 'Telefono', 'Barbero', 'Estado'];
const fila = (hora, nombre, { barbero = 'Julian', estado = 'Confirmado', fecha = '2026-11-03', telefono = '' } = {}) =>
  [fecha, 'Martes 3 de noviembre', hora, nombre, telefono, barbero, estado];

const HOJA = [
  ENCABEZADO,
  fila('9am', 'Ana Gómez', { telefono: '573001112233' }),   // fila 2: cliente
  fila('9:40am', 'Descanso'),                                // fila 3: bloqueo
  fila('10:20am', 'Descanso', { estado: 'Cancelado' }),      // fila 4: bloqueo ya liberado
  fila('11am', 'Descanso', { barbero: 'Bolon' }),            // fila 5: bloqueo de OTRO barbero
];

const c = (hora, fecha = '2026-11-03') => ({ fecha, hora });

describe('bloquear varios', () => {
  test('se salta lo ocupado por un cliente o por otro bloqueo', () => {
    const { libres, yaOcupadas } = separarParaBloquear(
      HOJA, 'Julian', [c('9am'), c('9:40am'), c('10:20am'), c('11am')]
    );

    assert.deepEqual(libres.map(x => x.hora), ['10:20am', '11am']);
    assert.deepEqual(yaOcupadas.map(x => x.hora), ['9am', '9:40am']);
  });

  test('un turno repetido en la lista se bloquea una sola vez', () => {
    const { libres } = separarParaBloquear(HOJA, 'Julian', [c('11am'), c('11am'), c('11AM')]);
    assert.equal(libres.length, 1);
  });

  test('la fila de bloqueo no dispara recordatorios', () => {
    const nueva = filaDeBloqueo('Julian', '2026-11-03', '11am');

    assert.equal(nueva[3], 'Descanso');
    assert.equal(nueva[4], '', 'sin teléfono');
    assert.equal(nueva[6], 'Confirmado');
    assert.equal(nueva[9], 'Sí', 'si fuera "No", el cron le escribiría a un teléfono vacío');
  });
});

describe('liberar varios', () => {
  test('NUNCA encuentra el turno de un cliente', () => {
    const { encontrados, sinBloqueo } = buscarBloqueos(HOJA, 'Julian', [c('9am')]);

    assert.equal(encontrados.length, 0);
    assert.deepEqual(sinBloqueo.map(x => x.hora), ['9am']);
  });

  test('encuentra el bloqueo y su número de fila real', () => {
    const { encontrados } = buscarBloqueos(HOJA, 'Julian', [c('9:40am')]);
    assert.deepEqual(encontrados, [{ casilla: c('9:40am'), numeroFila: 3 }]);
  });

  test('no toca bloqueos ya liberados ni los de otro barbero', () => {
    const { encontrados } = buscarBloqueos(HOJA, 'Julian', [c('10:20am'), c('11am')]);
    assert.equal(encontrados.length, 0);
  });

  test('otro día no cuenta aunque sea la misma hora', () => {
    const { encontrados } = buscarBloqueos(HOJA, 'Julian', [c('9:40am', '2026-11-04')]);
    assert.equal(encontrados.length, 0);
  });

  test('el encabezado nunca se toma por una fila', () => {
    const hoja = [fila('9am', 'Descanso'), fila('9am', 'Descanso')];
    const { encontrados } = buscarBloqueos(hoja, 'Julian', [c('9am')]);

    assert.equal(encontrados[0].numeroFila, 2);
  });
});
