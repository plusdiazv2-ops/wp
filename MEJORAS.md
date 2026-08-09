# Backlog — Chatbot Exclusive Barber

Revisión de `messageHandler.js` + `googleSheetsService.js` (agosto 2026).
Verificado línea por línea contra el código el **9 de agosto de 2026**, y ampliado
con `webhookController.js` y `whatsappService.js`.

Ordenado por **prioridad de trabajo acordada**, no por dificultad.

---

## 🎯 Los tres primeros — en este orden

### 1. Horarios duplicados en dos funciones → `config/barbers.js`
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

### 2. Un botón viejo a mitad del agendamiento pierde el turno
La rama de mensajes interactivos (`messageHandler.js`, ~línea 374) revisa
`barberAdminState`, `cancelState` y `assistantState` — pero **no revisa
`appointmentState`**.

Si el cliente está eligiendo la hora y toca un botón del menú viejo que quedó más
arriba en el chat, el mensaje se va a `handleMenuOption()` y **el turno a medio
agendar se pierde en silencio**. El cliente no recibe ninguna explicación.

Pasa con clientes reales: el menú con botones queda visible en el historial y es
natural volver a tocarlo.

**Solución:** incluir `appointmentState` en esa cadena de `if`, igual que en la rama
de mensajes de texto.

### 3. Escribir "volver" en el paso del nombre se guarda como nombre
`handleBack()` no tiene ninguna regla para el paso `name` y devuelve `false`
(~línea 175). El mensaje sigue de largo y `handleAppointmentFlow` lo toma como el
nombre del cliente (~línea 564).

Resultado: **el turno queda a nombre de "volver"**, y el barbero recibe el template
con ese nombre. Lo mismo con "atras".

`menu`, `cancelar` y `salir` sí funcionan en ese paso.

**Solución:** que `handleBack()` en el paso `name` devuelva al menú principal.

---

## 🔴 Crítico — puede tumbar el bot en producción

### 4. Cuota de Google Sheets API
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
proyecto y no aplica aquí). Con 3 barberos y varios clientes simultáneos, esto revienta.

**Solución:** cachear el cliente de auth (crearlo una sola vez), y cachear la
lectura de la hoja unos 30-60 segundos. Es un cambio contenido y de altísimo impacto.

**Bonus:** esto también arregla la lentitud del webhook (ver riesgos latentes).

### 5. Estado en memoria = se pierde con cada deploy
`appointmentState`, `cancelState`, `barberAdminState` viven en RAM. Cada vez que
Railway reinicia o haces deploy, todos los clientes que estaban a mitad del flujo
quedan colgados sin explicación.

**Solución realista para ahora:** no migrar a base de datos todavía, pero sí
detectar el estado vacío y responder algo claro. La solución de fondo (Redis o
Postgres) déjala para cuando ya funcionen las anteriores.

### 6. Cancelar puede borrar el turno equivocado
`updateAppointmentStatus(rowNumber, ...)` calcula `rowNumber` desde el índice del
array leído. Si entre la lectura y la escritura alguien inserta o borra una fila
en la hoja a mano (que es exactamente como se crean los "Descanso"), se cancela
**el turno de otro cliente**.

**Solución:** antes de escribir, releer esa fila y verificar que el teléfono y la
hora coincidan con el turno seleccionado.

---

## 🟠 Importante — afecta al negocio

### 7. No se pueden bloquear horarios desde el bot
Hoy toca abrir la hoja y escribir filas `Descanso1`, `Descanso2`... a mano.
Debería ser una opción del panel del barbero: *"Bloquear un horario"*.

### 8. Contraseñas de los barberos hardcodeadas en el código
Están en texto plano dentro de `messageHandler.js`. Ese archivo se subió como
código fuente al trabajo de la universidad.

**Solución:** moverlas a variables de entorno en Railway. Y cambiarlas.

### 9. Dos clientes pueden tomar el mismo horario
`checkAvailability()` lee, y después `appendToSheet()` escribe. Entre esas dos
operaciones pasan segundos. Dos personas eligiendo el mismo slot al tiempo pasan
ambas la validación.

Es poco probable con el volumen actual, pero cuando pase vas a tener un barbero
con dos clientes a la misma hora.

### 10. Bolon no tiene domingo bloqueado
`Julian` y `Ladino` retornan `[]` el domingo; `Bolon` no. Al cliente no le afecta
(las fechas ofrecidas ya saltan los domingos), pero **el panel de Bolon sí muestra
agenda completa un domingo**, lo cual confunde.

---

## 🕓 Riesgos latentes — reales, pero no urgentes

Son fallas de verdad y hay que dejarlas escritas, pero **no justifican tocar
producción ahora mismo**: el volumen actual es bajo (una barbería, tres barberos,
clientes que llegan de a uno) y el bot lleva **4 meses corriendo sin un solo
incidente atribuible a esto**.

Lo que cambiaría esa evaluación: que suba el volumen de clientes simultáneos, o que
Google Sheets tenga un día lento y las respuestas empiecen a demorar.

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

1. `config/barbers.js` — unificar horarios *(bajo riesgo, arregla la causa raíz)*
2. Bug del botón viejo en agendamiento *(pierde turnos de clientes reales)*
3. Bug de "volver" en el paso del nombre *(turnos a nombre de "volver")*
4. Cachear auth + lectura de Sheets *(alto impacto en estabilidad)*
5. Contraseñas a variables de entorno
6. Verificación antes de cancelar
7. Bloquear horarios desde el panel del barbero *(feature nueva)*
8. Decidir qué hacer con la IA
9. Limpieza de código muerto

Los riesgos latentes (webhook y deduplicación) quedan fuera de esta lista a propósito.
Retomarlos cuando suba el volumen, o si aparece el primer caso de turno duplicado.

Uno a la vez, cada uno en su rama, probado en WhatsApp antes de pasar al siguiente.
