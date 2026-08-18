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
  permitirEnvio,
  olvidarEnvios,
  MAX_ENVIOS,
  VENTANA_ENVIOS_MS,
} = await import('../src/services/accesoPanel.js');

const YO = '573137127100';
const BOLON = '573146926477';
const DESCONOCIDO = '573009998877';

beforeEach(() => {
  olvidarCodigos();
  olvidarEnvios();
});

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

describe('el freno de envios', () => {
  const TEL = `tel:${YO}`;
  const IP = 'ip:1.2.3.4';

  test('deja pasar los primeros y frena el siguiente', () => {
    for (let i = 0; i < MAX_ENVIOS; i++) {
      assert.deepEqual(permitirEnvio([TEL, IP]), { ok: true }, `deberia pasar el ${i + 1}`);
    }

    const frenado = permitirEnvio([TEL, IP]);

    assert.equal(frenado.ok, false);
    assert.ok(frenado.esperaSegundos > 0, 'deberia decir cuanto falta');
  });

  test('cambiar de numero no reinicia la cuenta del dispositivo', () => {
    for (let i = 0; i < MAX_ENVIOS; i++) permitirEnvio([`tel:5730000000${i}`, IP]);

    assert.equal(permitirEnvio([`tel:${BOLON}`, IP]).ok, false, 'el dispositivo ya gasto sus intentos');
  });

  test('cambiar de dispositivo no reinicia la cuenta del numero', () => {
    for (let i = 0; i < MAX_ENVIOS; i++) permitirEnvio([TEL, `ip:9.9.9.${i}`]);

    assert.equal(permitirEnvio([TEL, 'ip:5.5.5.5']).ok, false, 'ese numero ya gasto sus intentos');
  });

  test('cuando rebota por el numero, al dispositivo no se le gasta nada', () => {
    // El numero agota sus 3 desde redes distintas.
    for (let i = 0; i < MAX_ENVIOS; i++) permitirEnvio([TEL, `ip:9.9.9.${i}`]);

    // Esta red esta limpia, pero el intento rebota por el numero.
    assert.equal(permitirEnvio([TEL, 'ip:8.8.8.8']).ok, false);

    // Y la red se queda con sus 3 completos: el rebote no le conto.
    for (let i = 0; i < MAX_ENVIOS; i++) {
      assert.ok(permitirEnvio([`tel:${BOLON}`, 'ip:8.8.8.8']).ok, `deberia pasar el ${i + 1}`);
    }
  });

  test('pasados los 10 minutos vuelve a dejar', () => {
    for (let i = 0; i < MAX_ENVIOS; i++) permitirEnvio([TEL, IP]);
    assert.equal(permitirEnvio([TEL, IP]).ok, false);

    const ahora = Date.now;
    Date.now = () => ahora() + VENTANA_ENVIOS_MS + 1000;
    try {
      assert.deepEqual(permitirEnvio([TEL, IP]), { ok: true });
    } finally {
      Date.now = ahora;
    }
  });

  test('sin claves no frena nada (no romper por un dato que falte)', () => {
    for (let i = 0; i < MAX_ENVIOS + 3; i++) {
      assert.deepEqual(permitirEnvio([]), { ok: true });
    }
  });

  test('olvidarEnvios levanta el freno', () => {
    for (let i = 0; i < MAX_ENVIOS; i++) permitirEnvio([TEL, IP]);
    assert.equal(permitirEnvio([TEL, IP]).ok, false);

    olvidarEnvios();
    assert.deepEqual(permitirEnvio([TEL, IP]), { ok: true });
  });
});
