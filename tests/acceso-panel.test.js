/**
 * Tests del acceso al panel.
 *
 * Es lo que protege los datos de los clientes: si esto falla, entra
 * cualquiera o no entra nadie.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.ADMIN_PRINCIPAL = '573137127100';

const {
  normalizarTelefono,
  adminsPrincipales,
  esAdminPrincipal,
  puedeEntrar,
  generarCodigo,
  verificarCodigo,
  olvidarCodigos,
  hayCodigoPendiente,
  MAX_INTENTOS,
} = await import('../src/services/accesoPanel.js');

const YO = '573137127100';
const BOLON = '573146926477';
const DESCONOCIDO = '573009998877';

beforeEach(() => olvidarCodigos());

describe('quién puede entrar', () => {
  test('el admin principal sale de la variable de entorno', () => {
    assert.deepEqual(adminsPrincipales(), [YO]);
    assert.ok(esAdminPrincipal(YO));
  });

  test('da igual cómo se escriba el número', () => {
    for (const forma of ['+57 313 712 7100', '57-313-712-7100', ' 573137127100 ']) {
      assert.equal(normalizarTelefono(forma), YO, `falló con ${forma}`);
      assert.ok(puedeEntrar(forma), `debería entrar con ${forma}`);
    }
  });

  test('los admins agregados desde la web también entran', () => {
    assert.ok(puedeEntrar(BOLON, [BOLON]));
  });

  test('un desconocido no entra, ni con la lista de admins cargada', () => {
    assert.equal(puedeEntrar(DESCONOCIDO, [BOLON]), false);
  });

  test('sin número no entra nadie', () => {
    for (const vacio of ['', null, undefined, 'hola']) {
      assert.equal(puedeEntrar(vacio, [BOLON]), false);
    }
  });

  test('quitar a Bolon de la lista le quita el acceso, pero no al principal', () => {
    assert.equal(puedeEntrar(BOLON, []), false);
    assert.ok(puedeEntrar(YO, []), 'el admin principal no depende de la lista');
  });
});

describe('el código', () => {
  test('son 6 dígitos', () => {
    for (let i = 0; i < 40; i++) {
      assert.match(generarCodigo(YO), /^\d{6}$/);
    }
  });

  test('no se repite (no es adivinable)', () => {
    const vistos = new Set();
    for (let i = 0; i < 300; i++) vistos.add(generarCodigo(YO));

    assert.ok(vistos.size > 250, `salieron solo ${vistos.size} distintos de 300`);
  });

  test('el correcto entra', () => {
    const codigo = generarCodigo(YO);

    assert.deepEqual(verificarCodigo(YO, codigo), { ok: true });
  });

  test('es de un solo uso', () => {
    const codigo = generarCodigo(YO);

    assert.ok(verificarCodigo(YO, codigo).ok);
    assert.deepEqual(verificarCodigo(YO, codigo), { ok: false, motivo: 'sin_codigo' });
  });

  test('el código de un número no sirve para otro', () => {
    const codigo = generarCodigo(YO);

    assert.deepEqual(verificarCodigo(BOLON, codigo), { ok: false, motivo: 'sin_codigo' });
  });

  test('pedir uno nuevo invalida el anterior', () => {
    const viejo = generarCodigo(YO);
    const nuevo = generarCodigo(YO);

    assert.notEqual(viejo, nuevo);
    assert.deepEqual(verificarCodigo(YO, viejo), { ok: false, motivo: 'incorrecto' });
    assert.ok(verificarCodigo(YO, nuevo).ok);
  });

  test('se bloquea tras demasiados intentos fallidos', () => {
    const codigo = generarCodigo(YO);

    for (let i = 0; i < MAX_INTENTOS; i++) {
      assert.deepEqual(verificarCodigo(YO, '000000'), { ok: false, motivo: 'incorrecto' });
    }

    // Ya ni el código bueno sirve: hay que pedir otro.
    assert.deepEqual(verificarCodigo(YO, codigo), { ok: false, motivo: 'sin_codigo' });
  });

  test('sin haber pedido código no se entra', () => {
    assert.deepEqual(verificarCodigo(YO, '123456'), { ok: false, motivo: 'sin_codigo' });
  });

  test('caduca a los 5 minutos', () => {
    const codigo = generarCodigo(YO);
    const ahora = Date.now;

    Date.now = () => ahora() + 5 * 60 * 1000 + 1000;
    try {
      assert.deepEqual(verificarCodigo(YO, codigo), { ok: false, motivo: 'expirado' });
    } finally {
      Date.now = ahora;
    }
  });

  test('basura como código no rompe nada', () => {
    generarCodigo(YO);

    for (const basura of ['', null, undefined, 'abcdef', '12345678901', {}]) {
      const r = verificarCodigo(YO, basura);
      assert.equal(r.ok, false, `no debería aceptar ${JSON.stringify(basura)}`);
    }
  });

  test('olvidarCodigos deja todo limpio', () => {
    generarCodigo(YO);
    assert.ok(hayCodigoPendiente(YO));

    olvidarCodigos();
    assert.equal(hayCodigoPendiente(YO), false);
  });
});
