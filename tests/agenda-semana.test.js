/**
 * Tests de cómo se arma la semana del panel.
 *
 * Lo delicado aquí son las fechas: un error de un día hace que el barbero
 * vea la agenda equivocada y no se dé cuenta.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  lunesDeLaSemana,
  sumarDias,
  diasDeLaSemana,
  rotuloSemana,
  aTextoISO,
} from '../src/services/agendaSemana.js';

describe('el lunes de la semana', () => {
  test('un lunes se queda en su sitio', () => {
    assert.equal(lunesDeLaSemana('2026-08-10'), '2026-08-10');
  });

  test('cualquier día de la semana cae en el mismo lunes', () => {
    for (const dia of ['2026-08-10', '2026-08-11', '2026-08-13', '2026-08-15']) {
      assert.equal(lunesDeLaSemana(dia), '2026-08-10', `falló con ${dia}`);
    }
  });

  test('el domingo cierra la semana, no la abre', () => {
    // Un barbero que mira el domingo espera ver la semana que termina,
    // no la que empieza al día siguiente.
    assert.equal(lunesDeLaSemana('2026-08-16'), '2026-08-10');
  });

  test('funciona cruzando de mes y de año', () => {
    assert.equal(lunesDeLaSemana('2026-09-02'), '2026-08-31');
    assert.equal(lunesDeLaSemana('2027-01-01'), '2026-12-28');
  });
});

describe('moverse entre semanas', () => {
  test('adelante y atrás vuelven al mismo sitio', () => {
    const lunes = '2026-08-10';

    assert.equal(sumarDias(lunes, 7), '2026-08-17');
    assert.equal(sumarDias(lunes, -7), '2026-08-03');
    assert.equal(sumarDias(sumarDias(lunes, 7), -7), lunes);
  });

  test('cruza meses sin equivocarse', () => {
    assert.equal(sumarDias('2026-08-31', 1), '2026-09-01');
    assert.equal(sumarDias('2026-03-01', -1), '2026-02-28');
  });
});

describe('los días de la semana', () => {
  const dias = diasDeLaSemana('2026-08-10', '2026-08-12');

  test('son 7, de lunes a domingo', () => {
    assert.equal(dias.length, 7);
    assert.equal(dias[0].nombre, 'Lunes');
    assert.equal(dias[6].nombre, 'Domingo');
  });

  test('las fechas van seguidas', () => {
    assert.equal(dias[0].fecha, '2026-08-10');
    assert.equal(dias[6].fecha, '2026-08-16');
  });

  test('marca cuál es hoy y cuáles ya pasaron', () => {
    assert.equal(dias[2].esHoy, true, 'el miércoles 12 debería ser hoy');
    assert.equal(dias[0].esPasado, true, 'el lunes 10 ya pasó');
    assert.equal(dias[2].esPasado, false, 'hoy no es pasado');
    assert.equal(dias[5].esPasado, false, 'el sábado no ha pasado');
  });
});

describe('el rótulo de la semana', () => {
  test('dentro del mismo mes', () => {
    assert.equal(rotuloSemana(diasDeLaSemana('2026-08-10')), '10 – 16 de agosto');
  });

  test('cuando la semana cruza de mes se nombran los dos', () => {
    assert.equal(rotuloSemana(diasDeLaSemana('2026-08-31')), '31 de agosto – 6 de septiembre');
  });
});

describe('formato de fecha', () => {
  test('siempre con dos dígitos', () => {
    assert.equal(aTextoISO(new Date(2026, 0, 5)), '2026-01-05');
    assert.equal(aTextoISO(new Date(2026, 11, 31)), '2026-12-31');
  });
});
