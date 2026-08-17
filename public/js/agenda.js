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

const mostrarAviso = (texto) => {
  aviso.textContent = texto;
  aviso.hidden = !texto;
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

function pintarSelector({ barberos, barbero }) {
  const select = $('barbero');
  if (select.options.length === barberos.length) { select.value = barbero; return; }

  select.innerHTML = barberos
    .map(b => `<option value="${b}"${b === barbero ? ' selected' : ''}>${b}</option>`)
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
    </th>`).join('');

  const filas = horas.map(hora => {
    const celdas = dias.map(dia => {
      const turno = dia.turnos[hora];

      if (!turno) return '<td class="celda celda--cerrado">—</td>';

      const datos = `data-fecha="${dia.fecha}" data-hora="${hora}"`;

      if (turno.bloqueado) {
        return `<td class="celda celda--bloqueado" ${datos} data-accion="desbloquear"
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

      return `<td class="celda celda--libre" ${datos} data-accion="bloquear"
                  title="Libre. Toca para bloquearlo."></td>`;
    }).join('');

    return `<tr><th class="hora">${hora}</th>${celdas}</tr>`;
  }).join('');

  tabla.innerHTML = `
    <thead><tr><th class="hora"></th>${encabezado}</tr></thead>
    <tbody>${filas}</tbody>`;
}

// Bloquear y desbloquear tocando la casilla.
tabla.addEventListener('click', async (evento) => {
  const celda = evento.target.closest('[data-accion]');
  if (!celda || celda.dataset.ocupada) return;

  const { accion, fecha, hora } = celda.dataset;

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
  $('actualizar').addEventListener('click', async (e) => {
  e.currentTarget.disabled = true;
  await cargar({ fresco: true });
  e.currentTarget.disabled = false;
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

cargar();
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

cargar();
