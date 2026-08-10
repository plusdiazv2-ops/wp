/**
 * Tests de la defensa contra los reenvíos de Meta.
 *
 * Esto se escribió después de que el problema apareciera en producción: el
 * cliente escogía "Tarde", recibía su lista, y un minuto después le llegaba
 * un "No entendí esa opción" que nadie había pedido.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  esRepetido,
  esDemasiadoViejo,
  olvidarTodo,
  cuantosRecordados,
  ANTIGUEDAD_MAXIMA_MS,
} from '../src/services/entregasMeta.js';

beforeEach(() => olvidarTodo());

describe('mensajes repetidos', () => {
  test('la primera vez pasa, la segunda no', () => {
    assert.equal(esRepetido('wamid.ABC'), false);
    assert.equal(esRepetido('wamid.ABC'), true);
    assert.equal(esRepetido('wamid.ABC'), true);
  });

  test('mensajes distintos no se estorban', () => {
    assert.equal(esRepetido('wamid.UNO'), false);
    assert.equal(esRepetido('wamid.DOS'), false);
    assert.equal(esRepetido('wamid.UNO'), true);
  });

  test('el caso real: el mismo toque llegando tres veces', () => {
    const id = 'wamid.HBgMNTczMTM3MTI3MTAwFQIAEhgUM0E0';

    assert.equal(esRepetido(id), false, 'la primera se procesa');
    assert.equal(esRepetido(id), true, 'el primer reenvio se ignora');
    assert.equal(esRepetido(id), true, 'el segundo reenvio tambien');
  });

  test('sin id se procesa: mejor de mas que perder un mensaje real', () => {
    assert.equal(esRepetido(undefined), false);
    assert.equal(esRepetido(null), false);
    assert.equal(esRepetido(''), false);
  });

  test('no crece sin control', () => {
    for (let i = 0; i < 600; i++) esRepetido('wamid.' + i);

    assert.ok(cuantosRecordados() <= 600);
    assert.equal(esRepetido('wamid.599'), true, 'los recientes se siguen recordando');
  });
});

describe('mensajes viejos', () => {
  const ahora = Date.now();
  const haceMinutos = m => String(Math.floor((ahora - m * 60 * 1000) / 1000));

  test('uno recién llegado se procesa', () => {
    assert.equal(esDemasiadoViejo(haceMinutos(0), ahora), false);
    assert.equal(esDemasiadoViejo(haceMinutos(2), ahora), false);
  });

  test('uno de hace 10 minutos todavía se procesa', () => {
    assert.equal(esDemasiadoViejo(haceMinutos(10), ahora), false);
  });

  test('uno de hace 3 horas NO: es la cola atrasada del webhook caído', () => {
    assert.equal(esDemasiadoViejo(haceMinutos(180), ahora), true);
  });

  test('el corte está donde se dijo', () => {
    const justoAntes = String(Math.floor((ahora - ANTIGUEDAD_MAXIMA_MS + 5000) / 1000));
    const justoDespues = String(Math.floor((ahora - ANTIGUEDAD_MAXIMA_MS - 5000) / 1000));

    assert.equal(esDemasiadoViejo(justoAntes, ahora), false);
    assert.equal(esDemasiadoViejo(justoDespues, ahora), true);
  });

  test('sin timestamp o con basura se procesa: ante la duda, no se pierde', () => {
    for (const malo of [undefined, null, '', 'hoy', {}, '-5', '0']) {
      assert.equal(esDemasiadoViejo(malo, ahora), false,
        `no debería descartar con ${JSON.stringify(malo)}`);
    }
  });

  test('si el reloj de Meta va adelantado tampoco se descarta', () => {
    const futuro = String(Math.floor((ahora + 60 * 1000) / 1000));

    assert.equal(esDemasiadoViejo(futuro, ahora), false);
  });
});
