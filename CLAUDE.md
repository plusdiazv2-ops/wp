# CLAUDE.md — Chatbot Exclusive Barber

> Lee este archivo completo antes de tocar cualquier cosa.

## ⚠️ ESTO ESTÁ EN PRODUCCIÓN REAL

Este chatbot atiende clientes reales de la barbería **Exclusive Barber** (Manizales)
todos los días. Tres barberos dependen de él para su agenda. Un error aquí
significa turnos perdidos o clientes que no pueden agendar.

**Reglas no negociables:**

1. **Nunca trabajes sobre la rama principal.** Aquí se llama **`master`** (no `main`).
   Siempre rama nueva: `git checkout -b fix/lo-que-sea`
2. **Nunca reescribas un archivo completo.** Solo ediciones puntuales sobre las
   líneas que hay que cambiar. Si crees que hace falta reescribir un archivo,
   pregúntame primero y explícame por qué.
3. **Nunca borres una función que no te pedí borrar**, aunque parezca código muerto.
   Si detectas código muerto, dímelo en una lista aparte; no lo elimines por tu cuenta.
4. **Nunca cambies los `id` ni los `title` de los botones interactivos** sin avisar.
   Ya se rompió el bot antes por esto.
5. **Nunca cambies los textos de los mensajes al cliente** salvo que te lo pida
   explícitamente. Los emojis y el formato son parte de la marca.
6. **Nunca cambies el nombre ni el orden de las columnas de Google Sheets.**
   Hay datos históricos reales ahí.
7. Después de cada cambio, dime **exactamente qué probar en WhatsApp** para verificar.

---

## Qué es el sistema

Tres cosas en un solo proceso de Node, en la misma URL de Railway:

1. **El bot de WhatsApp** — clientes agendan y cancelan; los barberos consultan
   su agenda del día. Es lo principal y lo que no se puede romper.
2. **La web pública** (`/`) — presentación de la barbería. Archivos estáticos.
3. **El panel de administración** (`/panel`) — ver la agenda de la semana,
   bloquear horarios y editar las jornadas. Solo el desarrollador y Bolon.

**Stack:** Node.js (ESM) · WhatsApp Cloud API (Meta) · Google Sheets como base de
datos · Railway como hosting · Gemini (asistente IA, actualmente desconectado del menú)

**Sin dependencias nuevas desde abril:** ni framework de front, ni base de datos,
ni librería de sesiones, ni corredor de tests. `npm test` usa el de Node.

⚠️ **Los tres comparten proceso.** Un error que tumbe el servidor deja sin bot a
la barbería, no solo sin web. Las rutas del webhook van primero en `app.js` a
propósito.

## Estructura

```
src/
├── app.js                      # servidor: webhook + web + panel
├── config/
│   ├── env.js                  # TODAS las variables de entorno
│   ├── barbers.js              # ⭐ horarios por defecto, fuente única
│   └── fechas.js               # formatos de fecha de la hoja
├── controllers/webhookController.js
├── middlewares/
│   ├── verifyMetaSignature.js  # firma del webhook
│   └── requiereSesion.js       # protege /panel
├── routes/
│   ├── webhookRoutes.js
│   └── panelRoutes.js          # todo el panel
├── services/
│   ├── messageHandler.js       # ⭐ TODA la lógica conversacional
│   ├── whatsappService.js      # envoltorio de la API de Meta
│   ├── googleSheetsService.js  # persistencia, caché y bloqueos
│   ├── entregasMeta.js         # defensa contra reenvíos de Meta
│   ├── accesoPanel.js          # códigos de acceso al panel
│   ├── sesionPanel.js          # cookie firmada del panel
│   ├── agendaSemana.js         # arma la semana del panel
│   ├── validarHorarios.js      # revisa un horario antes de guardarlo
│   ├── geminiAiService.js
│   └── reminderService.js      # cron de recordatorios
├── views/                      # HTML del panel (fuera de public/ a propósito)
└── httpRequest/sendToWhatsApp.js

public/                         # web pública: la sirve express.static
├── index.html · legal/ · panel/index.html
└── css/ · js/ · img/

tests/                          # `npm test`, sin dependencias
```

**Ojo con `src/views/`:** el HTML del panel vive ahí y **no** en `public/`.
Si estuviera en `public/`, cualquiera podría abrirlo saltándose el login.

## Los barberos

`Bolon`, `Julian`, `Ladino` — definidos en `messageHandler.js` (`this.barbers`,
`this.barberPhones`, `this.barberAdmins`, `this.adminPhones`).

### 🧪 Y un cuarto, `Prueba`, hoy APAGADO

Barbero de pruebas del desarrollador (`573137127100`). Su contraseña sale de
`PASSWORD_PRUEBA`, como la de los demás.

Todo cuelga de un interruptor en el constructor:

```js
this.testBarberEnabled = false;   // en true vuelve a aparecer en todo
```

**Desde el 26 de agosto de 2026 está en `false`**, que es como debe quedarse
mientras nadie pida lo contrario: ⚠️ **encendido, los clientes reales lo ven en
la lista de barberos y pueden agendarse con él.**

Apagado, el `573137127100` también **deja de ser admin**: pierde el panel del
barbero por WhatsApp y el permiso de saltarse el tope de 2 turnos al día. El
panel **web** no depende de esto (sale de `ADMIN_PRINCIPAL`) y sigue igual.

Su horario está en `config/barbers.js` y puede quedarse ahí aunque esté
apagado: si no está en la lista de barberos, nadie llega hasta él.

Encendido tiene el permiso `canSeeAll`, que **no tienen los demás**: al entrar
con su contraseña primero escoge de cuál barbero ver la agenda, y dentro del
panel gana una opción 5 para cambiar de barbero sin salir.

⚠️ Si quedaron turnos agendados con `Prueba`, apagarlo **no los borra**, pero
sí los esconde del panel: la lista de barberos del panel sale de aquí. Siguen
en la hoja, el cliente puede cancelarlos y el recordatorio les llega igual.

### Dónde viven los horarios

Hasta agosto de 2026 estaban **copiados** en dos funciones de
`googleSheetsService.js`, y cambiar una y olvidar la otra hacía que el cliente
y el barbero vieran cosas distintas. **Eso ya no es así.** Ahora hay dos capas:

1. **`src/config/barbers.js`** — los horarios por defecto. Fuente única: las dos
   funciones leen de aquí, es imposible que difieran.
2. **Pestaña `horarios` de la hoja** — si existe, **manda sobre el código**.

Lo normal es cambiarlos desde **el panel web** (`/panel/horarios`), que escribe
en esa pestaña. Tocar `barbers.js` solo hace falta para cambiar el respaldo.

⚠️ **Si un cambio de horario "no se ve", casi siempre es la pestaña.** El código
puede decir una cosa y la pestaña otra — y gana la pestaña. Y hay un caché de
5 minutos (que el panel limpia solo al guardar, pero editar la hoja a mano no).

Reglas por barbero (resumen — la fuente de verdad es el código):
- **Bolon:** miércoles solo tarde; resto del día completo. Domingo vacío, igual que
  los otros dos. El último turno de la mañana es **11:55am** y el primero de la tarde **1:30pm**
  (o sea: 11:55am sí se ofrece; el almuerzo empieza después de ese turno).
  🕕 **Refuerzo temporal (agosto 2026):** cierra a las **6:30pm**, no a las 5:30pm.
  Son dos turnos de más, `6:00pm` y `6:30pm`, todos los días menos domingo. Para
  volver a la normalidad se quitan de `BOLON_TARDE` **y de la pestaña `horarios`**.
  Es lo que obligó a partir la tarde en dos jornadas (ver abajo).
- **Julian:** no trabaja domingos; martes hasta 4:40pm; resto hasta 5:20pm.
  El miércoles trabaja jornada corta — **hasta la 1:00pm**, no "solo mañana":
  la lista incluye 12:20pm y 1:00pm.
- **Ladino:** no trabaja domingos. Desde el **10 de agosto de 2026 atiende solo de
  noche**: de 6:00pm a 8:30pm, cada 30 min (el último termina a las 9pm). Antes hacía
  jornada completa de 10:30am a 6:20pm cada 40 min — puede haber turnos históricos en
  ese horario viejo.

## Flujo del cliente

```
"hola" → menú con 3 botones
  1️⃣ Agendar turno → nombre → barbero → fecha → [jornada] → hora → confirmación
  2️⃣ Cancelar turno → lista de turnos próximos → confirmar
  3️⃣ Ubicación → mapa + contacto
```

Al confirmar: guarda fila en Sheets → envía template `nuevo_turno_barbero` al
barbero → envía confirmación al cliente.

### Las pantallas son listas nativas, no texto con números

Desde el rediseño de agosto 2026 (ver `DISENO-FLUJO.md`), el cliente **toca** las
opciones. Sigue funcionando escribir el número: **va visible en cada fila** y la
convención de siempre se conserva.

| Pantalla | Tipo |
|---|---|
| Menú principal | Botones (3) |
| Nombre | Texto libre |
| Barbero · Fecha · Hora · Cancelar · Panel | **Lista** |
| Jornada · Confirmar cancelación | Botones (jornada pasa a **lista** si hay 3) |

**El paso de jornada (Mañana/Tarde) no siempre aparece.** Existe solo porque los
turnos no caben en una lista. Si caben todos (8 o menos), se salta y el cliente ve
mañana y tarde en sentido de secciones dentro de una misma lista.

**Y hay una tercera jornada, 🌙 Tarde-noche, que tampoco aparece siempre.** La tarde
se parte a las **5pm** solo cuando no cabe entera en una lista. Hoy únicamente le pasa
a Bolon, que tiene 10 turnos de tarde; Julian y Ladino caben de sobra y siguen viendo
dos jornadas con botones, exactamente igual que antes.

⚠️ **La decisión se toma con el horario COMPLETO del día, no con los turnos libres.**
Al revés —que fue como salió la primera vez— el bloque aparecía y desaparecía según
cuánta gente hubiera agendado: con dos turnos tomados los 8 restantes volvían a caber
y se fusionaban. Por eso `sendPeriodOptions` guarda `state.slotsDelDia`. Cuando son tres, la pantalla se
manda como **lista**: Meta admite 3 botones y el de Volver sería el cuarto.

⚠️ **La regla de reparto está en `config/barbers.js` (`partirEnJornadas`), no en
`messageHandler`.** El panel la necesita igual para saber si un horario cabe antes de
guardarlo. Tenerla en dos sitios es exactamente lo que rompió los horarios en su día.

Y hay **un espejo inevitable**: `public/js/horarios.js` la repite para pintar el aviso
en rojo mientras el barbero escribe, porque el navegador no puede importar del
servidor. Si cambias una, cambia la otra — ya pasó que el panel marcaba en rojo un
horario que el servidor guardaba sin problema.

⚠️ **Tope de 10 filas por lista.** Pasarse hace que Meta rechace el mensaje entero y
el cliente **no recibe nada** — no es que se vea feo, es que no llega. Por eso toda
lista se arma con `sendOptionList()`, que cuenta las filas, sacrifica la de "Menú
principal" si sobra, y deja aviso en los logs. **No armes listas por fuera de ahí.**

**Identificadores:** con nombre, no números sueltos — `barbero_bolon`, `fecha_2026-08-10`,
`hora_5:00pm`, `nav_volver`, `panel_hoy`. Eso es lo que permite distinguir una respuesta
de la pantalla actual de un botón viejo del historial (`isFlowOption()`).
Los del menú principal siguen siendo `1`, `2`, `3`.

**Navegación global** — estado real hoy:

- Escribir `menu` → vuelve al inicio. **Funciona siempre**, incluso dentro del
  panel del barbero (lo saca del panel al menú de cliente sin avisarle).
- Escribir `volver` o `atras` → paso anterior. Funciona en **todos** los pasos del
  cliente, incluido el del nombre (arreglado en agosto 2026). **No** funciona en el
  panel del barbero.
- Escribir `cancelar` o `salir` → abandona el flujo. Funciona en los flujos de cliente.
  En el panel del barbero, `salir` funciona como opción 4, pero `cancelar` no hace nada.
- Numéricamente: opción **N+1 = Volver**, **N+2 = Menú principal**
  (donde N es la cantidad de opciones de esa pantalla).
  Excepción: el paso del nombre ofrece un **5️⃣ quemado** que no sigue la convención.

**Sesión:** expira a los 10 minutos de inactividad — pero eso **solo se detecta cuando
el cliente vuelve a escribir**. No hay limpieza automática de sesiones abandonadas.

**Errores:** al tercer error seguido el bot responde *"Parece que hay un error, escribe
menu para empezar de nuevo"* y pone el contador en cero — pero ⚠️ **no resetea el flujo**:
el cliente sigue parado exactamente en el mismo paso. Además ese contador solo está
conectado en los pasos **barbero, fecha y hora**; no existe en el paso del nombre, ni en
el flujo de cancelación, ni en el panel del barbero.

**Qué días se le ofrecen al cliente:** los 7 próximos en los que el barbero **tenga
turnos configurados**. Un día con la jornada vacía es la forma de decir "no trabajo",
y se salta. **El domingo no es especial**: si un barbero le pone horario, se ofrece.
Antes estaba saltado a la fuerza y no había manera de abrir un domingo.

Si a un barbero se le vacían los **siete** días, no hay ninguna fecha que mostrar: se
le avisa al cliente y se le devuelve a la lista de barberos. La búsqueda de fechas
tiene un tope de 30 días por delante, o una semana vacía dejaría el bucle girando.

**Límite:** máximo 2 turnos por día por número de teléfono. Los números de los
barberos (`adminPhones`) no tienen límite.

## Panel del barbero

Se activa cuando el barbero escribe **su contraseña exacta** desde su número
registrado. Las contraseñas **ya no están en el código**: vienen de
`PASSWORD_BOLON`, `PASSWORD_JULIAN`, `PASSWORD_LADINO` y `PASSWORD_PRUEBA`.
Si falta alguna, ese barbero no puede entrar y se avisa al arrancar. Es una lista:

```
1. Ver agenda de hoy
2. Ver agenda de mañana
3. Buscar agenda por fecha (DD/MM/AAAA)
4. Salir del panel
5. Cambiar de barbero      ← solo para quien tiene canSeeAll
```

**"Salir" se queda en el 4 para todos** aunque haya una opción 5: los barberos
llevan meses con esa costumbre. La opción extra va después, no antes.

Muestra 🟢 libre / 🔴 ocupado con nombre y teléfono del cliente (sin el 57).

## Google Sheets — hoja "Barber01", pestaña `barber`

| Col | Campo | Formato | Notas |
|-----|-------|---------|-------|
| A | Fecha | `2026-05-02` | ⚠️ **texto plano**, se compara con `===` |
| B | Día visible | `Sábado 2 de mayo` | solo para mostrar |
| C | Hora | `9am`, `10:45am`, `1:30pm` | ⚠️ formato exacto, se compara con `===` |
| D | Nombre | texto | |
| E | Teléfono | `573146926477` | con código de país, sin `+` |
| F | Barbero | `Bolon` | se compara en minúsculas |
| G | Estado | `Confirmado` / `Cancelado` | solo `Confirmado` ocupa el slot |
| H | Fecha registro | ISO | timestamp de creación |
| I | FechaHoraTurno | `2026-05-02 15:40:00` | lo usa el recordatorio |
| J | RecordatorioEnviado | `Sí` / `No` | |

⚠️ **Las columnas A y C se comparan como texto exacto.** Si Google Sheets
convierte una de esas celdas a formato fecha/hora automáticamente, la
comparación falla en silencio y el slot aparece libre cuando está ocupado.
Hay filas históricas con este problema (ver columna I, mezcla `2026-04-29` con `29/4/2026`).

**Bloqueos de horario:** hoy se hacen a mano, agregando filas con nombre
`Descanso1`, `Descanso2`, etc. No hay función para esto en el bot.

## La web y el panel

**`/`** — presentación de la barbería. HTML y CSS puros, sin compilar nada.
Se descartó React a propósito: habría metido un paso de build y ~200 MB de
dependencias en la misma app que atiende a los clientes.

**`/panel`** — administración. Se llega con el botón **Panel** de la portada, o
escribiendo la dirección. Se entra sin contraseña:

```
1. Escribe su número en /panel (10 dígitos, sin el 57) y toca Enviar código
2. Le llega un código de 6 dígitos por WhatsApp (5 minutos, un solo uso)
3. Lo escribe ahí mismo y entra. Cookie firmada, 30 días
```

Escribirle **`acceso`** al bot sigue funcionando y da el mismo código. No es
solo el camino viejo: es el respaldo, y hace falta de verdad — ver abajo.

⚠️ **Meta solo deja mandar mensajes libres dentro de las 24 horas del último
mensaje del usuario.** Desde la web el que habla primero es el bot, así que si
el barbero lleva rato sin escribirle, el envío **rebota**. Cuando eso pasa, la
pantalla no muestra un error: muestra un botón que abre WhatsApp con `acceso`
ya escrito, que además reabre esa ventana de 24 horas. Por eso el comando no se
puede quitar. La alternativa sería una plantilla de autenticación aprobada por
Meta, que cuesta por envío y lleva el texto que Meta imponga.

**Al que no está habilitado se le dice claramente** ("tu número no está
habilitado para este panel"), a diferencia del bot, que le responde algo
genérico para no confirmarle a un desconocido que el panel existe. Eso convierte
la pantalla en una forma de averiguar qué números son admin, y por eso hay un
freno: **3 intentos cada 10 minutos por número y por dispositivo**, en memoria,
y va **antes** de mirar si el número está habilitado.

El texto del mensaje del código está en `mensajeCodigo()` (`accesoPanel.js`),
uno solo para los dos caminos.

| Pantalla | Qué hace |
|---|---|
| `/panel/agenda` | La semana de un barbero. Tocar un turno libre lo **bloquea** |
| `/panel/horarios` | Editar la jornada de cada barbero |

**Bloquear** escribe una fila normal con nombre `Descanso`: para el bot es un
turno ocupado más. **Liberar** la pasa a `Cancelado` — nunca se borra, porque
borrar corre los números de todas las de abajo.

⚠️ **Antes de escribir cualquier fila se relee y se verifica que sea la
correcta.** Vale para bloqueos y para las cancelaciones de clientes. Sin eso,
una fila insertada a mano en la hoja hace que se cancele el turno de otro.

## Variables de entorno

| Variable | Si falta |
|---|---|
| `API_TOKEN` · `BUSINESS_PHONE` · `API_VERSION` | El bot no puede enviar nada |
| `WEBHOOK_VERIFY_TOKEN` | Meta no puede verificar el webhook |
| `GOOGLE_CREDENTIALS_JSON` | No hay agenda: todo falla con aviso claro |
| `ADMIN_PRINCIPAL` | Nadie puede entrar al panel |
| `PASSWORD_BOLON` · `_JULIAN` · `_LADINO` · `_PRUEBA` | Ese barbero se queda sin panel |
| `SESION_SECRETO` | El panel funciona, pero cada despliegue cierra las sesiones |
| `META_APP_SECRET` | La firma del webhook queda **apagada** |
| `SPREADSHEET_ID` · `URL_PUBLICA` | Llevan valor por defecto |

Ninguna tumba el bot al faltar, a propósito: todas avisan en los logs al
arrancar en vez de fallar en silencio.

## Tests

```bash
npm test
```

Usa el corredor que ya trae Node, sin instalar nada. Cubren lo que ya ha dolido:
horarios, validación antes de guardar, firma del webhook, sesiones del panel,
reenvíos de Meta y la verificación antes de cancelar. Hay uno que **falla si
alguien vuelve a escribir una contraseña o un token en el código**.

## Recordatorios

`reminderService.js` busca turnos donde falten **entre 55 y 65 minutos**.
Esto implica que el cron debe correr **al menos cada 10 minutos**, o se saltan
recordatorios. Si tocas esa ventana, revisa la frecuencia del cron.

Hoy el cron corre **cada 5 minutos** (`app.js`, `cron.schedule('*/5 * * * *')`).
La regla se cumple con margen.

## Webhook de Meta

`webhookController.js` responde **200 a Meta ANTES de procesar** el mensaje. El
procesamiento corre por su cuenta y sus errores se registran sin poder tumbar el
proceso. **No devuelvas ese `res.sendStatus(200)` abajo del `await`:** Meta se queda
esperando, da la entrega por fallida y reenvía.

Hay tres defensas contra los reenvíos, en `services/entregasMeta.js`:

1. El 200 rápido, para que Meta no reintente en primer lugar.
2. **Deduplicación por `message.id`** — el mismo mensaje dos veces se ignora.
3. **Se descartan los mensajes de más de 15 minutos**, que es lo que llega cuando
   el webhook estuvo caído y Meta suelta de golpe su cola atrasada.

En las dos últimas, ante la duda se **procesa**: sin `id` o sin `timestamp` válido
el mensaje pasa. Perder un mensaje real es peor que procesar uno de más.

### ⚠️ Si cambias el dominio en Railway, actualiza Meta el mismo día

**Ya pasó** (10 de agosto de 2026): se le cambió el dominio al servicio para que
dijera el nombre de la barbería, y Meta se quedó apuntando al viejo. El bot estuvo
horas sin recibir un solo mensaje.

No hay ninguna alerta que avise. El servicio responde, la web se ve, los logs se ven
normales — simplemente no llega nada. Y al arreglarlo, Meta suelta toda la cola
atrasada de golpe (de ahí la defensa 3).

La URL va en: Meta → tu app → WhatsApp → **Configuración** → *URL de devolución de
llamada*, y termina en `/webhook`.

## Zona horaria

Todo se calcula en `America/Bogota` con este patrón:
```js
new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }))
```
Railway corre en UTC. Si cambias algo de fechas, verifica que sigue dando
la fecha correcta de Bogotá, especialmente entre 7pm y medianoche.

## Cómo trabajar conmigo

- Explícame **en español y sin jerga** qué vas a hacer antes de hacerlo.
- Cambios chiquitos, uno a la vez. Prefiero 5 commits pequeños que 1 grande.
- Si algo se puede hacer de dos formas, dime las dos y déjame escoger.
- Si no estás seguro de algo, pregúntame en vez de asumir.
