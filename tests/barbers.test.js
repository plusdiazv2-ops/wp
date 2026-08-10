/**
 * Tests de los horarios. Se corren con `npm test` (usa el corredor que ya
 * trae Node, sin instalar nada).
 *
 * Se cubre esto y no otra cosa porque es donde ya ha dolido: los horarios
 * estaban copiados en dos funciones y cambiar una sola rompió el bot.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  HORARIOS_POR_DEFECTO,
  NOMBRES_DIAS,
  esTurnoValido,
  turnoAMinutos,
  turnosPorDefecto,
} from '../src/config/barbers.js';

import { interpretarFilasDeHorario } from '../src/services/googleSheetsService.js';

const DOMINGO = 0, LUNES = 1, MARTES = 2, MIERCOLES = 3, SABADO = 6;

describe('formato de los turnos', () => {
  test('acepta el formato exacto de la columna C', () => {
    ['9am', '10:45am', '1:30pm', '12:20pm', '5:00pm'].forEach(turno => {
      assert.ok(esTurnoValido(turno), `debería aceptar ${turno}`);
    });
  });

  test('rechaza lo que rompería la comparación con la hoja', () => {
    ['9:00', '17:00', '9 am', 'nueve', '', null, '25pm', '9:5pm'].forEach(malo => {
      assert.equal(esTurnoValido(malo), false, `no debería aceptar ${JSON.stringify(malo)}`);
    });
  });

  test('tolera espacios de más, porque la gente los deja al escribir en Sheets', () => {
    ['  9am', '1:30pm  ', ' 5:00PM '].forEach(turno => {
      assert.ok(esTurnoValido(turno), `debería aceptar ${JSON.stringify(turno)}`);
    });
  });

  test('convierte a minutos, incluidos los bordes del mediodía', () => {
    assert.equal(turnoAMinutos('12am'), 0);
    assert.equal(turnoAMinutos('9am'), 9 * 60);
    assert.equal(turnoAMinutos('12pm'), 12 * 60);
    assert.equal(turnoAMinutos('12:20pm'), 12 * 60 + 20);
    assert.equal(turnoAMinutos('5:30pm'), 17 * 60 + 30);
    assert.equal(turnoAMinutos('basura'), -1);
  });
});

describe('horarios por defecto', () => {
  test('los turnos van en orden y sin repetirse', () => {
    for (const [barbero, semana] of Object.entries(HORARIOS_POR_DEFECTO)) {
      semana.forEach((turnos, dia) => {
        const minutos = turnos.map(turnoAMinutos);

        assert.ok(
          minutos.every(m => m > 0),
          `${barbero} ${NOMBRES_DIAS[dia]}: hay un turno con formato inválido`
        );
        assert.deepEqual(
          minutos, [...minutos].sort((a, b) => a - b),
          `${barbero} ${NOMBRES_DIAS[dia]}: los turnos están desordenados`
        );
        assert.equal(
          new Set(turnos).size, turnos.length,
          `${barbero} ${NOMBRES_DIAS[dia]}: hay turnos repetidos`
        );
      });
    }
  });

  test('ningún barbero trabaja domingo', () => {
    for (const barbero of Object.keys(HORARIOS_POR_DEFECTO)) {
      assert.deepEqual(
        turnosPorDefecto(barbero, DOMINGO), [],
        `${barbero} tiene turnos el domingo`
      );
    }
  });

  test('Bolon: miércoles solo tarde, y termina 5:30pm', () => {
    const miercoles = turnosPorDefecto('bolon', MIERCOLES);
    const lunes = turnosPorDefecto('bolon', LUNES);

    assert.equal(miercoles.length, 8);
    assert.equal(miercoles[0], '1:30pm');
    assert.ok(miercoles.every(t => turnoAMinutos(t) >= 12 * 60), 'el miércoles no debería tener mañana');
    assert.equal(lunes.at(-1), '5:30pm');
    assert.equal(miercoles.at(-1), '5:30pm');
  });

  test('Julian: martes hasta 4:40pm, resto hasta 5:20pm, miércoles corto', () => {
    assert.equal(turnosPorDefecto('julian', MARTES).at(-1), '4:40pm');
    assert.equal(turnosPorDefecto('julian', LUNES).at(-1), '5:20pm');
    assert.equal(turnosPorDefecto('julian', MIERCOLES).at(-1), '1:00pm');
  });

  test('Julian: el salto de 50 min entre 2:30pm y 3:20pm es a propósito', () => {
    const lunes = turnosPorDefecto('julian', LUNES);
    const i = lunes.indexOf('2:30pm');

    assert.ok(i !== -1);
    assert.equal(turnoAMinutos(lunes[i + 1]) - turnoAMinutos(lunes[i]), 50);
  });

  test('Ladino: mismo horario todos los días hábiles, hasta 6:20pm', () => {
    const lunes = turnosPorDefecto('ladino', LUNES);

    for (const dia of [MARTES, MIERCOLES, SABADO]) {
      assert.deepEqual(turnosPorDefecto('ladino', dia), lunes,
        `Ladino debería tener el mismo horario el ${NOMBRES_DIAS[dia]}`);
    }
    assert.equal(lunes.at(-1), '6:20pm');
  });

  test('un barbero que no existe devuelve lista vacía, no explota', () => {
    assert.deepEqual(turnosPorDefecto('fulanito', LUNES), []);
    assert.deepEqual(turnosPorDefecto(null, LUNES), []);
    assert.deepEqual(turnosPorDefecto('bolon', 99), []);
  });

  test('ninguna jornada pasa de 8 turnos, que es el tope de una lista de WhatsApp', () => {
    // Una lista admite 10 filas y 2 se van en Volver y Menú principal.
    for (const [barbero, semana] of Object.entries(HORARIOS_POR_DEFECTO)) {
      semana.forEach((turnos, dia) => {
        const manana = turnos.filter(t => turnoAMinutos(t) < 12 * 60);
        const tarde = turnos.filter(t => turnoAMinutos(t) >= 12 * 60);

        assert.ok(manana.length <= 8, `${barbero} ${NOMBRES_DIAS[dia]}: ${manana.length} turnos en la mañana, no caben`);
        assert.ok(tarde.length <= 8, `${barbero} ${NOMBRES_DIAS[dia]}: ${tarde.length} turnos en la tarde, no caben`);
      });
    }
  });
});

describe('lectura de la pestaña `horarios`', () => {
  const encabezado = ['Barbero', 'Día', 'Turnos'];

  test('interpreta una fila normal', () => {
    const r = interpretarFilasDeHorario([
      encabezado,
      ['Bolon', 'Lunes', '9am, 9:35am, 1:30pm'],
    ]);

    assert.deepEqual(r.bolon[LUNES], ['9am', '9:35am', '1:30pm']);
  });

  test('no le importan tildes, mayúsculas ni espacios de más', () => {
    const r = interpretarFilasDeHorario([
      encabezado,
      ['  BOLON ', 'miercoles', ' 1:30PM ,  2:05pm '],
    ]);

    assert.deepEqual(r.bolon[MIERCOLES], ['1:30pm', '2:05pm']);
  });

  test('celda vacía significa que ese día no trabaja', () => {
    const r = interpretarFilasDeHorario([encabezado, ['Julian', 'Domingo', '']]);

    assert.deepEqual(r.julian[DOMINGO], []);
  });

  test('descarta los turnos mal escritos pero conserva los buenos', () => {
    const r = interpretarFilasDeHorario([
      encabezado,
      ['Ladino', 'Lunes', '10:30am, 25:99xx, 11:10am, tres de la tarde'],
    ]);

    assert.deepEqual(r.ladino[LUNES], ['10:30am', '11:10am']);
  });

  test('ignora las filas con un día que no existe', () => {
    const r = interpretarFilasDeHorario([
      encabezado,
      ['Bolon', 'Lunesito', '9am'],
      ['Bolon', 'Martes', '9am'],
    ]);

    assert.equal(r.bolon[LUNES], undefined);
    assert.deepEqual(r.bolon[MARTES], ['9am']);
  });

  test('una hoja vacía o solo con encabezado no rompe nada', () => {
    assert.deepEqual(interpretarFilasDeHorario([]), {});
    assert.deepEqual(interpretarFilasDeHorario([encabezado]), {});
    assert.deepEqual(interpretarFilasDeHorario(null), {});
  });
});
