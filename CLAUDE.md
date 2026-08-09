# CLAUDE.md — Chatbot Exclusive Barber

> Lee este archivo completo antes de tocar cualquier cosa.

## ⚠️ ESTO ESTÁ EN PRODUCCIÓN REAL

Este chatbot atiende clientes reales de la barbería **Exclusive Barber** (Manizales)
todos los días. Tres barberos dependen de él para su agenda. Un error aquí
significa turnos perdidos o clientes que no pueden agendar.

**Reglas no negociables:**

1. **Nunca trabajes sobre `main`.** Siempre rama nueva: `git checkout -b fix/lo-que-sea`
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

## Los tres barberos

`Bolon`, `Julian`, `Ladino` — definidos en `messageHandler.js` (`this.barbers`,
`this.barberPhones`, `this.barberAdmins`, `this.adminPhones`).

**Sus horarios NO están en `messageHandler.js`.** Están duplicados en
`googleSheetsService.js`, dentro de DOS funciones distintas:

- `getAvailableSlots()` — lo que ve el cliente al agendar
- `getDailyScheduleByBarber()` — lo que ve el barbero en su panel

⚠️ **Si cambias el horario de un barbero, tienes que cambiarlo en las DOS.**
Si te pido cambiar un horario y solo tocas una, el bot va a mostrar cosas
distintas al cliente y al barbero. Esto ya pasó antes.

Reglas por barbero (resumen — la fuente de verdad es el código):
- **Bolon:** miércoles solo tarde; resto del día completo con almuerzo 11:55am–1:30pm
- **Julian:** no trabaja domingos; miércoles solo mañana; martes hasta 4:40pm; resto hasta 5:20pm
- **Ladino:** no trabaja domingos; mismo horario todos los días hábiles, hasta 6:20pm

## Flujo del cliente

```
"hola" → menú con 3 botones
  1️⃣ Agendar turno → nombre → barbero → fecha → hora → confirmación
  2️⃣ Cancelar turno → lista de turnos próximos → confirmar
  3️⃣ Ubicación → mapa + contacto
```

Al confirmar: guarda fila en Sheets → envía template `nuevo_turno_barbero` al
barbero → envía confirmación al cliente.

**Navegación global** (funciona en cualquier paso):
- Escribir `menu` → vuelve al inicio
- Escribir `volver` o `atras` → paso anterior
- Escribir `cancelar` o `salir` → abandona el flujo
- Numéricamente: opción **N+1 = Volver**, **N+2 = Menú principal**
  (donde N es la cantidad de opciones de esa pantalla)

**Sesión:** expira a los 10 minutos de inactividad. 3 errores seguidos resetean el flujo.

**Límite:** máximo 2 turnos por día por número de teléfono. Los números de los
barberos (`adminPhones`) no tienen límite.

## Panel del barbero

Se activa cuando el barbero escribe **su contraseña exacta** desde su número
registrado (definidas en `this.barberAdmins`). Opciones:

```
1. Agenda de hoy
2. Agenda de mañana
3. Buscar por fecha (DD/MM/AAAA)
4. Salir
```

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
