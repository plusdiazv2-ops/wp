# Backlog — Chatbot Exclusive Barber

Revisión de `messageHandler.js` + `googleSheetsService.js` (agosto 2026).
Ordenado por riesgo real, no por dificultad.

---

## 🔴 Crítico — puede tumbar el bot en producción

### 1. Cuota de Google Sheets API
`getAuthClient()` se crea de cero en **cada** función, y `getSheetData()` lee la
hoja completa `A:J` en **cada** llamada.

Un cliente que solo pide agendar dispara:
- `generateNextAvailableDates()` → llama `getAvailableSlots()` **7 veces**
- = 7 autenticaciones + 7 lecturas completas de la hoja
- luego `countUserAppointmentsSameDay()` + `checkAvailability()` = 2 más

**~9 lecturas completas por cliente.** El límite de Google es 60 lecturas por
minuto. Con 3 barberos y varios clientes simultáneos, esto revienta.

**Solución:** cachear el cliente de auth (crearlo una sola vez), y cachear la
lectura de la hoja unos 30-60 segundos. Es un cambio contenido y de altísimo impacto.

### 2. Horarios duplicados en dos funciones
Las listas de slots de los 3 barberos están copiadas idénticas en
`getAvailableSlots()` y `getDailyScheduleByBarber()`.

Cambiar el horario de un barbero y olvidar una de las dos → el cliente ve
horarios distintos a los que ve el barbero en su panel. **Es la causa raíz del
tipo de bug que ya has sufrido.**

**Solución:** sacar los horarios a un solo archivo `config/barbers.js` y que
ambas funciones lo importen. Bajo riesgo, alto beneficio.

### 3. Estado en memoria = se pierde con cada deploy
`appointmentState`, `cancelState`, `barberAdminState` viven en RAM. Cada vez que
Railway reinicia o haces deploy, todos los clientes que estaban a mitad del flujo
quedan colgados sin explicación.

**Solución realista para ahora:** no migrar a base de datos todavía, pero sí
detectar el estado vacío y responder algo claro. La solución de fondo (Redis o
Postgres) déjala para cuando ya funcionen las anteriores.

### 4. Cancelar puede borrar el turno equivocado
`updateAppointmentStatus(rowNumber, ...)` calcula `rowNumber` desde el índice del
array leído. Si entre la lectura y la escritura alguien inserta o borra una fila
en la hoja a mano (que es exactamente como se crean los "Descanso"), se cancela
**el turno de otro cliente**.

**Solución:** antes de escribir, releer esa fila y verificar que el teléfono y la
hora coincidan con el turno seleccionado.

---

## 🟠 Importante — afecta al negocio

### 5. No se pueden bloquear horarios desde el bot
Hoy toca abrir la hoja y escribir filas `Descanso1`, `Descanso2`... a mano.
Debería ser una opción del panel del barbero: *"Bloquear un horario"*.

### 6. Contraseñas de los barberos hardcodeadas en el código
Están en texto plano dentro de `messageHandler.js`. Ese archivo se subió como
código fuente al trabajo de la universidad.

**Solución:** moverlas a variables de entorno en Railway. Y cambiarlas.

### 7. Dos clientes pueden tomar el mismo horario
`checkAvailability()` lee, y después `appendToSheet()` escribe. Entre esas dos
operaciones pasan segundos. Dos personas eligiendo el mismo slot al tiempo pasan
ambas la validación.

Es poco probable con el volumen actual, pero cuando pase vas a tener un barbero
con dos clientes a la misma hora.

### 8. Bolon no tiene domingo bloqueado
`Julian` y `Ladino` retornan `[]` el domingo; `Bolon` no. Al cliente no le afecta
(las fechas ofrecidas ya saltan los domingos), pero **el panel de Bolon sí muestra
agenda completa un domingo**, lo cual confunde.

---

## 🟡 Limpieza — sin riesgo, mejora la mantenibilidad

**No borrar nada de esto sin confirmarlo primero.**

Código que ya no se usa:
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
- `handleGlobalNavigation()` no incluye `barberAdminState` en `hasActiveFlow`,
  así que "volver" no funciona dentro del panel del barbero.
- `countUserAppointmentsSameDay()`, `checkAvailability()` e `isSlotAvailable()` no
  saltan la fila de encabezado (`rows.slice(1)`). Hoy es inofensivo, pero es
  inconsistente con el resto.
- `errorCount` y los objetos de estado nunca se limpian de los usuarios que se
  fueron. Fuga de memoria lenta.

---

## Orden sugerido

1. `config/barbers.js` — unificar horarios *(bajo riesgo, arregla la causa raíz)*
2. Cachear auth + lectura de Sheets *(alto impacto en estabilidad)*
3. Contraseñas a variables de entorno
4. Verificación antes de cancelar
5. Bloquear horarios desde el panel del barbero *(feature nueva)*
6. Decidir qué hacer con la IA
7. Limpieza de código muerto

Uno a la vez, cada uno en su rama, probado en WhatsApp antes de pasar al siguiente.
