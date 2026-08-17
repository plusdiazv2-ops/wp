import { leerCookie, leerSesion, NOMBRE_COOKIE } from '../services/sesionPanel.js';

/**
 * Protege las rutas del panel. Sin cookie válida no se pasa.
 *
 * Deja el número en `req.admin` para que las rutas sepan quién entró.
 */
export function requiereSesion(req, res, next) {
  const sesion = leerSesion(leerCookie(req, NOMBRE_COOKIE));

  if (!sesion) {
    // Las rutas de datos siempre responden JSON, aunque quien llame no lo
    // pida: un 302 a una API es confuso y esconde el motivo real.
    const esApi = req.path.includes('/api/')
      || req.get('Accept')?.includes('application/json');

    if (esApi) {
      return res.status(401).json({ ok: false, error: 'sin_sesion' });
    }

    return res.redirect('/panel/');
  }

  req.admin = { telefono: sesion.tel, expira: sesion.exp };

  return next();
}

export default requiereSesion;
