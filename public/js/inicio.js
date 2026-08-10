/* ═══════════════════════════════════════════════════════════
   Exclusive Barber — lo mínimo de JavaScript
   ═══════════════════════════════════════════════════════════ */

// ⚠️ PENDIENTE: el número de WhatsApp al que ESCRIBEN LOS CLIENTES,
// con código de país y sin signos. Ejemplo: 573001112233
//
// No es el mismo BUSINESS_PHONE del .env: ese es el identificador
// interno de Meta (16 dígitos), no sirve para un enlace wa.me.
const NUMERO_WHATSAPP = '573146926477';

const SALUDO = 'Hola, quiero agendar un turno';

// Todos los botones "Agendar turno" apuntan al chat con el saludo escrito.
document.querySelectorAll('[data-whatsapp]').forEach(boton => {
  boton.href = `https://wa.me/${NUMERO_WHATSAPP}?text=${encodeURIComponent(SALUDO)}`;
  boton.target = '_blank';
  boton.rel = 'noopener';
});

// Año del pie, para no tener que acordarse de cambiarlo
document.querySelectorAll('[data-anio]').forEach(nodo => {
  nodo.textContent = new Date().getFullYear();
});

// Las secciones aparecen al entrar en pantalla
const observador = new IntersectionObserver(
  entradas => {
    entradas.forEach(entrada => {
      if (!entrada.isIntersecting) return;

      entrada.target.style.opacity = '1';
      entrada.target.style.transform = 'none';
      observador.unobserve(entrada.target);
    });
  },
  { threshold: 0.12 }
);

document.querySelectorAll('.seccion').forEach(seccion => {
  seccion.style.opacity = '0';
  seccion.style.transform = 'translateY(24px)';
  seccion.style.transition = 'opacity 700ms cubic-bezier(0.4,0,0.2,1), transform 700ms cubic-bezier(0.4,0,0.2,1)';
  observador.observe(seccion);
});
