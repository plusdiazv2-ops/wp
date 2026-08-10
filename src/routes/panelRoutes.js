import express from 'express';

import { verificarCodigo, puedeEntrar, normalizarTelefono } from '../services/accesoPanel.js';
import { obtenerAdminsWeb } from '../services/googleSheetsService.js';
import { requiereSesion } from '../middlewares/requiereSesion.js';
import {
  crearSesion,
  leerSesion,
  leerCookie,
  opcionesCookie,
  NOMBRE_COOKIE,
} from '../services/sesionPanel.js';

const router = express.Router();

// Solo para los formularios del panel. El webhook manda JSON y no se toca.
router.use('/panel', express.urlencoded({ extended: false }));

/**
 * Pantalla de entrar.
 *
 * Va ANTES de los archivos estáticos en app.js, para poder mandar directo
 * adentro a quien ya tiene sesión y no hacerle escribir el código de nuevo.
 */
router.get(['/panel', '/panel/'], (req, res, next) => {
  if (leerSesion(leerCookie(req, NOMBRE_COOKIE))) {
    return res.redirect('/panel/inicio');
  }

  return next();   // que lo sirva public/panel/index.html
});

/** Verificar el código y abrir la sesión. */
router.post('/panel/api/entrar', async (req, res) => {
  const telefono = normalizarTelefono(req.body?.telefono);
  const codigo = String(req.body?.codigo || '').trim();

  // A quien falle se le responde SIEMPRE lo mismo, sin decirle si el número
  // no tiene permiso, si el código venció o si se equivocó al escribirlo.
  // Cualquier detalle le sirve a quien esté probando a ver qué pega.
  const rechazar = (motivo) => {
    console.log(`🔐 Panel: intento fallido desde ${telefono || '(sin número)'} → ${motivo}`);

    return res.status(401).json({
      ok: false,
      error: 'Número o código incorrecto. Escríbele *acceso* al bot para pedir uno nuevo.',
    });
  };

  if (!telefono || !codigo) return rechazar('faltan datos');

  let adminsExtra = [];
  try {
    adminsExtra = (await obtenerAdminsWeb()).map(admin => admin.telefono);
  } catch (error) {
    console.log('No se pudo leer la lista de admins:', error?.message || error);
  }

  if (!puedeEntrar(telefono, adminsExtra)) return rechazar('sin permiso');

  const resultado = verificarCodigo(telefono, codigo);
  if (!resultado.ok) return rechazar(resultado.motivo);

  res.cookie(NOMBRE_COOKIE, crearSesion(telefono), opcionesCookie(req));

  console.log(`🔐 Panel: entró ${telefono}`);

  return res.json({ ok: true, destino: '/panel/inicio' });
});

/** Cerrar sesión en este dispositivo. */
router.post('/panel/api/salir', (req, res) => {
  res.clearCookie(NOMBRE_COOKIE, { ...opcionesCookie(req), maxAge: undefined });

  return res.json({ ok: true, destino: '/panel/' });
});

/** Adentro. Por ahora solo saluda: las pantallas de verdad son los pasos 3 a 5. */
router.get('/panel/inicio', requiereSesion, (req, res) => {
  const telefono = req.admin.telefono;
  const visible = telefono.replace(/^57/, '');
  const vence = new Date(req.admin.expira).toLocaleDateString('es-CO', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  res.type('html').send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>Panel · Exclusive Barber</title>
  <link rel="icon" href="/img/logo.jpg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/css/estilos.css" />
  <link rel="stylesheet" href="/css/panel.css" />
</head>
<body>
  <div class="grano" aria-hidden="true"></div>

  <main class="panel">
    <p class="panel__etiqueta">Panel de administración</p>
    <h1 class="panel__titulo">Entraste</h1>

    <p class="panel__texto">
      Sesión abierta con el número <strong>${visible}</strong>.<br />
      Este dispositivo queda recordado hasta el <strong>${vence}</strong>.
    </p>

    <div class="panel__pendiente">
      <p><strong>Todavía no hay nada que hacer aquí.</strong></p>
      <p>Lo que viene:</p>
      <ul>
        <li>Ver la agenda de la semana</li>
        <li>Bloquear y desbloquear horarios</li>
        <li>Editar los horarios de cada barbero</li>
      </ul>
    </div>

    <button class="boton-secundario" data-salir>Cerrar sesión</button>
    <p class="panel__volver"><a href="/">← Ir a la página de la barbería</a></p>
  </main>

  <script>
    document.querySelector('[data-salir]').addEventListener('click', async () => {
      const r = await fetch('/panel/api/salir', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      const datos = await r.json();
      location.href = datos.destino || '/panel/';
    });
  </script>
</body>
</html>`);
});

export default router;
