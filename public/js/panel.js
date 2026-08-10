/* Pantalla de entrar al panel. */

const formulario = document.getElementById('formulario');
const error = document.getElementById('error');
const boton = formulario.querySelector('button[type="submit"]');

const mostrarError = (texto) => {
  error.textContent = texto;
  error.hidden = false;
};

// Solo dígitos, para que "+57 300 111 2233" también sirva.
formulario.telefono.addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/[^\d+ ]/g, '');
});

formulario.codigo.addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
});

formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  error.hidden = true;

  const telefono = formulario.telefono.value.replace(/\D/g, '');
  const codigo = formulario.codigo.value.trim();

  if (!telefono || codigo.length !== 6) {
    mostrarError('Escribe tu número completo y el código de 6 dígitos.');
    return;
  }

  boton.disabled = true;
  boton.textContent = 'Entrando…';

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
    boton.disabled = false;
    boton.textContent = 'Entrar';
  }
});
