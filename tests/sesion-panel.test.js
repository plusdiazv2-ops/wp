/**
 * Tests de la sesión del panel.
 *
 * La cookie es lo único que separa a un desconocido de los datos de tus
 * clientes. Si se puede falsificar, el resto no importa.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

process.env.SESION_SECRETO = 'un-secreto-de-mentira-para-probar';

const {
  crearSesion,
  leerSesion,
  leerCookie,
  opcionesCookie,
  DURACION_MS,
  NOMBRE_COOKIE,
} = await import('../src/services/sesionPanel.js');

const YO = '573137127100';

describe('la variable de entorno está conectada', () => {
  // Esto se escribió porque SESION_SECRETO se documentó y se usó en el
  // código, pero nunca se agregó a env.js: config.SESION_SECRETO era
  // siempre undefined y la variable de Railway no hacía nada. El panel
  // parecía funcionar porque el mismo proceso firmaba y verificaba con el
  // secreto temporal, pero cada despliegue cerraba todas las sesiones.
  test('config expone SESION_SECRETO', async () => {
    const config = (await import('../src/config/env.js')).default;

    assert.equal(config.SESION_SECRETO, process.env.SESION_SECRETO);
    assert.ok(config.SESION_SECRETO, 'debería leerse del entorno');
  });
});

describe('la cookie de sesión', () => {
  test('lo que se firma se puede leer', () => {
    const sesion = leerSesion(crearSesion(YO));

    assert.equal(sesion.tel, YO);
    assert.ok(sesion.exp > Date.now());
  });

  test('dura 30 días', () => {
    const ahora = Date.now();
    const sesion = leerSesion(crearSesion(YO, ahora), ahora);

    assert.equal(sesion.exp - ahora, DURACION_MS);
    assert.equal(Math.round(DURACION_MS / 86400000), 30);
  });

  test('vencida no sirve', () => {
    const ahora = Date.now();
    const cookie = crearSesion(YO, ahora);

    assert.ok(leerSesion(cookie, ahora + DURACION_MS - 1000), 'justo antes sí');
    assert.equal(leerSesion(cookie, ahora + DURACION_MS + 1000), null, 'justo después no');
  });
});

describe('intentos de falsificarla', () => {
  test('cambiar el número invalida la firma', () => {
    const cookie = crearSesion(YO);
    const [cuerpo, firma] = cookie.split('.');

    const otroCuerpo = Buffer.from(
      JSON.stringify({ tel: '573009998877', exp: Date.now() + DURACION_MS })
    ).toString('base64url');

    assert.equal(leerSesion(`${otroCuerpo}.${firma}`), null);
  });

  test('estirar el vencimiento invalida la firma', () => {
    const cookie = crearSesion(YO);
    const firma = cookie.split('.')[1];

    const cuerpoEstirado = Buffer.from(
      JSON.stringify({ tel: YO, exp: Date.now() + 10 * 365 * 86400000 })
    ).toString('base64url');

    assert.equal(leerSesion(`${cuerpoEstirado}.${firma}`), null);
  });

  test('una cookie sin firmar no entra', () => {
    const cuerpo = Buffer.from(
      JSON.stringify({ tel: YO, exp: Date.now() + DURACION_MS })
    ).toString('base64url');

    assert.equal(leerSesion(cuerpo), null);
    assert.equal(leerSesion(cuerpo + '.'), null);
    assert.equal(leerSesion(cuerpo + '.loquesea'), null);
  });

  test('basura y valores raros devuelven null, no explotan', () => {
    for (const malo of [null, undefined, '', '.', 'a.b', 'a.b.c', 123, {}, 'x'.repeat(500)]) {
      assert.equal(leerSesion(malo), null, `falló con ${JSON.stringify(malo)}`);
    }
  });

  test('una cookie firmada con OTRO secreto no entra', () => {
    // Se comprueba en un proceso aparte con otro SESION_SECRETO, que es como
    // pasa de verdad: cambiar el secreto en Railway debe cerrar todas las
    // sesiones abiertas. Recargar el módulo en el mismo proceso no sirve,
    // porque env.js lee las variables una sola vez al arrancar.
    const cookieAjena = crearSesion(YO);

    const salida = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `
        const { leerSesion } = await import('./src/services/sesionPanel.js');
        console.log(JSON.stringify(leerSesion(process.argv[1])));
      `, cookieAjena],
      { env: { ...process.env, SESION_SECRETO: 'otro-secreto-distinto' }, encoding: 'utf8' }
    );

    assert.ok(salida.trim().endsWith('null'), 'el otro proceso no debería aceptarla');
  });
});

describe('leer la cookie del encabezado', () => {
  const req = cookie => ({ headers: { cookie } });

  test('la encuentra entre varias', () => {
    assert.equal(leerCookie(req(`otra=1; ${NOMBRE_COOKIE}=abc123; mas=2`), NOMBRE_COOKIE), 'abc123');
  });

  test('aguanta espacios y valores con signos', () => {
    assert.equal(leerCookie(req(`  ${NOMBRE_COOKIE}=a.b-c_d  `), NOMBRE_COOKIE), 'a.b-c_d');
  });

  test('sin cookies devuelve null', () => {
    assert.equal(leerCookie(req(''), NOMBRE_COOKIE), null);
    assert.equal(leerCookie({}, NOMBRE_COOKIE), null);
    assert.equal(leerCookie(req('otra=1'), NOMBRE_COOKIE), null);
  });
});

describe('cómo se manda la cookie', () => {
  test('no se puede leer desde JavaScript ni la manda un sitio ajeno', () => {
    const o = opcionesCookie({ secure: true });

    assert.equal(o.httpOnly, true);
    assert.equal(o.sameSite, 'strict');
    assert.equal(o.path, '/panel', 'solo se envía a las rutas del panel');
  });

  test('marcada como segura en HTTPS, no en local', () => {
    assert.equal(opcionesCookie({ secure: true }).secure, true);
    assert.equal(opcionesCookie({ secure: false }).secure, false);
  });
});
