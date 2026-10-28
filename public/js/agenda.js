/* Agenda de la semana. Solo muestra: no escribe nada todavía. */

const $ = id => document.getElementById(id);
const tabla = $('tabla');
const aviso = $('aviso');

let estado = { barbero: '', lunes: '' };
let ultimaCarga = 0;

/* ── Qué tan viejos son los datos ─────────────────────────
   Sin esto, la pantalla parece siempre al día aunque lleve media hora
   abierta. El reloj es la señal honesta de cuándo se consultó. */
function pintarCuando() {
  const cuando = $('cuando');
  if (!ultimaCarga) { cuando.textContent = ''; return; }

  const segundos = Math.round((Date.now() - ultimaCarga) / 1000);

  cuando.textContent =
    segundos < 60 ? 'al día' :
    segundos < 3600 ? `hace ${Math.floor(segundos / 60)} min` :
    `hace ${Math.floor(segundos / 3600)} h`;

  cuando.classList.toggle('esta-viejo', segundos >= 120);
}

setInterval(pintarCuando, 10000);

const mostrarAviso = (texto, tipo = 'error') => {
  aviso.textContent = texto;
  aviso.hidden = !texto;
  aviso.classList.toggle('agenda__aviso--ok', tipo === 'ok');
};

async function cargar({ fresco = false, deFondo = false } = {}) {
  const parametros = new URLSearchParams();
  if (estado.barbero) parametros.set('barbero', estado.barbero);
  if (estado.lunes) parametros.set('desde', estado.lunes);
  if (fresco) parametros.set('fresco', '1');

  // En una recarga de fondo no se borra lo que ya está en pantalla: si algo
  // falla, es mejor seguir viendo los datos viejos que quedarse en blanco.
  if (!deFondo) tabla.innerHTML = '<caption class="agenda__cargando">Cargando…</caption>';

  let datos;
  try {
    const respuesta = await fetch('/panel/api/agenda?' + parametros, {
      headers: { Accept: 'application/json' },
    });

    // La sesión venció mientras estaba abierto.
    if (respuesta.status === 401) { location.href = '/panel/'; return; }

    datos = await respuesta.json();
  } catch {
    if (deFondo) return;   // el reloj de "hace X" ya delata que quedó viejo
    tabla.innerHTML = '';
    mostrarAviso('No se pudo conectar. Revisa tu internet.');
    return;
  }

  if (!datos.ok) {
    if (deFondo) return;
    tabla.innerHTML = '';
    mostrarAviso(datos.error || 'No se pudo cargar la agenda.');
    return;
  }

  mostrarAviso('');
  ultimaCarga = Date.now();
  pintarCuando();
  estado = { barbero: datos.barbero, lunes: datos.lunes };

  pintarSelector(datos);
  $('rotulo').textContent = datos.rotulo;
  $('anterior').dataset.desde = datos.semanaAnterior;
  $('siguiente').dataset.desde = datos.semanaSiguiente;

  pintarTabla(datos);
}

// Cómo se llama cada barbero para la gente. Lo manda el servidor, para no
// repetir aquí una regla que ya vive en config/barbers.js.
let nombresVisibles = {};

const comoSeLlama = (barbero) => nombresVisibles[barbero] || barbero;

function pintarSelector({ barberos, barbero, nombres }) {
  nombresVisibles = nombres || {};

  const select = $('barbero');
  // Un barbero limitado a lo suyo solo recibe su nombre: no hay qué escoger.
  select.disabled = barberos.length < 2;
  if (select.options.length === barberos.length) { select.value = barbero; return; }

  // ⚠️ El `value` es el nombre INTERNO: es lo que se guarda en la hoja y con
  // lo que el servidor busca los turnos. Solo cambia lo que se lee.
  select.innerHTML = barberos
    .map(b => `<option value="${b}"${b === barbero ? ' selected' : ''}>${comoSeLlama(b)}</option>`)
    .join('');
}

function pintarTabla({ horas, dias }) {
  if (!horas.length) {
    tabla.innerHTML = '<caption class="agenda__cargando">Este barbero no tiene turnos esta semana.</caption>';
    return;
  }

  const encabezado = dias.map(d => `
    <th class="${d.esHoy ? 'es-hoy' : ''}${d.esPasado ? ' es-pasado' : ''}">
      <span class="dia__corto">${d.corto}</span>
      <span class="dia__numero">${d.numero}</span>
      ${botonesDelDia(d, horas)}
    </th>`).join('');

  const filas = horas.map(hora => {
    const celdas = dias.map(dia => {
      const turno = dia.turnos[hora];

      if (!turno) return '<td class="celda celda--cerrado">—</td>';

      const datos = `data-fecha="${dia.fecha}" data-hora="${hora}"`;

      if (turno.bloqueado) {
        return `<td class="celda celda--bloqueado${claseElegida(dia.fecha, hora)}" ${datos} data-accion="desbloquear"
                    title="Bloqueado. Toca para liberarlo.">
          <span class="celda__marca">Bloqueado</span>
        </td>`;
      }

      if (turno.estado === 'ocupado') {
        return `<td class="celda celda--ocupado" title="${turno.nombre} · ${turno.telefono}">
          <span class="celda__nombre">${turno.nombre || 'Ocupado'}</span>
          <span class="celda__tel">${turno.telefono}</span>
        </td>`;
      }

      return `<td class="celda celda--libre${claseElegida(dia.fecha, hora)}" ${datos} data-accion="bloquear"
                  title="Libre. Toca para bloquearlo."></td>`;
    }).join('');

    return `<tr><th class="hora">${hora}</th>${celdas}</tr>`;
  }).join('');

  tabla.innerHTML = `
    <thead><tr><th class="hora"></th>${encabezado}</tr></thead>
    <tbody>${filas}</tbody>`;

  limpiarSeleccion();
}

// Bloquear y desbloquear tocando la casilla.
tabla.addEventListener('click', async (evento) => {
  // Los botones de "Bloquear día" / "Liberar día" van por su lado.
  const botonDia = evento.target.closest('[data-dia]');
  if (botonDia) return accionDelDia(botonDia);

  const celda = evento.target.closest('[data-accion]');
  if (!celda || celda.dataset.ocupada) return;

  const { accion, fecha, hora } = celda.dataset;

  if (seleccionando) {
    const llave = clave(fecha, hora);
    if (seleccion.has(llave)) seleccion.delete(llave); else seleccion.add(llave);
    celda.classList.toggle('celda--elegida', seleccion.has(llave));
    pintarBarra();
    return;
  }

  const pregunta = accion === 'bloquear'
    ? `¿Bloquear ${hora} del ${fecha}?

Nadie va a poder agendar en ese turno.`
    : `¿Liberar ${hora} del ${fecha}?

Vuelve a quedar disponible para los clientes.`;

  if (!confirm(pregunta)) return;

  celda.dataset.ocupada = '1';          // evita el doble clic
  celda.classList.add('celda--guardando');

  try {
    const respuesta = await fetch(`/panel/api/${accion}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ barbero: estado.barbero, fecha, hora }),
    });

    if (respuesta.status === 401) { location.href = '/panel/'; return; }

    const datos = await respuesta.json();

    if (!datos.ok) {
      mostrarAviso(datos.error || 'No se pudo guardar.');
      celda.classList.remove('celda--guardando');
      delete celda.dataset.ocupada;
      return;
    }

    mostrarAviso('');
    await cargar({ fresco: true });
  } catch {
    mostrarAviso('No se pudo conectar. Revisa tu internet.');
    celda.classList.remove('celda--guardando');
    delete celda.dataset.ocupada;
  }
});

$('barbero').addEventListener('change', e => {
  estado.barbero = e.target.value;
  cargar();
});

$('actualizar').addEventListener('click', async (e) => {
  // Se guarda antes del await: al terminar el clic, currentTarget queda en null.
  const boton = e.currentTarget;
  boton.disabled = true;
  await cargar({ fresco: true });
  boton.disabled = false;
});

/* ── Refresco automático ──────────────────────────────────
   Solo cuando alguien está mirando. Si la pestaña está de fondo o
   minimizada no se consulta nada: no tiene sentido gastar lecturas de
   Sheets —que el bot también necesita— para una pantalla que nadie ve. */
const CADA = 30000;

setInterval(() => {
  if (document.visibilityState === 'visible') cargar({ deFondo: true });
}, CADA);

// Al volver a la pestaña se actualiza de una. Es el caso de todos los días:
// agendas algo por WhatsApp, vuelves al panel, y ya está al día.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') cargar({ fresco: true, deFondo: true });
});

$('anterior').addEventListener('click', e => {
  estado.lunes = e.currentTarget.dataset.desde;
  cargar();
});

$('siguiente').addEventListener('click', e => {
  estado.lunes = e.currentTarget.dataset.desde;
  cargar();
});

$('hoy').addEventListener('click', () => {
  estado.lunes = '';
  cargar();
});

document.querySelector('[data-salir]').addEventListener('click', async () => {
  await fetch('/panel/api/salir', { method: 'POST', headers: { Accept: 'application/json' } });
  location.href = '/panel/';
});

/* ── Varios turnos a la vez ───────────────────────────────
   "Bloquear día", "Liberar día" y el modo de seleccionar varios. Todo va
   en UNA petición al servidor, que lee y escribe la hoja una sola vez. */
let seleccionando = false;
const seleccion = new Set();   // "fecha|hora"

const clave = (fecha, hora) => `${fecha}|${hora}`;
const claseElegida = (fecha, hora) => (seleccion.has(clave(fecha, hora)) ? ' celda--elegida' : '');

/** Lo libre y lo bloqueado de un día, en el orden de las horas. */
function casillasDelDia(dia, horas) {
  const libres = [];
  const bloqueadas = [];

  for (const hora of horas) {
    const turno = dia.turnos[hora];
    if (!turno) continue;
    if (turno.bloqueado) bloqueadas.push({ fecha: dia.fecha, hora });
    else if (turno.estado !== 'ocupado') libres.push({ fecha: dia.fecha, hora });
  }

  return { libres, bloqueadas };
}

function botonesDelDia(dia, horas) {
  if (dia.esPasado) return '';

  const { libres, bloqueadas } = casillasDelDia(dia, horas);
  const datos = `data-fecha="${dia.fecha}" data-nombre="${dia.corto} ${dia.numero}"`;

  return `<span class="dia__acciones">
    ${libres.length ? `<button type="button" class="dia__accion" data-dia="bloquear" ${datos}>Bloquear día</button>` : ''}
    ${bloqueadas.length ? `<button type="button" class="dia__accion" data-dia="desbloquear" ${datos}>Liberar día</button>` : ''}
  </span>`;
}

/** Las casillas tocables de la tabla que se ve, con lo que se puede hacer con cada una. */
const casillasEnPantalla = () => [...tabla.querySelectorAll('[data-accion]')]
  .map(c => ({ fecha: c.dataset.fecha, hora: c.dataset.hora, accion: c.dataset.accion }));

async function accionDelDia(boton) {
  const { dia: accion, fecha, nombre } = boton.dataset;
  const casillas = casillasEnPantalla()
    .filter(c => c.fecha === fecha && c.accion === accion)
    .map(({ fecha, hora }) => ({ fecha, hora }));

  if (!casillas.length) return;

  const pregunta = accion === 'bloquear'
    ? `¿Bloquear todo el ${nombre}?

Se bloquean ${casillas.length} turnos libres. Los turnos de clientes no se tocan.`
    : `¿Liberar todo el ${nombre}?

Se liberan ${casillas.length} turnos bloqueados y vuelven a quedar disponibles para los clientes.`;

  if (!confirm(pregunta)) return;

  boton.disabled = true;
  await mandarVarios(accion, casillas);
}

/** Manda al servidor y cuenta el resultado. Devuelve true si salió bien. */
async function mandarVarios(accion, casillas) {
  try {
    const respuesta = await fetch('/panel/api/varios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ accion, barbero: estado.barbero, casillas }),
    });

    if (respuesta.status === 401) { location.href = '/panel/'; return false; }

    const datos = await respuesta.json();

    if (!datos.ok) {
      mostrarAviso(datos.error || 'No se pudo guardar.');
      await cargar({ fresco: true, deFondo: true });
      return false;
    }

    await cargar({ fresco: true });

    const [uno, varios] = accion === 'bloquear' ? ['bloqueó', 'bloquearon'] : ['liberó', 'liberaron'];
    let texto = datos.hechos === 1 ? `Listo: se ${uno} 1 turno.` : `Listo: se ${varios} ${datos.hechos} turnos.`;
    if (datos.saltados) {
      texto += datos.saltados === 1
        ? ' 1 ya había cambiado y se dejó como estaba.'
        : ` ${datos.saltados} ya habían cambiado y se dejaron como estaban.`;
    }
    mostrarAviso(texto, 'ok');
    return true;
  } catch {
    mostrarAviso('No se pudo conectar. Revisa tu internet.');
    return false;
  }
}

/**
 * Después de cada repintada: quita de la selección lo que ya no se puede
 * tocar (un cliente lo tomó, o se cambió de semana) y actualiza la barra.
 */
function limpiarSeleccion() {
  const vigentes = new Set(casillasEnPantalla().map(c => clave(c.fecha, c.hora)));
  for (const llave of [...seleccion]) if (!vigentes.has(llave)) seleccion.delete(llave);

  // Que lo que se ve marcado sea exactamente lo que está en la selección.
  tabla.querySelectorAll('[data-accion]').forEach(c =>
    c.classList.toggle('celda--elegida', seleccion.has(clave(c.dataset.fecha, c.dataset.hora)))
  );
  pintarBarra();
}

function elegidasPorAccion() {
  const elegidas = casillasEnPantalla().filter(c => seleccion.has(clave(c.fecha, c.hora)));
  const solo = (accion) => elegidas.filter(c => c.accion === accion).map(({ fecha, hora }) => ({ fecha, hora }));

  return { bloquear: solo('bloquear'), desbloquear: solo('desbloquear') };
}

function pintarBarra() {
  const { bloquear, desbloquear } = elegidasPorAccion();
  const total = bloquear.length + desbloquear.length;

  $('varios').hidden = !seleccionando;
  $('seleccionar').classList.toggle('esta-activo', seleccionando);
  $('seleccionar').textContent = seleccionando ? 'Terminar selección' : 'Seleccionar varios';

  $('varios-cuantos').textContent = total
    ? `${total} ${total === 1 ? 'turno marcado' : 'turnos marcados'}`
    : 'Toca los turnos que quieras marcar';

  $('varios-bloquear').textContent = `Bloquear (${bloquear.length})`;
  $('varios-bloquear').disabled = !bloquear.length;
  $('varios-liberar').textContent = `Liberar (${desbloquear.length})`;
  $('varios-liberar').disabled = !desbloquear.length;
}

function salirDeSeleccion() {
  seleccionando = false;
  seleccion.clear();
  tabla.querySelectorAll('.celda--elegida').forEach(c => c.classList.remove('celda--elegida'));
  pintarBarra();
}

$('seleccionar').addEventListener('click', () => {
  if (seleccionando) return salirDeSeleccion();
  seleccionando = true;
  pintarBarra();
});

$('varios-cancelar').addEventListener('click', salirDeSeleccion);

for (const [id, accion] of [['varios-bloquear', 'bloquear'], ['varios-liberar', 'desbloquear']]) {
  $(id).addEventListener('click', async (e) => {
    const casillas = elegidasPorAccion()[accion];
    if (!casillas.length) return;

    const pregunta = accion === 'bloquear'
      ? `¿Bloquear los ${casillas.length} turnos libres marcados?

Nadie va a poder agendar en ellos.`
      : `¿Liberar los ${casillas.length} turnos bloqueados marcados?

Vuelven a quedar disponibles para los clientes.`;

    if (!confirm(pregunta)) return;

    const boton = e.currentTarget;
    boton.disabled = true;

    // Solo se desmarca lo que se acaba de usar: si también había turnos
    // marcados para la otra acción, siguen ahí esperando.
    if (await mandarVarios(accion, casillas)) {
      for (const c of casillas) seleccion.delete(clave(c.fecha, c.hora));
      if (!seleccion.size) return salirDeSeleccion();
    }
    limpiarSeleccion();
  });
}

cargar();
