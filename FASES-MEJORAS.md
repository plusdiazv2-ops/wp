# Fases de mejora — Chatbot Exclusive Barber

> Control de las mejoras del bot. **Se actualiza con cada cambio.**
> Detalle técnico de cada cosa: `CLAUDE.md`. Historia completa: `git log`.
>
> Última actualización: **5 de noviembre de 2026** (Fase 2 en pausa por Meta)

## Resumen

| Fase | Qué | Estado |
|---|---|---|
| 0 | Blindaje contra fallos silenciosos | ✅ En producción |
| 1 | Festivos y ajustes | ✅ En producción |
| 2 | Agendar con formulario de WhatsApp (Flows) | ⏸️ Listo, pero Meta lo bloquea (falta verificar el negocio) |
| 3 | Base de datos real (salir de Google Sheets) | 🔜 Por decidir |
| 4 | IA de rescate | 🔜 Pendiente |
| 5 | Crecimiento (campañas, reseñas, pagos) | 🔜 Pendiente |

Leyenda: ✅ hecho · ⏳ en curso o esperando algo · ⏸️ en pausa · 🔜 pendiente · ❌ descartado

---

## Antes de las fases (octubre – noviembre 2026)

| Fecha | Cambio |
|---|---|
| 28 oct | ✅ Panel web para Julián: entra con su número del bot y solo ve lo suyo |
| 28 oct | ✅ Bloquear día, Liberar día y Seleccionar varios en la agenda |
| 28 oct | ✅ Arreglado el botón ⟳ Actualizar de la agenda (no funcionaba) |
| 4 nov | ✅ Resuelto: Meta bloqueaba las plantillas por un cobro fallido a la tarjeta (código 131042). Se pagó Exclusive y Alta Gama |
| 4 nov | ✅ Barbero de prueba **encendido** (se queda así mientras haya pruebas) |

---

## Fase 0 — Blindaje (no se ve, evita desastres) ✅

Desplegada el **4 de noviembre de 2026**.

- ✅ **Alertas** al desarrollador por correo (Resend) y WhatsApp (3137127100).
  Freno: la misma alerta, una vez cada 6 horas.
- ✅ **Alerta cuando Meta no entrega un mensaje** (como el 131042 del pago).
- ✅ **Recordatorio rechazado vuelve a `No`** en la hoja (antes quedaba "Sí").
- ✅ **Vigilancia cada 15 min**: número conectado, app suscrita, y que lleguen
  mensajes (4 h de silencio en horario de atención = alerta).
- ✅ **`/salud`**: dice bien o mal, para un monitor externo.
- ✅ **Traba**: recordatorios y vigilancia solo corren en Railway.
- ✅ **Botón «🚨 Probar alertas»** en el panel (solo admin principal). Probado: llegan correo y WhatsApp.
- ✅ **Columna K = @usuario de WhatsApp.** Si el cliente esconde su número, se
  muestra `@usuario` en el panel, la agenda del barbero y el aviso de turno nuevo.

## Fase 1 — Festivos y ajustes ✅

Desplegada el **5 de noviembre de 2026**.

- ✅ **Festivos de Colombia** calculados solos (fijos, Ley Emiliani, Pascua).
  **Se atiende normal**, solo se marcan:
  - Cliente: «Lunes 16 de noviembre · 🇨🇴 Festivo · 12 turnos libres».
  - Barbero por WhatsApp: «🇨🇴 *Festivo:* Independencia de Cartagena».
  - Panel web: título **FESTIVO** y botón resaltado **«Bloquear festivo»**
    (opcional: el barbero decide si trabaja). Los días normales no cambian.
- ✅ **El recordatorio dice «Juli»** y no el nombre interno.
- ❌ Recordatorio con botones Confirmo / Cancelar — *descartado*: quien quiera
  cancelar usa el menú (opción 2), como siempre.
- ❌ Segundo recordatorio 24 h antes — *descartado*: solo 1 hora antes.
- ❌ Aviso al barbero sin plantilla — *descartado*: con los precios de Meta de
  octubre 2026 el ahorro es mínimo y agrega riesgo.
- ❌ Medir mensajes por código — *no hace falta*: Meta lo muestra en
  Administrador de WhatsApp → Estadísticas.

## Fase 2 — Agendar con formulario de WhatsApp (Flows) ⏳

**Por qué:** desde el 1 de octubre de 2026 Meta cobra los mensajes normales
pasados 1.000 al mes. Hoy agendar son 6–8 mensajes; con el formulario, 3.

Aprobado el 5 nov: pantallas nombre/barbero → fecha → hora → confirmar,
«lista» como respaldo, y arrancar **solo con Prueba** (número 3137127100).

- ✅ Código construido y probado (225 tests + simulación completa): cifrado,
  ruta `/flows`, las 4 pantallas con las mismas reglas del flujo de listas,
  «lista» como respaldo, interruptor `FORMULARIO_AGENDAR = 'prueba'`.
- ✅ Desplegado el 5 nov (apagado hasta tener las dos variables).
- ✅ `FLOW_PRIVATE_KEY` en Railway, en una sola línea (base64): pegada en varias
  líneas, Railway la dañaba. Meta ya tiene la llave pública.
- ✅ Formulario creado en Administrador de WhatsApp → Flows: **`agendar_turno`**,
  id **1493138499295579**, en **borrador**, conectado a la app *Exclusive Barber*,
  dirección `https://exclusivebarber.up.railway.app/flows`. Comprobación de estado: ✅ activo.
- ✅ `FLOW_ID` puesto en Railway.
- ⏸️ **Probado el 5 nov: Meta lo rechaza con el error 139000 «Blocked by
  Integrity»** («Integrity requirements not met»). No es el código: Meta tiene
  la cuenta con restricciones para Flows (negocio sin verificar, número
  re-registrado hace poco, cobros fallidos). Rastreo de Meta: `AFwEvDH1C1nxuyrfm6hj7-m`.
- ✅ Respaldo: si Meta rechaza el formulario, el bot sigue con las listas. Los
  clientes no notan nada (además el formulario solo está encendido para el 3137127100).
- ⏳ **Para destrabarlo:** verificar el negocio en Meta (Configuración del
  negocio → Centro de seguridad). Si sigue, caso a soporte de Meta con el 139000.
  Después: volver a probar desde el 3137127100 — no hay que programar nada más.
- 🔜 Publicar el formulario y pasar a `'todos'` cuando el dueño diga.
  ⚠️ **Meta exige la verificación del negocio para publicar un Flow.** En
  borrador solo sirve para pruebas. Para todos los clientes hay que verificar
  el negocio en Meta Business (Configuración del negocio → Centro de seguridad).

## Fase 3 — Base de datos real 🔜

Salir de Google Sheets a Postgres: la doble reserva queda imposible y se acaban
las celdas que cambian de formato solas. Aquí se decide:
- **A.** Mudarse al sistema de Alta Gama, o
- **B.** Pasar solo los datos del bot actual.

## Fase 4 — IA de rescate 🔜

Entender «el sábado con Juli a las 3», responder precios y preguntas
frecuentes. Nunca escribe en la agenda. Permitido por la política de Meta de
2026 (IA para una función del negocio).

## Fase 5 — Crecimiento 🔜

- ⏳ Plantilla de marketing **`promo_turnos_semana`** — creada el 4 nov, en revisión de Meta.
  Para enviarla falta la lista de clientes (descargar la pestaña `barber` en .csv).
  Enviar en grupos pequeños y cuidar la calidad del número.
- 🔜 Pedir reseña en Google después del corte.
- 🔜 Botón de reservar en el perfil de Google.
- 🔜 Anticipo por Wompi para quien falta seguido.
- 🔜 Dominio propio, coexistencia app + API, más barberías.

---

## Del chatbot Alta Gama: qué se trae (aprobado el 4 nov)

| Cosa | Decisión | Estado |
|---|---|---|
| Vigilancia, `/salud`, alertas con freno | Traer | ✅ Fase 0 |
| Traba de tareas de fondo | Traer | ✅ Fase 0 |
| Monitor externo (UptimeRobot) | Traer | ⏳ Lo configura el dueño |
| Festivos de Colombia | Traer | ✅ Fase 1 |
| Postgres + índice contra doble reserva | Traer | 🔜 Fase 3 |
| IA de rescate + precios y preguntas frecuentes | Traer | 🔜 Fase 4 |
| Textos del bot en un solo archivo | Traer de a poco, sin cambiar textos | 🔜 |
| Dominio propio, verificación de empresa, Tech Provider | Dejar | 🔜 Fase 5 |
| BSUID, firma, 200 primero, duplicados, listas de 10, roles, tope de 2 | Ya los tenía | ✅ |
| Contraseñas scrypt para el panel | Descartar (el código por WhatsApp es mejor) | ❌ |
| Trato de «usted» | Descartar (la voz de Exclusive es de «tú») | ❌ |
| n8n, Meta Business Agent, APIs no oficiales | Descartados | ❌ |

---

## Pendientes del dueño (no son código)

- [ ] **UptimeRobot**: monitor a `https://exclusivebarber.up.railway.app/salud` con aviso al correo.
- [ ] **Borrar la plantilla `numero_de_vuelta`** cuando salga de revisión
      (Administrar plantillas → Editar plantilla → Eliminar plantilla).
- [ ] Título **`Usuario`** en la celda **K1** de la pestaña `barber`, si no está.
- [ ] Escribirle «hola» al bot desde el 3137127100 de vez en cuando
      (las alertas por WhatsApp solo llegan dentro de 24 h).
- [ ] **Apagar el barbero de prueba** cuando terminen las pruebas (los clientes lo ven).
- [ ] Mirar el gasto en **Administrador de WhatsApp → Estadísticas** para decidir la Fase 2.
- [ ] Poner **`FLOW_ID`** = `1493138499295579` en Railway.
- [ ] **Borrar del Escritorio** `FLOW_PRIVATE_KEY.txt` y `FLOW_PRIVATE_KEY_una_linea.txt`.
- [ ] Poner **`META_APP_SECRET`** en Railway (hoy la firma del webhook está apagada).
- [ ] **Verificar el negocio en Meta** — destraba el formulario (error 139000) y da más cupo de mensajes.

## Datos útiles

- **Precios de Meta** (desde el 1 oct 2026): mensajes normales gratis hasta
  1.000 al mes por número; las plantillas se cobran; marketing es lo más caro.
- **Quién entra al panel**: `ADMIN_PRINCIPAL` (tú y Bolón, ven todo) y cada
  barbero activo con su número del bot (ve solo lo suyo).
- **Alertas**: correo esdege021@gmail.com (Resend) y WhatsApp 3137127100.
