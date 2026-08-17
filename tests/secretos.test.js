/**
 * Guardia contra secretos escritos en el código.
 *
 * Este proyecto ya tuvo las contraseñas de los barberos en texto plano
 * dentro de messageHandler.js, y ese archivo se subió como código fuente a
 * un trabajo de la universidad. Este test existe para que no vuelva a pasar
 * sin que nadie se dé cuenta.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function archivosDeCodigo(carpeta, encontrados = []) {
  for (const nombre of readdirSync(carpeta)) {
    const ruta = join(carpeta, nombre);

    if (statSync(ruta).isDirectory()) archivosDeCodigo(ruta, encontrados);
    else if (nombre.endsWith('.js')) encontrados.push(ruta);
  }

  return encontrados;
}

const FUENTES = archivosDeCodigo('src').map(ruta => ({
  ruta,
  texto: readFileSync(ruta, 'utf8'),
}));

describe('no hay secretos en el código', () => {
  test('ninguna contraseña de barbero escrita', () => {
    // Las que estuvieron de verdad, más el patrón que seguían.
    const sospechosos = [/#bolon\d/i, /#julian\d/i, /ladino00\d/i, /#prueba\d/i];

    for (const { ruta, texto } of FUENTES) {
      for (const patron of sospechosos) {
        assert.ok(!patron.test(texto), `${ruta} tiene una contraseña escrita (${patron})`);
      }
    }
  });

  test('las contraseñas salen de la configuración', () => {
    const handler = FUENTES.find(f => f.ruta.endsWith('messageHandler.js'));

    for (const variable of ['PASSWORD_BOLON', 'PASSWORD_JULIAN', 'PASSWORD_LADINO']) {
      assert.match(handler.texto, new RegExp(`config\\.${variable}`),
        `debería leer ${variable} de la configuración`);
    }
  });

  test('ninguna clave de API ni token pegado', () => {
    // Formas típicas de los tokens de Meta y de las llaves de Google.
    const peligrosos = [
      { patron: /EAA[A-Za-z0-9]{60,}/, que: 'un token de Meta' },
      { patron: /AIza[A-Za-z0-9_-]{30,}/, que: 'una clave de Google' },
      { patron: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, que: 'una llave privada' },
    ];

    for (const { ruta, texto } of FUENTES) {
      for (const { patron, que } of peligrosos) {
        assert.ok(!patron.test(texto), `${ruta} parece tener ${que}`);
      }
    }
  });

  test('el identificador de la hoja se puede cambiar sin tocar código', () => {
    const hojas = FUENTES.find(f => f.ruta.endsWith('googleSheetsService.js'));

    assert.match(hojas.texto, /SPREADSHEET_ID = config\.SPREADSHEET_ID/);
  });
});
