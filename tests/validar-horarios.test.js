/**
 * Tests de la validación de horarios.
 *
 * Esto es lo único que separa un descuido al escribir de un bot que deja de
 * funcionar. Un horario mal puesto no se nota al guardarlo: se nota cuando
 * un cliente no puede agendar.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  separarTurnos,
  revisarDia,
  revisarSemana,
  MAXIMO_POR_JORNADA,
} from '../src/services/validarHorarios.js';

describe('separar lo que escribe el admin', () => {
  test('corta por comas y quita espacios', () => {
    assert.deepEqual(separarTurnos(' 9am , 10:45am,1:30pm '), ['9am', '10:45am', '1:30pm']);
  });

  test('aguanta comas de más y mayúsculas', () => {
    assert.deepEqual(separarTurnos('9AM,,  ,10:45AM,'), ['9am', '10:45am']);
  });

  test('vacío o basura no rompe', () => {
    assert.deepEqual(separarTurnos(''), []);
    assert.deepEqual(separarTurnos(null), []);
    assert.deepEqual(separarTurnos(undefined), []);
  });
});

describe('revisar un día', () => {
  test('un horario normal pasa', () => {
    assert.deepEqual(revisarDia('6:00pm, 6:30pm, 7:00pm', 'Lunes').turnos,
      ['6:00pm', '6:30pm', '7:00pm']);
  });

  test('los ordena solo, aunque se escriban al revés', () => {
    assert.deepEqual(revisarDia('7:00pm, 6:00pm, 6:30pm', 'Lunes').turnos,
      ['6:00pm', '6:30pm', '7:00pm']);
  });

  test('quita repetidos sin quejarse', () => {
    assert.deepEqual(revisarDia('6:00pm, 6:00pm, 6:30pm', 'Lunes').turnos,
      ['6:00pm', '6:30pm']);
  });

  test('vacío significa que ese día descansa', () => {
    assert.deepEqual(revisarDia('', 'Domingo').turnos, []);
  });

  test('ordena bien cruzando el mediodía', () => {
    assert.deepEqual(revisarDia('1:00pm, 11:00am, 12:30pm, 9am', 'Lunes').turnos,
      ['9am', '11:00am', '12:30pm', '1:00pm']);
  });
});

describe('lo que NO debe llegar a la hoja', () => {
  test('una hora que no existe', () => {
    const r = revisarDia('6:00pm, 25pm', 'Lunes');

    assert.ok(r.error, 'debería rechazarlo');
    assert.match(r.error, /25pm/, 'debería decir cuál está mal');
    assert.equal(r.turnos, undefined, 'no debería devolver turnos');
  });

  test('formato de reloj de 24 horas', () => {
    // Es el error más fácil de cometer, y rompería la comparación con la hoja.
    assert.ok(revisarDia('09:00, 17:30', 'Lunes').error);
  });

  test('texto cualquiera', () => {
    assert.ok(revisarDia('de 9 a 5', 'Lunes').error);
    assert.ok(revisarDia('mañana', 'Lunes').error);
  });

  test('el mensaje explica cómo se escribe', () => {
    assert.match(revisarDia('nueve', 'Lunes').error, /9am|10:45am|1:30pm/);
  });
});

describe('el tope de una lista de WhatsApp', () => {
  const tarde = n => Array.from({ length: n }, (_, i) => {
    const h = 1 + Math.floor(i / 2);
    return i % 2 === 0 ? `${h}:00pm` : `${h}:30pm`;
  }).join(', ');

  test(`${MAXIMO_POR_JORNADA} turnos en una jornada todavía caben`, () => {
    assert.ok(revisarDia(tarde(MAXIMO_POR_JORNADA), 'Lunes').turnos);
  });

  test('uno más se rechaza: el cliente no vería los últimos', () => {
    const r = revisarDia(tarde(MAXIMO_POR_JORNADA + 1), 'Lunes');

    assert.ok(r.error);
    assert.match(r.error, /tarde/);
    assert.match(r.error, /WhatsApp/);
  });

  test('mañana y tarde se cuentan por separado', () => {
    // 8 de mañana y 8 de tarde son 16 turnos, y aun así cabe cada lista.
    const manana = '8am, 8:30am, 9am, 9:30am, 10am, 10:30am, 11am, 11:30am';
    const r = revisarDia(manana + ', ' + tarde(8), 'Lunes');

    assert.ok(r.turnos, r.error);
    assert.equal(r.turnos.length, 16);
  });
});

describe('revisar la semana completa', () => {
  test('los 7 días quedan definidos, aunque falten en lo que llega', () => {
    const { porDia, errores } = revisarSemana({ 1: '6:00pm' });

    assert.equal(errores.length, 0);
    assert.equal(Object.keys(porDia).length, 7);
    assert.deepEqual(porDia[1], ['6:00pm']);
    assert.deepEqual(porDia[0], [], 'los días sin dato quedan como descanso');
  });

  test('junta todos los errores, no solo el primero', () => {
    const { errores } = revisarSemana({ 1: '25pm', 2: 'basura' });

    assert.equal(errores.length, 2, 'debería reportar los dos días');
  });

  test('un solo día malo impide guardar toda la semana', () => {
    const { errores } = revisarSemana({ 1: '6:00pm', 3: '99pm' });

    assert.ok(errores.length, 'no debería dejar guardar a medias');
  });

  test('acepta las claves como texto, que es como llegan del navegador', () => {
    const { porDia, errores } = revisarSemana({ '1': '6:00pm, 6:30pm' });

    assert.equal(errores.length, 0);
    assert.deepEqual(porDia[1], ['6:00pm', '6:30pm']);
  });
});
