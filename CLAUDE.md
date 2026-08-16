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

Bot de WhatsApp que permite a clientes agendar y cancelar turnos, y a los barberos
consultar su agenda del día — todo dentro de WhatsApp, sin app ni panel web.

**Stack:** Node.js (ESM) · WhatsApp Cloud API (Meta) · Google Sheets como base de
datos · Railway como hosting · Gemini (asistente IA, actualmente desconectado del menú)

## Estructura

```
src/
├── app.js
├── config/env.js
├── controllers/          # webhookController — entrada de Meta
├── routes/
├── services/
│   ├── messageHandler.js       # ⭐ clase con TODA la lógica conversacional
│   ├── whatsappService.js      # envoltorio de la API de Meta
│   ├── googleSheetsService.js  # persistencia + disponibilidad
│   ├── geminiAiService.js
│   └── reminderService.js      # cron de recordatorios
└── httpRequest/sendToWhatsApp.js
```

## Los barberos

`Bolon`, `Julian`, `Ladino` — definidos en `messageHandler.js` (`this.barbers`,
`this.barberPhones`, `this.barberAdmins`, `this.adminPhones`).

### 🧪 Y un cuarto temporal: `Prueba`

Barbero de pruebas del desarrollador (`573137127100`, contraseña `#prueba001#`).
⚠️ **Mientras esté activo los clientes reales lo ven y pueden agendarse con él.**

Todo cuelga de un interruptor en el constructor:

```js
this.testBarberEnabled = true;   // ponerlo en false lo quita de todo
```

Su horario está en `googleSheetsService.js` y puede quedarse ahí aunque se apague:
si no está en la lista de barberos, nadie llega hasta él.

Tiene el permiso `canSeeAll`, que **no tienen los demás**: al entrar con su
contraseña primero escoge de cuál barbero ver la agenda, y dentro del panel gana
una opción 5 para cambiar de barbero sin salir.

**Sus horarios NO están en `messageHandler.js`.** Están duplicados en
`googleSheetsService.js`, dentro de DOS funciones distintas:

- `getAvailableSlots()` — lo que ve el cliente al agendar
- `getDailyScheduleByBarber()` — lo que ve el barbero en su panel

⚠️ **Si cambias el horario de un barbero, tienes que cambiarlo en las DOS.**
Si te pido cambiar un horario y solo tocas una, el bot va a mostrar cosas
distintas al cliente y al barbero. Esto ya pasó antes.

Reglas por barbero (resumen — la fuente de verdad es el código):
- **Bolon:** miércoles solo tarde; resto del día completo. **Sí tiene turnos el domingo**
  en el código (a diferencia de los otros dos); al cliente no le aparece porque las
  fechas ofrecidas saltan los domingos, pero el panel de Bolon sí muestra agenda ese día.
  El último turno de la mañana es **11:55am** y el primero de la tarde **1:30pm**
  (o sea: 11:55am sí se ofrece; el almuerzo empieza después de ese turno).
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
| Jornada · Confirmar cancelación | Botones |

**El paso de jornada (Mañana/Tarde) no siempre aparece.** Existe solo porque los
turnos no caben en una lista. Si caben todos (8 o menos), se salta y el cliente ve
mañana y tarde en sentido de secciones dentro de una misma lista.

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

**Límite:** máximo 2 turnos por día por número de teléfono. Los números de los
barberos (`adminPhones`) no tienen límite.

## Panel del barbero

Se activa cuando el barbero escribe **su contraseña exacta** desde su número
registrado (definidas en `this.barberAdmins`). Es una lista:

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
