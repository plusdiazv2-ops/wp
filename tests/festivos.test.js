/**
 * Tests de los festivos de Colombia.
 *
 * Se comparan contra el calendario oficial de 2026 y 2027: si el cálculo
 * se equivoca, el cliente ve "festivo" un día normal, o al revés.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { festivoDe, festivosDelAño, domingoDePascua } from '../src/config/festivos.js';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('Pascua', () => {
  test('fechas conocidas', () => {
    assert.equal(iso(domingoDePascua(2025)), '2025-04-20');
    assert.equal(iso(domingoDePascua(2026)), '2026-04-05');
    assert.equal(iso(domingoDePascua(2027)), '2027-03-28');
  });
});

describe('calendario oficial de Colombia 2026', () => {
  const OFICIAL_2026 = [
    '2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03',
    '2026-05-01', '2026-05-18', '2026-06-08', '2026-06-15', '2026-06-29',
    '2026-07-20', '2026-08-07', '2026-08-17', '2026-10-12', '2026-11-02',
    '2026-11-16', '2026-12-08', '2026-12-25',
  ];

  test('son exactamente los 18 del calendario oficial', () => {
    assert.deepEqual([...festivosDelAño(2026).keys()].sort(), OFICIAL_2026);
  });

  test('Ley Emiliani: Todos los Santos (domingo 1) pasa al lunes 2', () => {
    assert.equal(festivoDe('2026-11-01'), null);
    assert.equal(festivoDe('2026-11-02'), 'Todos los Santos');
  });

  test('Cartagena (miércoles 11) pasa al lunes 16', () => {
    assert.equal(festivoDe('2026-11-16'), 'Independencia de Cartagena');
  });

  test('Viernes Santo NO se mueve', () => {
    assert.equal(festivoDe('2026-04-03'), 'Viernes Santo');
  });

  test('un fijo que cae en domingo se queda ahí (Navidad 2027)', () => {
    assert.equal(festivoDe('2027-12-25'), 'Navidad');
  });
});

describe('días normales', () => {
  test('un jueves cualquiera no es festivo', () => {
    assert.equal(festivoDe('2026-11-05'), null);
  });

  test('basura no rompe nada', () => {
    assert.equal(festivoDe(''), null);
    assert.equal(festivoDe(undefined), null);
  });
});
