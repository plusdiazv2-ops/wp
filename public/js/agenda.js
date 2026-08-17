/* Agenda de la semana. Solo muestra: no escribe nada todavía. */

const $ = id => document.getElementById(id);
const tabla = $('tabla');
const aviso = $('aviso');

let estado = { barbero: '', lunes: '' };

const mostrarAviso = (texto) => {
  aviso.textContent = texto;
  aviso.hidden = !texto;
};

async function cargar() {
  const parametros = new URLSearchParams();
  if (estado.barbero) parametros.set('barbero', estado.barbero);
  if (estado.lunes) parametros.set('desde', estado.lunes);

  tabla.innerHTML = '<caption class="agenda__cargando">Cargando…</caption>';

  let datos;
  try {
    const respuesta = await fetch('/panel/api/agenda?' + parametros, {
      headers: { Accept: 'application/json' },
    });

    // La sesión venció mientras estaba abierto.
    if (respuesta.status === 401) { location.href = '/panel/'; return; }

    datos = await respuesta.json();
  } catch {
    tabla.innerHTML = '';
    mostrarAviso('No se pudo conectar. Revisa tu internet.');
    return;
  }

  if (!datos.ok) {
    tabla.innerHTML = '';
    mostrarAviso(datos.error || 'No se pudo cargar la agenda.');
    return;
  }

  mostrarAviso('');
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

      if (turno.estado === 'ocupado') {
        return `<td class="celda celda--ocupado" title="${turno.nombre} · ${turno.telefono}">
          <span class="celda__nombre">${turno.nombre || 'Ocupado'}</span>
          <span class="celda__tel">${turno.telefono}</span>
        </td>`;
      }

      return '<td class="celda celda--libre"></td>';
    }).join('');

    return `<tr><th class="hora">${hora}</th>${celdas}</tr>`;
  }).join('');

  tabla.innerHTML = `
    <thead><tr><th class="hora"></th>${encabezado}</tr></thead>
    <tbody>${filas}</tbody>`;
}

$('barbero').addEventListener('change', e => {
  estado.barbero = e.target.value;
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
