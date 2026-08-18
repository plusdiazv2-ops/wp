import express from 'express';
import path from 'node:path';

import {
  verificarCodigo,
  puedeEntrar,
  normalizarTelefono,
  aNumeroWhatsApp,
  generarCodigo,
  mensajeCodigo,
  permitirEnvio,
} from '../services/accesoPanel.js';
import whatsappService from '../services/whatsappService.js';
import {
  obtenerAdminsWeb,
  obtenerTurnos,
  bloquearHorario,
  desbloquearHorario,
  guardarHorarios,
  horariosDeBarbero,
} from '../services/googleSheetsService.js';
import { requiereSesion } from '../middlewares/requiereSesion.js';
import { esTurnoValido, NOMBRES_DIAS } from '../config/barbers.js';
import { revisarSemana } from '../services/validarHorarios.js';
import { SheetsUnavailableError } from '../services/googleSheetsService.js';
import messageHandler from '../services/messageHandler.js';
import {
  armarSemana,
  lunesDeLaSemana,
  rotuloSemana,
  sumarDias,
  hoyEnBogota,
} from '../services/agendaSemana.js';
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

/**
 * Pedir un código desde la web.
 *
 * ⚠️ Meta solo deja escribirle libremente a alguien que nos haya escrito en
 * las ultimas 24 horas. Aqui el que habla primero es el bot, asi que el envio
 * puede rebotar. Cuando rebota no se muestra un error: se le devuelve al
 * barbero un enlace para pedirlo por WhatsApp, que es el camino de siempre y
 * ademas reabre esa ventana de 24 horas.
 *
 * A quien NO esta habilitado se le dice claramente. Eso convierte la pantalla
 * en una forma de averiguar cuales numeros son admin, y por eso va detras del
 * freno de envios: 3 intentos cada 10 minutos por numero y por dispositivo.
 */
router.post('/panel/api/codigo', async (req, res) => {
  const telefono = aNumeroWhatsApp(req.body?.telefono);

  if (!telefono) {
    return res.status(400).json({
      ok: false,
      error: 'Escribe tu número de WhatsApp: 10 dígitos, sin el 57.',
    });
  }

  const permiso = permitirEnvio([`tel:${telefono}`, `ip:${req.ip || ''}`]);

  if (!permiso.ok) {
    const minutos = Math.ceil(permiso.esperaSegundos / 60);

    console.log(`🔐 Panel: freno de envíos para ${telefono} desde ${req.ip}`);

    return res.status(429).json({
      ok: false,
      error: `Demasiados intentos seguidos. Espera ${minutos} minuto${minutos === 1 ? '' : 's'} e intenta de nuevo.`,
    });
  }

  let adminsExtra = [];
  try {
    adminsExtra = (await obtenerAdminsWeb()).map(admin => admin.telefono);
  } catch (error) {
    console.log('No se pudo leer la lista de admins:', error?.message || error);
  }

  if (!puedeEntrar(telefono, adminsExtra)) {
    console.log(`🔐 Panel: código negado a ${telefono}, no está habilitado.`);

    return res.status(403).json({
      ok: false,
      error: 'Tu número no está habilitado para este panel.',
    });
  }

  const codigo = generarCodigo(telefono);

  try {
    await whatsappService.sendMessage(telefono, mensajeCodigo(codigo));

    console.log(`🔐 Panel: código enviado a ${telefono} desde la web.`);

    return res.json({ ok: true, mensaje: 'Te llegó un código por WhatsApp.' });
  } catch (error) {
    // 131047 y 470 son las dos formas en que Meta dice "pasaron mas de 24
    // horas". Cualquier otro fallo tambien acaba aqui: el enlace de WhatsApp
    // sirve igual, y es mejor que dejar al barbero sin salida.
    const codigoMeta = error?.response?.data?.error?.code;
    const fueraDeVentana = codigoMeta === 131047 || codigoMeta === 470;

    console.log(
      `🔐 Panel: no se pudo enviar el código a ${telefono} (Meta ${codigoMeta ?? 'sin código'}). `
      + 'Se le ofrece pedirlo por WhatsApp.'
    );

    // 200 a propósito: la petición se atendió bien, lo que cambia es el camino.
    return res.json({
      ok: false,
      motivo: 'pedir_por_whatsapp',
      aviso: fueraDeVentana
        ? 'Hace rato que no le escribes al bot, así que WhatsApp no nos deja mandarte el código directo.'
        : 'No pude enviarte el código por WhatsApp en este momento.',
    });
  }
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

    <p><a class="boton-principal" href="/panel/agenda">Ver la agenda</a></p>
    <p><a class="boton-secundario" href="/panel/horarios">Editar horarios</a></p>

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

/** Datos de la agenda de una semana. Solo lee. */
router.get('/panel/api/agenda', requiereSesion, async (req, res) => {
  const barberos = messageHandler.barbers;

  const pedido = String(req.query.barbero || '').toLowerCase().trim();
  const barbero = barberos.find(b => b.toLowerCase() === pedido) || barberos[0];

  const lunes = lunesDeLaSemana(String(req.query.desde || '') || hoyEnBogota());

  try {
    // El botón Actualizar pide datos frescos; la carga normal usa el caché.
    const fresco = req.query.fresco === '1';
    const { horas, dias } = await armarSemana(barbero, lunes, undefined, { fresco });

    return res.json({
      ok: true,
      barbero,
      barberos,
      lunes,
      semanaAnterior: sumarDias(lunes, -7),
      semanaSiguiente: sumarDias(lunes, 7),
      rotulo: rotuloSemana(dias),
      consultado: Date.now(),
      horas,
      dias,
    });
  } catch (error) {
    // Sheets caído: se dice la verdad en vez de mostrar una semana vacía,
    // que se vería igual que "no hay nada agendado".
    const caido = error instanceof SheetsUnavailableError;

    console.error('Panel agenda:', error?.message || error);

    return res.status(caido ? 503 : 500).json({
      ok: false,
      error: caido
        ? 'No puedo consultar la agenda en este momento. Intenta en un minuto.'
        : 'Algo salió mal al armar la agenda.',
    });
  }
});

/**
 * Comprueba lo que llega antes de escribir en la hoja.
 * Devuelve { barbero, fecha, hora } o { error }.
 */
async function validarCasilla(cuerpo, barberos) {
  const pedido = String(cuerpo?.barbero || '').toLowerCase().trim();
  const barbero = barberos.find(b => b.toLowerCase() === pedido);
  const fecha = String(cuerpo?.fecha || '').trim();
  const hora = String(cuerpo?.hora || '').trim().toLowerCase();

  if (!barbero) return { error: 'Ese barbero no existe.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { error: 'Fecha inválida.' };
  if (!esTurnoValido(hora)) return { error: 'Hora inválida.' };

  // Que ese turno exista de verdad en la jornada del barbero ese día. Sin
  // esto se podrían crear filas de bloqueo en horas que no existen.
  const dia = new Date(`${fecha}T00:00:00`).getDay();
  const delDia = await obtenerTurnos(barbero, dia);

  if (!delDia.some(t => t.toLowerCase() === hora)) {
    return { error: `${barbero} no atiende a esa hora ese día.` };
  }

  return { barbero, fecha, hora };
}

const MOTIVOS = {
  ocupado: 'Ese turno ya lo tomó un cliente. Recarga la agenda.',
  no_existe: 'Ese bloqueo ya no está. Recarga la agenda.',
  la_hoja_cambio: 'La hoja cambió mientras tanto. Recarga y vuelve a intentar.',
  no_se_pudo_guardar: 'No se pudo guardar en la hoja. Intenta de nuevo.',
};

/** Marcar un horario como no disponible. */
router.post('/panel/api/bloquear', requiereSesion, async (req, res) => {
  const datos = await validarCasilla(req.body, messageHandler.barbers);
  if (datos.error) return res.status(400).json({ ok: false, error: datos.error });

  try {
    const resultado = await bloquearHorario(datos.barbero, datos.fecha, datos.hora);

    if (!resultado.ok) {
      return res.status(409).json({ ok: false, error: MOTIVOS[resultado.motivo] || 'No se pudo bloquear.' });
    }

    console.log(`🔒 ${req.admin.telefono} bloqueó ${datos.barbero} ${datos.fecha} ${datos.hora}`);
    return res.json({ ok: true });
  } catch (error) {
    return responderFallo(res, error, 'bloquear');
  }
});

/** Quitar un bloqueo. */
router.post('/panel/api/desbloquear', requiereSesion, async (req, res) => {
  const datos = await validarCasilla(req.body, messageHandler.barbers);
  if (datos.error) return res.status(400).json({ ok: false, error: datos.error });

  try {
    const resultado = await desbloquearHorario(datos.barbero, datos.fecha, datos.hora);

    if (!resultado.ok) {
      return res.status(409).json({ ok: false, error: MOTIVOS[resultado.motivo] || 'No se pudo desbloquear.' });
    }

    console.log(`🔓 ${req.admin.telefono} liberó ${datos.barbero} ${datos.fecha} ${datos.hora} (fila ${resultado.fila})`);
    return res.json({ ok: true });
  } catch (error) {
    return responderFallo(res, error, 'desbloquear');
  }
});

function responderFallo(res, error, accion) {
  const caido = error instanceof SheetsUnavailableError;
  console.error(`Panel ${accion}:`, error?.message || error);

  return res.status(caido ? 503 : 500).json({
    ok: false,
    error: caido
      ? 'No puedo escribir en la agenda ahora mismo. Intenta en un minuto.'
      : 'Algo salió mal.',
  });
}

/** Los horarios actuales de un barbero. */
router.get('/panel/api/horarios', requiereSesion, async (req, res) => {
  const barberos = messageHandler.barbers;
  const pedido = String(req.query.barbero || '').toLowerCase().trim();
  const barbero = barberos.find(b => b.toLowerCase() === pedido) || barberos[0];

  try {
    const dias = await horariosDeBarbero(barbero);

    return res.json({
      ok: true,
      barbero,
      barberos,
      dias,
      // Si ningún día viene de la hoja, todavía manda el código.
      desdeLaHoja: dias.some(d => d.deLaHoja),
    });
  } catch (error) {
    return responderFallo(res, error, 'leer horarios');
  }
});

/** Guardar los horarios de un barbero. */
router.post('/panel/api/horarios', requiereSesion, async (req, res) => {
  const barberos = messageHandler.barbers;
  const pedido = String(req.body?.barbero || '').toLowerCase().trim();
  const barbero = barberos.find(b => b.toLowerCase() === pedido);

  if (!barbero) return res.status(400).json({ ok: false, error: 'Ese barbero no existe.' });

  const { porDia, errores } = revisarSemana(req.body?.dias || {});

  if (errores.length) {
    return res.status(400).json({ ok: false, error: errores.join(String.fromCharCode(10)), errores });
  }

  try {
    await guardarHorarios(barbero, porDia);

    const resumen = NOMBRES_DIAS
      .map((d, i) => `${d} ${porDia[i].length}`)
      .join(', ');

    console.log(`📅 ${req.admin.telefono} cambió los horarios de ${barbero}: ${resumen}`);

    return res.json({ ok: true, dias: porDia });
  } catch (error) {
    return responderFallo(res, error, 'guardar horarios');
  }
});

/** La pantalla de horarios. */
router.get('/panel/horarios', requiereSesion, (req, res) => {
  res.sendFile(path.join(process.cwd(), 'src', 'views', 'horarios.html'));
});

/** La pantalla de la agenda. */
router.get('/panel/agenda', requiereSesion, (req, res) => {
  res.sendFile(path.join(process.cwd(), 'src', 'views', 'agenda.html'));
});

export default router;
