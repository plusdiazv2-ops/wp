# ESTADO — dónde quedó el proyecto

**Sesión del 9–10 de agosto de 2026.** Lee `CLAUDE.md` primero (reglas y cómo
funciona el sistema). Esto es solo el traspaso. Todo está en `master` y desplegado.
`npm test` → **115 pasando**.

## 1. Qué se hizo

**Horarios — se acabó la duplicación**
- `src/config/barbers.js` (nuevo): fuente única. Estaban copiados en
  `getAvailableSlots()` y `getDailyScheduleByBarber()`; se borraron 296 líneas y
  ahora las dos llaman a `obtenerTurnos()`. La pestaña `horarios` los sobrescribe.
- `src/config/fechas.js` (nuevo): `fechaVisible()` y `fechaHoraTurno()`, compartidas
  por bot y panel para que la columna B se escriba igual desde los dos lados.
- Ladino: **6:00pm–8:30pm cada 30 min** (antes 10:30am–6:20pm cada 40). Bolon ganó
  `5:00pm` y `5:30pm`; su domingo quedó vacío.

**Rediseño del chat a listas nativas** — `messageHandler.js`, ver `DISENO-FLUJO.md`
- `sendOptionList()` arma toda lista respetando el tope de 10 filas.
- `resolveChoice()` traduce igual lo tocado y lo escrito; `isFlowOption()` distingue
  una respuesta de la pantalla actual de un botón viejo del historial.
- `splitSlotsByPeriod()` + `sendPeriodOptions()`: pantalla Mañana/Tarde, que se
  **salta** si los turnos caben en una lista (8 o menos).
- Arreglados: botón viejo que descuadraba el flujo, `volver` que se guardaba como
  nombre del cliente, y silencio total ante notas de voz e imágenes.

**Estabilidad** — `googleSheetsService.js`, `entregasMeta.js`, `verifyMetaSignature.js`
- `getSheetData()` **lanza** `SheetsUnavailableError` en vez de devolver `[]`. Antes
  un fallo de Sheets se veía como "no hay nada ocupado" y se ofrecían turnos vendidos.
- Caché: auth una sola vez, hoja 20 s. **Las validaciones finales leen fresco**
  (`checkAvailability`, `countUserAppointmentsSameDay`).
- `webhookController` responde 200 **antes** de procesar, con deduplicación por
  `message.id` y descarte de mensajes de más de 15 min.
- Firma de Meta, apagada si falta `META_APP_SECRET`.

**Panel web `/panel`** — `panelRoutes.js`, `accesoPanel.js`, `sesionPanel.js`,
`requiereSesion.js`, `agendaSemana.js`, `validarHorarios.js`, `src/views/`
- Se entra escribiéndole `acceso` al bot → código de 6 dígitos → cookie firmada 30 días.
- `/panel/agenda`: semana en cuadrícula, tocar un turno libre lo bloquea.
  `/panel/horarios`: editar jornadas, validando antes de escribir.
- `bloquearHorario()`, `desbloquearHorario()`, `guardarHorarios()`,
  `cancelarTurnoDeCliente()` + `filaCoincideConTurno()` — todas verifican la fila
  antes de escribir, para no tocarle el turno a otro cliente.

**Web pública** (`public/`): presentación, HTML y CSS puros, sin build.
**Secretos fuera del código**: contraseñas en `PASSWORD_BOLON/_JULIAN/_LADINO/_PRUEBA`.
`tests/secretos.test.js` falla si alguien vuelve a escribir una en `src/`.

## 2. Decisiones y qué se descartó

- **React + Vite + Tailwind → NO.** Habría metido un paso de build y ~200 MB de
  dependencias en la misma app que atiende clientes.
- **App móvil → NO.** La opción más cara ($25 Play, $99/año Apple) y aun así necesita
  el servidor.
- **Postgres → todavía no.** Sheets aguanta. Cuando duela: Neon o Supabase gratis,
  **no** el de Railway (consume del crédito de $5).
- **Corte mañana/tarde en el almuerzo → NO, se corta a las 12:00.** El miércoles
  Julian trabaja seguido sin almuerzo y no habría dónde cortar.
- **Pantalla de gestión de admins → NO.** Para dos personas basta con los números
  separados por coma en `ADMIN_PRINCIPAL`.
- **Tiempo real en el panel → NO.** Se actualiza al volver a la pestaña y cada 30 s
  solo si está visible. Cubre casi todo con mucha menos maquinaria.
- ~~**Botón al panel en la web pública → NO.**~~ Revertido el 17 de agosto: hay botón
  en la portada y el código se pide desde la web (ver `CLAUDE.md`).

## 3. Probado y funcionando

Agendar completo con los 4 barberos (día normal y miércoles), cancelar, panel del
barbero, `acceso` y entrar al panel web, ver agenda, bloquear y liberar, editar
horarios y verlos reflejados en el bot, horario nuevo de Ladino, contraseñas por
variable. **Sin probar:** solo lo que depende de tener las fotos.

## 4. Pendiente, en orden

1. **Apagar el barbero de prueba** — `testBarberEnabled = false` en el constructor de
   `messageHandler.js`. Sigue en `true` y los clientes reales lo ven.
2. **Fotos de los barberos** — cierran la Fase 2. `sendMediaMessage()` ya existe sin
   usar. Van commiteadas a `public/img/` (Railway borra lo que la app escriba).
3. **Dos avisos en texto plano** — en el paso `time` de `handleAppointmentFlow`
   ("ya tienes 2 turnos" y "ese horario ya fue tomado") siguen con
   `buildNavigationFooter()`. Última inconsistencia visual del rediseño.
4. **Limpieza** (no borrar sin confirmar): `handleNavigationNumber`,
   `getNavigationNumber`, `generateAvailableSlots`, `formatAppointmentsList`,
   `sendLocation`, `isSlotAvailable`, `getBookedSlots`,
   `getAppointmentsByBarberAndDate`, y el flujo de IA (`assistantState` nunca se activa).
5. Puntos 5 y 9 de `MEJORAS.md`. Nunca han fallado.

## 5. Trampas que no se ven leyendo el código

- **La pestaña `horarios` le gana a `config/barbers.js`.** Si un cambio "no se ve",
  casi siempre es eso. Hay caché de 5 min: el panel lo limpia al guardar, editar la
  hoja a mano no.
- **Cambiar el dominio en Railway deja el webhook de Meta apuntando a la nada, sin
  ninguna alerta.** Pasó el 10 de agosto: horas con el bot mudo. El servicio responde,
  la web se ve, los logs se ven normales y no llega nada.
- **La columna J de un bloqueo va en `Sí`.** Con `No`, el cron de recordatorios
  intentaría mandar WhatsApp a un teléfono vacío cada 5 minutos.
- **El HTML protegido vive en `src/views/`, no en `public/`.** Ahí cualquiera lo
  abriría saltándose el login.
- **`env.js` lee `process.env` una sola vez al arrancar.** Cambiar una variable en
  ejecución no tiene efecto; por eso un test de sesión pasaba por la razón equivocada.
- **`BUSINESS_PHONE` es el identificador interno de Meta (16 dígitos), no el teléfono.**
  Para un enlace `wa.me` sirve `573216981441`.
- **Los heredocs de bash aquí colapsan las barras invertidas.** Un `\n` dentro de un
  heredoc se vuelve salto de línea real y rompe el JavaScript. Usa `chr(92)` desde
  Python o evita los escapes.
