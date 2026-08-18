/* Pantalla de entrar al panel. Dos pasos: el número y después el código. */

// El mismo de inicio.js. Ojo: BUSINESS_PHONE es el identificador interno de
// Meta y no sirve para un enlace wa.me.
const NUMERO_WHATSAPP = '573216981441';

const formulario = document.getElementById('formulario');
const error = document.getElementById('error');
const aviso = document.getElementById('aviso');
const porWhatsapp = document.getElementById('por-whatsapp');

const pasoNumero = formulario.querySelector('[data-paso="numero"]');
const pasoCodigo = formulario.querySelector('[data-paso="codigo"]');

const botonPedir = formulario.querySelector('[data-pedir]');
const botonEntrar = formulario.querySelector('button[type="submit"]');
const botonOtroNumero = formulario.querySelector('[data-otro-numero]');

const mostrarError = (texto) => {
  error.textContent = texto;
  error.hidden = false;
};

const limpiarError = () => { error.hidden = true; };

/**
 * Se escribe sin el 57. Si el celular lo autocompleta con el 57 delante, se
 * le quita en vez de cortar el número por la mitad.
 */
const soloCelular = (valor) => {
  let digitos = String(valor).replace(/\D/g, '');

  if (digitos.length > 10 && digitos.startsWith('57')) digitos = digitos.slice(2);

  return digitos.slice(0, 10);
};

formulario.telefono.addEventListener('input', (e) => {
  e.target.value = soloCelular(e.target.value);
});

formulario.codigo.addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
});

// En el paso del número, Enter manda a pedir el código; el submit del
// formulario es el "Entrar" del paso siguiente.
formulario.telefono.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    pedirCodigo();
  }
});

/** Pasa al paso del código. `textoAviso` solo aparece cuando el envío rebotó. */
const mostrarPasoCodigo = ({ textoAviso = '', conEnlace = false } = {}) => {
  pasoNumero.hidden = true;
  pasoCodigo.hidden = false;

  aviso.textContent = textoAviso;
  aviso.hidden = !textoAviso;

  if (conEnlace) {
    porWhatsapp.href = `https://wa.me/${NUMERO_WHATSAPP}?text=${encodeURIComponent('acceso')}`;
  }
  porWhatsapp.hidden = !conEnlace;

  formulario.codigo.focus();
};

botonOtroNumero.addEventListener('click', () => {
  limpiarError();

  pasoCodigo.hidden = true;
  pasoNumero.hidden = false;

  formulario.codigo.value = '';
  formulario.telefono.focus();
});

/** Paso 1: pedir el código. */
async function pedirCodigo() {
  limpiarError();

  const telefono = soloCelular(formulario.telefono.value);

  if (telefono.length !== 10) {
    mostrarError('Escribe tu número de WhatsApp: 10 dígitos, sin el 57.');
    return;
  }

  botonPedir.disabled = true;
  botonPedir.textContent = 'Enviando…';

  try {
    const respuesta = await fetch('/panel/api/codigo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({ telefono }),
    });

    const datos = await respuesta.json();

    if (datos.ok) {
      mostrarPasoCodigo();
      return;
    }

    // Meta no dejó mandarlo (pasaron más de 24 horas desde el último mensaje
    // del barbero, casi siempre). No es un error: se le ofrece el camino de
    // siempre, que además reabre esa ventana.
    if (datos.motivo === 'pedir_por_whatsapp') {
      mostrarPasoCodigo({
        textoAviso: `${datos.aviso} Pídelo con el botón de abajo y escríbelo aquí.`,
        conEnlace: true,
      });
      return;
    }

    mostrarError(datos.error || 'No se pudo enviar el código.');
  } catch {
    mostrarError('No se pudo conectar. Revisa tu internet e intenta de nuevo.');
  } finally {
    botonPedir.disabled = false;
    botonPedir.textContent = 'Enviar código';
  }
}

botonPedir.addEventListener('click', pedirCodigo);

/** Paso 2: entrar con el código. */
formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  limpiarError();

  const telefono = `57${soloCelular(formulario.telefono.value)}`;
  const codigo = formulario.codigo.value.trim();

  if (codigo.length !== 6) {
    mostrarError('Escribe el código de 6 dígitos.');
    return;
  }

  botonEntrar.disabled = true;
  botonEntrar.textContent = 'Entrando…';

  try {
    const respuesta = await fetch('/panel/api/entrar', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({ telefono, codigo }),
    });

    const datos = await respuesta.json();

    if (datos.ok) {
      location.href = datos.destino || '/panel/inicio';
      return;
    }

    mostrarError(datos.error || 'No se pudo entrar.');
    formulario.codigo.value = '';
    formulario.codigo.focus();
  } catch {
    mostrarError('No se pudo conectar. Revisa tu internet e intenta de nuevo.');
  } finally {
    botonEntrar.disabled = false;
    botonEntrar.textContent = 'Entrar';
  }
});
