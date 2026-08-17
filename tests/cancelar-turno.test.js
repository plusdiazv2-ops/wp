/**
 * Tests de la comprobación que se hace antes de cancelar un turno.
 *
 * Sin esto, si alguien inserta o borra filas en la hoja mientras un cliente
 * decide, el bot le cancela el turno a otra persona. Nadie se entera hasta
 * que alguien llega a la barbería y no tiene cita.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { filaCoincideConTurno } from '../src/services/googleSheetsService.js';

// Columnas de la hoja: A fecha · B día · C hora · D nombre · E teléfono ·
//                      F barbero · G estado
const filaDe = ({
  fecha = '2026-08-12',
  hora = '6:00pm',
  nombre = 'Juan Pérez',
  telefono = '573001112233',
  barbero = 'Ladino',
  estado = 'Confirmado',
} = {}) => [fecha, 'Miércoles 12 de agosto', hora, nombre, telefono, barbero, estado];

const TURNO = {
  rowNumber: 42,
  date: '2026-08-12',
  time: '6:00pm',
  phone: '573001112233',
  barber: 'Ladino',
};

describe('reconocer el turno correcto', () => {
  test('la fila del cliente coincide', () => {
    assert.equal(filaCoincideConTurno(filaDe(), TURNO), true);
  });

  test('no le importan mayúsculas ni espacios de más', () => {
    const fila = filaDe({ hora: ' 6:00PM ', barbero: ' ladino ' });

    assert.equal(filaCoincideConTurno(fila, TURNO), true);
  });
});

describe('lo que NO se debe cancelar', () => {
  test('el turno de OTRO cliente a la misma hora', () => {
    // Este es el caso que importa: mismo día y hora, otro teléfono.
    const otro = filaDe({ telefono: '573009998877', nombre: 'Ana Gómez' });

    assert.equal(filaCoincideConTurno(otro, TURNO), false);
  });

  test('el mismo cliente pero otro día', () => {
    assert.equal(filaCoincideConTurno(filaDe({ fecha: '2026-08-13' }), TURNO), false);
  });

  test('el mismo cliente pero otra hora', () => {
    assert.equal(filaCoincideConTurno(filaDe({ hora: '6:30pm' }), TURNO), false);
  });

  test('el mismo cliente pero con otro barbero', () => {
    assert.equal(filaCoincideConTurno(filaDe({ barbero: 'Bolon' }), TURNO), false);
  });

  test('un turno que ya estaba cancelado', () => {
    assert.equal(filaCoincideConTurno(filaDe({ estado: 'Cancelado' }), TURNO), false);
  });

  test('una fila de bloqueo, que no tiene teléfono', () => {
    const bloqueo = filaDe({ nombre: 'Descanso', telefono: '' });

    assert.equal(filaCoincideConTurno(bloqueo, TURNO), false);
  });
});

describe('valores raros no rompen nada', () => {
  test('fila o turno ausentes', () => {
    assert.equal(filaCoincideConTurno(null, TURNO), false);
    assert.equal(filaCoincideConTurno(filaDe(), null), false);
    assert.equal(filaCoincideConTurno(undefined, undefined), false);
  });

  test('una fila vacía o incompleta', () => {
    assert.equal(filaCoincideConTurno([], TURNO), false);
    assert.equal(filaCoincideConTurno(['2026-08-12'], TURNO), false);
  });

  test('un turno sin teléfono NUNCA coincide, ni con un bloqueo', () => {
    // Sin esta guardia, dos vacíos se considerarían iguales y se cancelaría
    // cualquier bloqueo que cuadrara en día, hora y barbero.
    const sinTelefono = { ...TURNO, phone: '' };

    assert.equal(filaCoincideConTurno(filaDe({ nombre: 'Descanso', telefono: '' }), sinTelefono), false);
    assert.equal(filaCoincideConTurno(filaDe(), sinTelefono), false);
    assert.equal(filaCoincideConTurno(filaDe(), { ...TURNO, phone: '   ' }), false);
  });
});
