# Backlog — Chatbot Exclusive Barber

Revisión de `messageHandler.js` + `googleSheetsService.js` (agosto 2026).
Verificado línea por línea contra el código el **9 de agosto de 2026**, y ampliado
con `webhookController.js` y `whatsappService.js`.

Ordenado por **prioridad de trabajo acordada**, no por dificultad.
Las secciones (🔴 🟠 🕓 🟡) clasifican por **naturaleza del riesgo**; el "Orden sugerido"
del final es el **plan de trabajo**. No son lo mismo y no tienen que coincidir.

### ⚠️ Cómo leer este documento

Cada punto lleva una marca. **La diferencia importa:**

- ✅ **Observado** — ya pasó de verdad en producción.
- 🔮 **Predicción** — está en el código y es real como código, pero **nunca se ha visto
  ocurrir**. En 4 meses de producción no hay un solo caso registrado.

Casi todo este backlog es 🔮. Eso no lo hace falso, pero sí significa que el orden de
trabajo es una apuesta sobre lo que *podría* pasar, no una respuesta a lo que pasó.
El único ✅ de la lista es el punto 1.

---

## 🎯 Los tres primeros — en este orden

### 1. ✅ Horarios duplicados en dos funciones → `config/barbers.js`
**El único punto de este documento que ya ocurrió en la vida real.**

Las listas de slots de los 3 barberos están copiadas **idénticas** en
`getAvailableSlots()` y `getDailyScheduleByBarber()`. Verificado: hoy las seis listas
coinciden carácter por carácter.

Cambiar el horario de un barbero y olvidar una de las dos → el cliente ve
horarios distintos a los que ve el barbero en su panel. **Es la causa raíz del
tipo de bug que ya has sufrido.**

**Solución:** sacar los horarios a un solo archivo `config/barbers.js` y que
ambas funciones lo importen. Bajo riesgo, alto beneficio.

*(Detalle inofensivo al mover el código: en `getAvailableSlots()` los tres barberos
están encadenados con `if / else if`, y en `getDailyScheduleByBarber()` son tres `if`
sueltos. No cambia el comportamiento, pero no los unifiques a ciegas.)*

### 2. 🔮 Un botón viejo a mitad del agendamiento descuadra el flujo
La rama de mensajes interactivos (`messageHandler.js`, ~línea 374) revisa
`barberAdminState`, `cancelState` y `assistantState` — pero **no revisa
`appointmentState`**.

Si el cliente está a mitad de agendar y toca un botón del menú viejo que quedó más
arriba en el chat, el mensaje se va directo a `handleMenuOption()`. Qué pasa depende
de cuál botón toque, y **solo uno de los tres es grave**:

- **Botón 1 (Agendar):** reinicia el flujo y le pide el nombre otra vez.
  Molesto, pero coherente. El cliente entiende qué pasó.
- **Botón 3 (Ubicación):** manda la ubicación y el turno a medias **sigue vivo**.
  Prácticamente inofensivo.
- **Botón 2 (Cancelar): 🔴 este es el problema real.** Crea `cancelState` mientras
  `appointmentState` sigue existiendo — los dos estados vivos al tiempo. Y como la
  rama de texto revisa `appointmentState` **antes** que `cancelState` (~línea 321),
  pasa esto: el cliente ve la lista de sus turnos para cancelar, escribe "1" creyendo
  que está cancelando, y el bot lo interpreta como *"elegí al barbero 1"*.
  **El cliente cree que canceló y no canceló nada.** Se va a presentar un turno que
  para él ya no existe, o el barbero le guarda un espacio que nadie va a usar.

Ese tercer caso es el que justifica el arreglo; los otros dos solos no lo justificarían.

**Solución:** incluir `appointmentState` en esa cadena de `if`, igual que en la rama
de mensajes de texto.

### 3. 🔮 Escribir "volver" en el paso del nombre se guarda como nombre
`handleBack()` no tiene ninguna regla para el paso `name` y devuelve `false`
(~línea 175). El mensaje sigue de largo y `handleAppointmentFlow` lo toma como el
nombre del cliente (~línea 564).

Resultado: **el turno queda a nombre de "volver"**, y el barbero recibe el template
con ese nombre. Lo mismo con "atras".

`menu`, `cancelar` y `salir` sí funcionan en ese paso.

**Qué tan grave:** es vergonzoso, no destructivo. El cliente ve *"Perfecto, **volver**"*
en pantalla y casi seguro se da cuenta y vuelve a empezar. Está de tercero porque es
barato de arreglar y se ve feo, **no porque sea el de mayor riesgo** — el punto 4
es objetivamente más peligroso que este.

**Solución:** que `handleBack()` en el paso `name` devuelva al menú principal.

---

## 🔴 Crítico — puede tumbar el bot en producción

### 4. 🔮 Cuota de Google Sheets API
`getAuthClient()` se crea de cero en **cada** función, y `getSheetData()` lee la
hoja completa `A:J` en **cada** llamada.

Un cliente que solo pide agendar dispara:
- `generateNextAvailableDates()` → llama `getAvailableSlots()` **7 veces**
- = 7 autenticaciones + 7 lecturas completas de la hoja
- **1 lectura más** al elegir la fecha (`getAvailableSlots()` otra vez, ~línea 690)
- luego `countUserAppointmentsSameDay()` + `checkAvailability()` = 2 más

**~10 lecturas completas por cliente**, no 9. Y si el cliente escribe *volver* desde
la pantalla de fechas, **las 7 lecturas se repiten completas**.

El límite de Google es **60 lecturas por minuto por usuario** — y la cuenta de
servicio es un solo usuario, así que ese es el techo real (el de 300/min es por
proyecto y no aplica aquí). A ~10 lecturas por cliente, **con unos 6 clientes
agendando dentro del mismo minuto se toca el techo**. Un sábado en la mañana es
posible; un día normal no.

#### ⚠️ Lo importante: cómo falla

No falla con un error visible. Falla en silencio y en la peor dirección posible:

1. Google responde error por cuota.
2. `getSheetData()` atrapa el error y **devuelve una lista vacía**.
3. Con lista vacía, `getAvailableSlots()` concluye que **no hay ningún turno ocupado**.
4. El bot **ofrece horarios que ya están vendidos**.

O sea: justo en el momento de más clientes, el bot empieza a **vender el mismo turno
dos veces** sin que nadie se entere hasta que llegan dos personas a la misma hora.

Esa es la verdadera razón para arreglar esto — no la cuota en sí.

**Solución:** cachear el cliente de auth (crearlo una sola vez), y cachear la
lectura de la hoja unos 30-60 segundos. Es un cambio contenido y de altísimo impacto.

**Aparte y más barato aún:** que `getSheetData()` **no devuelva `[]` cuando falla**.
Que propague el error para que el bot pueda decir "no puedo consultar la agenda ahora,
intenta en un minuto" en vez de inventar disponibilidad. Esto solo ya elimina el
riesgo de doble venta, aunque no se cachee nada.

**Bonus:** el cacheo también arregla la lentitud del webhook (ver riesgos latentes).

### 5. 🔮 Estado en memoria = se pierde con cada deploy
`appointmentState`, `cancelState`, `barberAdminState` viven en RAM. Cada vez que
Railway reinicia o haces deploy, todos los clientes que estaban a mitad del flujo
pierden su progreso.

**Corrección a una versión anterior de este documento:** decía que los clientes quedan
"colgados sin explicación". **Eso es falso.** Lo seguí en el código: si el estado se
perdió, el siguiente mensaje del cliente cae al `else` final de
`handleIncomingMessage()` y recibe **el saludo de bienvenida y el menú**. El bot se
recupera solo. Es confuso —el cliente estaba escribiendo su nombre y de pronto le
saludan de nuevo— pero no queda trabado ni pierde un turno ya confirmado.

Eso baja bastante la urgencia de este punto.

**Solución realista para ahora:** no migrar a base de datos todavía. Si acaso,
distinguir "sesión perdida por reinicio" de "cliente nuevo" y decirle algo como
*"se reinició el sistema, empecemos de nuevo"*. La solución de fondo (Redis o
Postgres) déjala para cuando ya funcionen las anteriores.

### 6. 🔮 Cancelar puede borrar el turno equivocado
`updateAppointmentStatus(rowNumber, ...)` calcula `rowNumber` desde el índice del
array leído. Si entre la lectura y la escritura alguien inserta o borra una fila
en la hoja a mano (que es exactamente como se crean los "Descanso"), se cancela
**el turno de otro cliente**.

**Solución:** antes de escribir, releer esa fila y verificar que el teléfono y la
hora coincidan con el turno seleccionado.

---

## 🟠 Importante — afecta al negocio

### 7. ✅ No se pueden bloquear horarios desde el bot
Hoy toca abrir la hoja y escribir filas `Descanso1`, `Descanso2`... a mano.
Debería ser una opción del panel del barbero: *"Bloquear un horario"*.

### 8. ✅ Contraseñas de los barberos hardcodeadas en el código
Están en texto plano dentro de `messageHandler.js`. Ese archivo se subió como
código fuente al trabajo de la universidad.

El `SPREADSHEET_ID` de la hoja también está quemado en `googleSheetsService.js`
(línea 31). Es el mismo problema y se arregla en el mismo cambio.

**🟢 Buena noticia, verificada:** revisé **todo el historial de git** y ni
`src/credentials/credentials.json` ni `.env` fueron commiteados **nunca**. Ambos están
correctamente en `.gitignore`. Las llaves de Google **no se filtraron**. Lo expuesto se
limita a las tres contraseñas de los barberos y al ID de la hoja.

**Solución:** moverlas a variables de entorno en Railway. Y cambiarlas.

### 9. 🔮 Dos clientes pueden tomar el mismo horario
`checkAvailability()` lee, y después `appendToSheet()` escribe. Entre esas dos
operaciones pasan segundos. Dos personas eligiendo el mismo slot al tiempo pasan
ambas la validación.

Es poco probable con el volumen actual, pero cuando pase vas a tener un barbero
con dos clientes a la misma hora.

### 10. 🔮 Bolon no tiene domingo bloqueado
**Confirmado con el dueño (9 de agosto de 2026): Bolon NO trabaja domingos.**
Entonces esto sí es un descuido del código, no una regla de negocio.

`Julian` y `Ladino` retornan `[]` el domingo; `Bolon` no. Al cliente no le afecta
(las fechas ofrecidas ya saltan los domingos para los tres), pero **el panel de Bolon
sí muestra agenda completa un domingo**, lo cual confunde.

**Solución:** agregar el `if (day === 0) return [];` de Bolon **en las dos funciones**,
igual que los otros dos. Si ya se hizo el punto 1 (`config/barbers.js`), esto es una
sola línea en un solo lugar — por eso conviene hacerlo *después* del punto 1 y no antes.

### 11. 🔮 Una nota de voz recibe silencio absoluto
`handleIncomingMessage()` solo maneja dos tipos de mensaje: `text` e `interactive`.
**No hay ningún `else`.**

Si el cliente manda una **nota de voz, una foto, un sticker o una ubicación**, el bot
no responde absolutamente nada — y ni siquiera marca el mensaje como leído. El cliente
queda mirando el chat esperando una respuesta que nunca llega.

En una barbería la gente manda notas de voz todo el tiempo. **Es probablemente el
punto más frecuente de todo este documento**, aunque no haya un reporte formal.
Está marcado 🔮 porque no hay registro de que haya pasado — pero es 🔮 por falta de
medición, no por improbable.

**Solución:** un `else` que responda algo como *"Por ahora solo entiendo mensajes de
texto 🙏 Escribe *menu* para ver las opciones"*, y que marque el mensaje como leído.

### 12. 🔮 El webhook no valida la firma de Meta
Verificado en `app.js` y `webhookRoutes.js`: **no hay ningún middleware de validación**.
La ruta `POST /webhook` acepta cualquier cuerpo que le llegue.

El `WEBHOOK_VERIFY_TOKEN` solo protege el `GET` de verificación inicial. **No protege
el POST**, que es por donde entran los mensajes reales.

Consecuencia: cualquiera que conozca la URL de Railway puede mandar un POST falso y
hacer que el bot **escriba filas en la hoja de Google y envíe WhatsApps** a números
arbitrarios. La URL no es un secreto: está en el panel de Meta y aparece en logs.

No hay ninguna señal de que esto haya sido abusado. Pero a diferencia de los riesgos
latentes de abajo, **esto no depende del volumen de clientes**: la puerta está abierta
igual con 1 cliente que con 100.

**Solución:** validar la cabecera `X-Hub-Signature-256` con el App Secret de Meta antes
de procesar. Requiere guardar el cuerpo crudo (`raw body`) porque la firma se calcula
sobre el texto original, no sobre el JSON ya parseado.

### 13. 🔮 No hay ni un solo test
Cero tests en todo el repositorio (verificado). De este bot dependen tres personas para
trabajar, y cada cambio se valida a mano en WhatsApp.

No hace falta llenar el proyecto de tests. Pero las funciones de horarios
(`getAvailableSlots`, `slotToMinutes`, `buildAppointmentDateTime`, `parseAdminDate`)
son **funciones puras y fáciles de probar**, y son justo donde ya te ha dolido.
Un puñado de tests ahí valdría más que todo el resto junto.

Tiene sentido hacerlo **junto con el punto 1**, cuando los horarios queden en un solo
archivo: ese es el momento natural para dejarlos cubiertos.

---

## 🕓 Riesgos latentes — reales, pero no urgentes

Son fallas de verdad y hay que dejarlas escritas, pero **no justifican tocar
producción ahora mismo**: el volumen actual es bajo (una barbería, tres barberos,
clientes que llegan de a uno) y el bot lleva **4 meses corriendo sin un solo
incidente atribuible a esto**.

Lo que cambiaría esa evaluación: que suba el volumen de clientes simultáneos, o que
Google Sheets tenga un día lento y las respuestas empiecen a demorar.

**Honestidad sobre esta frontera:** el argumento "volumen bajo, 4 meses sin incidentes"
aplica **exactamente igual** al punto 4 (cuota) y al punto 9 (dos clientes al mismo
horario). Ninguno de los tres se ha observado nunca. Están en secciones distintas por
una decisión de trabajo, no porque haya evidencia que los separe.

La razón defendible para dejar el 4 arriba y el webhook abajo es esta: la cuota falla
**para todos los clientes a la vez** y de forma silenciosa (ofreciendo turnos ya
vendidos), mientras que un reintento del webhook afecta **un solo mensaje**. Pero eso
es un juicio, no un dato.

### El webhook responde 200 a Meta *después* de procesar todo
En `webhookController.js` el `res.sendStatus(200)` está **debajo** del
`await messageHandler.handleIncomingMessage(...)`. Meta queda esperando mientras
corren todas las lecturas de Sheets y todos los envíos de WhatsApp.

El peor caso es elegir barbero: **7 autenticaciones + 7 lecturas completas** de la
hoja antes de responderle a Meta. Si Meta no recibe el 200 en unos pocos segundos,
corta y **reintenta el mismo mensaje**.

**Solución (2 líneas):** mover el `res.sendStatus(200)` arriba del `await`.

### No hay deduplicación por `message.id`
Busqué en todo `src/`: el `message.id` solo se usa para `markAsRead()` y para
`sendWelcomeMessage()`. No existe ningún registro de mensajes ya procesados.
Si Meta reenvía un mensaje, **el bot lo procesa de nuevo desde cero**.

**Por qué las dos cosas juntas importan:** se alimentan mutuamente. El webhook es
lento *porque* espera a Sheets → Meta reintenta → sin deduplicación, el reintento
avanza el flujo otra vez.

El caso peligroso es la confirmación del turno: `completeAppointment()` borra el
estado en su primera línea (~496), pero **antes** de llegar ahí corren dos lecturas
a Sheets (`countUserAppointmentsSameDay` y `checkAvailability`). Si un reintento
entra durante esas dos lecturas, se guardan **dos filas y dos templates al barbero**
por el mismo turno. La ventana es estrecha, pero existe.

Si el reintento llega ya terminado el primer proceso, el daño es menor: el cliente
recibe la confirmación y acto seguido el menú de bienvenida, sin explicación.

**Solución:** un `Set` en memoria con los últimos `message.id` procesados, con
expiración. Hacer esto *después* de arreglar el 200, no antes.

---

## 🟡 Limpieza — sin riesgo, mejora la mantenibilidad

**No borrar nada de esto sin confirmarlo primero.**

Código que ya no se usa *(verificado con búsqueda en todo `src/`)*:
- `generateAvailableSlots()` — reemplazado por los horarios por barbero
- `formatAppointmentsList()` — reemplazado por `formatDailySchedule()`
- `parseTime()` — duplica lo que hace `buildAppointmentDateTime()` y `slotToMinutes()`
- `sendLocation()` — duplica `sendLocationAndContact()`
- `isSlotAvailable()` y `getBookedSlots()` — nunca se importan
- `getAppointmentsByBarberAndDate()` — se importa pero nunca se llama

Flujo de IA huérfano:
- `assistantState` **nunca se activa**: no hay ninguna opción del menú que lo cree.
  `handleAssistantFlow()` y el import de `geminiAiService` son inalcanzables.
- `'hablar con barberia'` está en `directOptions` pero no tiene `case` en
  `handleMenuOption()` → cae en el `default` y responde "No entendí".
- **Decisión pendiente:** ¿reconectar la IA al menú, o quitarla del todo?

Inconsistencias menores:
- El paso `name` ofrece "5️⃣ Menú principal" — el 5 está quemado y no sigue la
  convención N+1/N+2 del resto del bot.
- `handleGlobalNavigation()` no incluye `barberAdminState` en `hasActiveFlow`, así que
  ni `volver` ni `cancelar` funcionan dentro del panel del barbero. `menu` **sí**
  funciona ahí, pero por otra vía (el atajo del inicio de `handleIncomingMessage`), y
  saca al barbero del panel al menú de cliente sin avisarle.
- El contador de 3 errores **no resetea el flujo**: solo manda el mensaje y se pone en
  cero; el cliente sigue parado en el mismo paso. Y solo está conectado en los pasos
  barbero, fecha y hora — no en el paso del nombre, ni en el flujo de cancelación
  (ahí un cliente puede escribir basura indefinidamente), ni en el panel del barbero.
- `countUserAppointmentsSameDay()`, `checkAvailability()`, `isSlotAvailable()` y
  `getBookedSlots()` no saltan la fila de encabezado (`rows.slice(1)`). Hoy es
  inofensivo, pero es inconsistente con el resto.
- `errorCount` y los objetos de estado nunca se limpian de los usuarios que se
  fueron. Fuga de memoria lenta.
- `whatsappService.sendMessage(to, bodyText, messageId)` **recibe el tercer parámetro
  y nunca lo usa**: al payload le falta el campo `context`, así que el mensaje de
  bienvenida no sale como respuesta citada, que parece ser la intención original.
- `isMenuInput()` compara contra `'menú'` con tilde, pero `normalizeText()` ya se la
  quitó antes. Esa comparación nunca se cumple. Inofensivo, pero engaña al leerlo.
- En la agenda del barbero, un turno con la hora en formato raro **aparece de primero**:
  los turnos históricos que no coinciden con ningún slot se ordenan con
  `slotToMinutes()`, que devuelve `-1` cuando no entiende el formato.

---

## Orden sugerido

Los tres primeros están fijados por decisión del dueño. Del 4 en adelante es propuesta.

1. **Punto 1** — `config/barbers.js`, unificar horarios *(único ✅ del documento)*
   - Aprovechar y meter aquí el **punto 13** (tests de horarios) y el **punto 10**
     (domingo de Bolon), que se vuelven triviales una vez unificado.
2. **Punto 2** — botón viejo en agendamiento *(el caso del botón "Cancelar")*
3. **Punto 3** — "volver" en el paso del nombre *(barato y visible)*
4. **Punto 11** — responder algo a las notas de voz *(probablemente lo más frecuente
   de todo el documento, y son ~5 líneas)*
5. **Punto 4** — que `getSheetData()` no devuelva `[]` al fallar, y cachear auth +
   lectura *(evita vender el mismo turno dos veces)*
6. **Punto 8** — contraseñas y `SPREADSHEET_ID` a variables de entorno
7. **Punto 12** — validar la firma del webhook
8. **Punto 6** — verificación antes de cancelar
9. **Punto 7** — bloquear horarios desde el panel del barbero *(feature nueva)*
10. **Punto 5** — mensaje claro cuando se pierde la sesión por reinicio
11. Decidir qué hacer con la IA *(ver Limpieza)*
12. Limpieza de código muerto

### Dos advertencias sobre este orden

**No está ordenado por riesgo.** Está ordenado por "barato y visible primero". Si el
criterio fuera puro riesgo, el punto 4 (vender el turno dos veces) iría antes que el 3
y probablemente antes que el 2. Queda dicho para que la decisión sea consciente.

**Los riesgos latentes (webhook y deduplicación) quedan fuera a propósito.** Retomarlos
cuando suba el volumen, o al primer caso real de turno duplicado. Ojo: si aparece un
turno duplicado, revisar **primero** el punto 4 (cuota), que produce el mismo síntoma
y es más probable.

Uno a la vez, cada uno en su rama, probado en WhatsApp antes de pasar al siguiente.
