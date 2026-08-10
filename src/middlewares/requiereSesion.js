import { leerCookie, leerSesion, NOMBRE_COOKIE } from '../services/sesionPanel.js';

/**
 * Protege las rutas del panel. Sin cookie válida no se pasa.
 *
 * Deja el número en `req.admin` para que las rutas sepan quién entró.
 */
export function requiereSesion(req, res, next) {
  const sesion = leerSesion(leerCookie(req, NOMBRE_COOKIE));

  if (!sesion) {
    // A las llamadas del navegador se les responde JSON; a la navegación
    // normal se la manda a la pantalla de entrar.
    if (req.get('Accept')?.includes('application/json')) {
      return res.status(401).json({ ok: false, error: 'sin_sesion' });
    }

    return res.redirect('/panel/');
  }

  req.admin = { telefono: sesion.tel, expira: sesion.exp };

  return next();
}

export default requiereSesion;
