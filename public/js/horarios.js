/* Pantalla de horarios. Escribe en la pestaña `horarios` de la hoja. */

const $ = id => document.getElementById(id);
const formulario = $('formulario');

let original = {};      // lo que había al cargar, para poder deshacer
let barberoActual = '';

const HORA = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/;

const aMinutos = (t) => {
  const m = String(t || '').trim().toLowerCase().match(HORA);
  if (!m) return -1;

  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;

  if (h < 1 || h > 12 || min > 59) return -1;
  if (m[3] === 'pm' && h !== 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;

  return h * 60 + min;
};

const mostrar = (id, texto) => {
  const nodo = $(id);
  nodo.textContent = texto;
  nodo.hidden = !texto;
};

const MAXIMO_POR_JORNADA = 8;   // una lista son 10 filas, 2 se van en Volver y Menú

/**
 * ⚠️ ESPEJO de `partirEnJornadas()` en src/config/barbers.js.
 *
 * El navegador no puede importar del servidor, así que la regla está escrita
 * dos veces. Si cambias una, cambia la otra: cuando se descuadraron, el panel
 * pintaba en rojo horarios que el servidor guardaba sin problema.
 *
 * La tarde se parte en tarde (hasta las 5pm) y tarde-noche SOLO si no cabe
 * entera en una lista.
 */
function algunaJornadaSePasa(turnos) {
  const enRango = (desde, hasta) => turnos.filter(t => {
    const m = aMinutos(t);
    return m >= desde && m < hasta;
  }).length;

  const manana = enRango(0, 720);
  const tarde = enRango(720, 1020);
  const tardenoche = enRango(1020, 24 * 60);

  if (manana > MAXIMO_POR_JORNADA) return true;

  // Si la tarde entera cabe, no se parte y se mide de una.
  if (tarde + tardenoche <= MAXIMO_POR_JORNADA) return false;

  return tarde > MAXIMO_POR_JORNADA || tardenoche > MAXIMO_POR_JORNADA;
}

/** Cuenta los turnos del día y avisa si una jornada no va a caber. */
function actualizarCuenta(fila) {
  const entrada = fila.querySelector('input');
  const cuenta = fila.querySelector('.dia__cuenta');

  const turnos = entrada.value.split(',').map(t => t.trim()).filter(Boolean);
  const sePasa = algunaJornadaSePasa(turnos);

  cuenta.textContent = turnos.length === 0
    ? 'descansa'
    : turnos.length + (turnos.length === 1 ? ' turno' : ' turnos');

  cuenta.classList.toggle('descansa', turnos.length === 0);
  cuenta.classList.toggle('se-pasa', sePasa);

  if (sePasa) cuenta.textContent += ' ⚠';

  const sinCambios = entrada.value.trim() === (original[entrada.dataset.dia] || '');
  fila.classList.toggle('dia--cambiado', !sinCambios);
}

function pintar({ barbero, barberos, dias, desdeLaHoja }) {
  barberoActual = barbero;

  const select = $('barbero');
  if (select.options.length !== barberos.length) {
    select.innerHTML = barberos.map(b => '<option value="' + b + '">' + b + '</option>').join('');
  }
  select.value = barbero;

  $('origen').textContent = desdeLaHoja
    ? 'Estos horarios están guardados en la hoja.'
    : 'Todavía no hay horarios guardados: estos son los que trae el sistema. Al guardar quedan en la hoja.';

  original = {};
  dias.forEach(d => { original[d.dia] = d.turnos.join(', '); });

  const filas = dias.map(d =>
    '<div class="dia" data-fila="' + d.dia + '">'
    + '<span class="dia__nombre">' + d.nombre + '</span>'
    + '<div class="dia__campo">'
    + '<input type="text" data-dia="' + d.dia + '" value="' + d.turnos.join(', ') + '"'
    + ' placeholder="vacío = no trabaja" autocomplete="off" />'
    + '<span class="dia__cuenta"></span>'
    + '</div></div>'
  ).join('');

  formulario.innerHTML = filas;

  formulario.querySelectorAll('.dia').forEach(actualizarCuenta);
}

formulario.addEventListener('input', e => {
  if (e.target.matches('input[data-dia]')) actualizarCuenta(e.target.closest('.dia'));
});

async function cargar() {
  mostrar('error', '');
  mostrar('ok', '');
  formulario.innerHTML = '<p class="agenda__cargando">Cargando…</p>';

  try {
    const respuesta = await fetch(
      '/panel/api/horarios?barbero=' + encodeURIComponent(barberoActual),
      { headers: { Accept: 'application/json' } }
    );

    if (respuesta.status === 401) { location.href = '/panel/'; return; }

    const datos = await respuesta.json();
    if (!datos.ok) { mostrar('error', datos.error); return; }

    pintar(datos);
  } catch {
    mostrar('error', 'No se pudo conectar. Revisa tu internet.');
  }
}

$('barbero').addEventListener('change', e => {
  barberoActual = e.target.value;
  cargar();
});

$('deshacer').addEventListener('click', () => {
  formulario.querySelectorAll('input[data-dia]').forEach(i => {
    i.value = original[i.dataset.dia] || '';
  });

  formulario.querySelectorAll('.dia').forEach(actualizarCuenta);
  mostrar('error', '');
  mostrar('ok', '');
});

$('guardar').addEventListener('click', async (evento) => {
  mostrar('error', '');
  mostrar('ok', '');

  const dias = {};
  formulario.querySelectorAll('input[data-dia]').forEach(i => {
    dias[i.dataset.dia] = i.value;
  });

  const cambios = Object.keys(dias).filter(d => dias[d].trim() !== (original[d] || ''));

  if (!cambios.length) {
    mostrar('ok', 'No hay nada que guardar.');
    return;
  }

  const pregunta = '¿Guardar los horarios de ' + barberoActual + '?\n\n'
    + 'Cambian ' + cambios.length + ' día(s). Los clientes lo van a ver de inmediato.';

  if (!confirm(pregunta)) return;

  const boton = evento.currentTarget;
  boton.disabled = true;
  boton.textContent = 'Guardando…';

  try {
    const respuesta = await fetch('/panel/api/horarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ barbero: barberoActual, dias }),
    });

    if (respuesta.status === 401) { location.href = '/panel/'; return; }

    const datos = await respuesta.json();

    if (!datos.ok) {
      mostrar('error', datos.error || 'No se pudo guardar.');
      return;
    }

    mostrar('ok', 'Listo. Los horarios de ' + barberoActual + ' quedaron guardados.');
    await cargar();
  } catch {
    mostrar('error', 'No se pudo conectar. Revisa tu internet.');
  } finally {
    boton.disabled = false;
    boton.textContent = 'Guardar cambios';
  }
});

document.querySelector('[data-salir]').addEventListener('click', async () => {
  await fetch('/panel/api/salir', { method: 'POST', headers: { Accept: 'application/json' } });
  location.href = '/panel/';
});

cargar();
