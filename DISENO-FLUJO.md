# Diseño del flujo — Fase 2 del plan

> **Estado: APROBADO el 9 de agosto de 2026.** Se puede programar.

Este documento es el contrato: se aprueba primero, se programa después.
El objetivo de la Fase 2 (ver `MEJORAS.md`) es que el chat se vea profesional.

---

## Decisiones tomadas

| Decisión | Elegido | Fecha |
|---|---|---|
| Fotos de los barberos | **No hay todavía.** Se posponen | 9 ago 2026 |
| Pantalla de barberos | **Lista** (permite Volver y Menú) | 9 ago 2026 |
| Números escritos | **Se mantienen como respaldo** | 9 ago 2026 |
| Convención de navegación | **Se conserva** N+1 = Volver, N+2 = Menú | 9 ago 2026 |

**Cuando lleguen las fotos** habrá que volver a decidir: los botones sí aceptan imagen,
pero solo caben 3 y los tres se los llevarían los barberos, dejando "Volver" como
comando escrito. Esa decisión queda para ese momento, no ahora.

---

## Por qué se mantienen los números

El cliente **toca** la opción, pero si escribe el número también funciona. Y el número
**va escrito en la fila**, porque un respaldo invisible no le sirve a nadie.

Esto tiene una ventaja grande: **el modelo mental del cliente no cambia**. Sigue siendo
"escribe el número, N+1 es volver, N+2 es menú". Solo mejora cómo se ve. Eso hace que
la transición sea mucho menos riesgosa.

---

## Límites de WhatsApp (verificados contra la documentación de Meta)

| Elemento | Tope real |
|---|---|
| Filas de una lista | **10 en TOTAL**, no 10 por sección |
| Secciones de una lista | 10 |
| Encabezado de una lista | **Solo texto.** No acepta imagen |
| Encabezado de botones | Sí acepta imagen |
| Botones por mensaje | 3 |
| Título de fila | **24 caracteres** |
| Descripción de fila | 72 caracteres |
| Título de sección | 24 caracteres |
| Texto del botón que abre la lista | **20 caracteres** |
| Encabezado / pie | 60 caracteres |

### ⚠️ Dos textos del borrador se pasaban del límite

- `"Ver fechas disponibles"` son **22 caracteres**, y el tope del botón es 20.
  → Queda **`Elegir fecha`**.
- `"1. Miércoles 12 de agosto"` son **25 caracteres**, y el tope de la fila es 24.
  → El título lleva la fecha corta y **la descripción lleva el resto**.

---

## Pantalla por pantalla

### 1 · Bienvenida — *botones*

```
👋 Hola Juan, bienvenido a *Exclusive Barber* 💈

Agenda tu turno en segundos ✂️

   [ 📅 Agendar turno  ]
   [ ❌ Cancelar turno ]
   [ 📍 Ubicación      ]
```

Sin cambios respecto a hoy, salvo que aquí es donde entrará el logo como imagen
cuando se decida. Los `id` actuales son `1`, `2`, `3`.

---

### 2 · Nombre — *texto libre*

No se puede convertir en lista: el cliente tiene que escribir.

```
👤 ¿Cómo te llamas?

(Ejemplo: Juan Pérez)

Escribe *menu* para volver al inicio.
```

**Arreglo incluido aquí:** hoy escribir `volver` en este paso **guarda "volver" como
nombre del cliente** (punto 3 del backlog). Al reescribir `handleBack()` se corrige.

---

### 3 · Barbero — *lista*

```
✂️ Elige tu barbero

        [ Elegir barbero ]
               ↓
  ┌────────────────────────────────┐
  │ BARBEROS                       │
  │  1. Bolon                      │
  │  2. Julian                     │
  │  3. Ladino                     │
  │ ──────────────────────────     │
  │  4. ⬅️ Volver                   │
  │  5. 🏠 Menú principal           │
  └────────────────────────────────┘
```

5 filas de 10. Sobra espacio para un cuarto barbero si algún día entra.

---

### 4 · Fecha — *lista*

Mejora gratis: la descripción muestra **cuántos cupos quedan**, que hoy no se ve.

```
📅 Elige el día

        [ Elegir fecha ]
               ↓
  ┌────────────────────────────────┐
  │ PRÓXIMOS DÍAS                  │
  │  1. Lunes 10                   │
  │     10 de agosto · 8 libres    │
  │  2. Martes 11                  │
  │     11 de agosto · 5 libres    │
  │  3. Miércoles 12               │
  │     12 de agosto · sin cupos   │
  │  ...                           │
  │ ──────────────────────────     │
  │  8. ⬅️ Volver                   │
  │  9. 🏠 Menú principal           │
  └────────────────────────────────┘
```

7 fechas + 2 de navegación = **9 filas de 10**. Cabe.

---

### 5 · Jornada — *botones* — **pantalla nueva**

Existe **solo porque los horarios no caben en una lista**. Bolon tiene 14 turnos y el
tope son 10 filas.

```
🕐 ¿A qué hora prefieres?

Para el *Lunes 10* con *Bolon*:

☀️ *Mañana* — 6 turnos disponibles
🌤️ *Tarde* — 8 turnos disponibles

   [ ☀️ Mañana ]
   [ 🌤️ Tarde  ]
   [ ⬅️ Volver ]
```

### Cuando una jornada está llena

```
🕐 ¿A qué hora prefieres?

Para el *Lunes 10* con *Bolon*:

☀️ *Mañana* — 6 turnos disponibles
🌤️ *Tarde* — ❌ sin turnos

   [ ☀️ Mañana ]
   [ ⬅️ Volver ]
```

**Regla: se informa de las dos jornadas, pero solo se muestra botón de la que tiene
cupos.** La razón es técnica: **WhatsApp no tiene botones deshabilitados.** Todo lo que
se muestra se puede tocar, así que un botón de "Tarde (sin cupos)" sería un callejón
sin salida.

El texto del cuerpo no tiene el límite de 20 caracteres del botón, así que ahí sí cabe
decir **cuántos** turnos quedan, que es más útil que solo "hay" o "no hay".

Es coherente con lo que el bot ya hace hoy: en la lista de fechas, los días llenos
salen marcados con `❌`. Mismo lenguaje visual.

**Si las dos jornadas están llenas** no se muestra esta pantalla: se le dice al cliente
que ese día se llenó y se le devuelve la lista de fechas. En teoría no debería pasar,
porque la lista de fechas ya marca los días sin cupos — pero el código no puede
asumirlo, porque entre que se pinta la lista y el cliente escoge pueden pasar minutos
y alguien más puede haber tomado el último turno.

**El corte no es a las 12:00**, es en el almuerzo de cada barbero:

| Barbero | Mañana termina | Tarde empieza |
|---|---|---|
| Bolon | 11:55am | 1:30pm |
| Julian | 1:00pm | 2:30pm |
| Ladino | 1:10pm | 3:00pm |

Si una jornada se queda sin cupos, ese botón **no se muestra**.

---

### 6 · Hora — *lista*

```
⏰ Horarios de la tarde con Bolon

        [ Elegir hora ]
               ↓
  ┌────────────────────────────────┐
  │ TARDE                          │
  │  1. 1:30 pm                    │
  │  2. 2:05 pm                    │
  │  ...                           │
  │  8. 5:30 pm                    │
  │ ──────────────────────────     │
  │  9. ⬅️ Volver                   │
  │ 10. 🏠 Menú principal           │
  └────────────────────────────────┘
```

### 🚨 Esta es la pantalla frágil

La tarde de Bolon son **8 turnos**. Con Volver y Menú van **10 de 10**. **Cero margen.**

**Si algún día se le agrega un turno más a la tarde de cualquier barbero, WhatsApp
rechaza el mensaje entero y el cliente no recibe NADA.** No es que se vea feo: no llega.

**Obligatorio en el código:** antes de enviar, contar las filas. Si pasan de 10:

1. Quitar la fila "Menú principal" (queda como comando escrito) → deja 9 turnos
2. Si aún así pasa, partir la jornada en dos listas

Sin esa protección, agregar un turno rompe el bot en silencio.

---

### 7 · Confirmación — *texto, sin cambios*

Se conserva idéntico al de hoy. La regla 5 de `CLAUDE.md` dice no tocar los textos al
cliente sin pedirlo, y aquí no se pidió.

---

### 8 · Cancelar turno — *lista*

```
📋 Tus turnos próximos

        [ Elegir turno ]
               ↓
  ┌────────────────────────────────┐
  │ TURNOS CONFIRMADOS             │
  │  1. Lunes 10 · 5:00 pm         │
  │     Con Bolon                  │
  │  2. Viernes 14 · 3:20 pm       │
  │     Con Julian                 │
  │ ──────────────────────────     │
  │  3. ⬅️ Volver                   │
  │  4. 🏠 Menú principal           │
  └────────────────────────────────┘
```

⚠️ Un cliente puede tener muchos turnos futuros y los números de barbero no tienen
límite de 2 por día. **Misma protección de 10 filas que en la pantalla de horas.**

---

### 9 · Panel del barbero — *lista*

Son 4 opciones, no caben en botones.

```
💈 Panel Bolon

        [ Ver opciones ]
               ↓
  ┌────────────────────────────────┐
  │ AGENDA                         │
  │  1. Ver agenda de hoy          │
  │  2. Ver agenda de mañana       │
  │  3. Buscar por fecha           │
  │ ──────────────────────────     │
  │  4. Salir del panel            │
  └────────────────────────────────┘
```

---

## Identificadores de las opciones

La regla 4 de `CLAUDE.md` dice no cambiar los `id` sin avisar. **Aquí hay que crear
todos los nuevos**, así que queda constancia:

| Pantalla | Formato del `id` | Ejemplo |
|---|---|---|
| Menú principal | se conservan | `1`, `2`, `3` |
| Barbero | `barbero_<nombre>` | `barbero_bolon` |
| Fecha | `fecha_<AAAA-MM-DD>` | `fecha_2026-08-10` |
| Jornada | `jornada_<periodo>` | `jornada_tarde` |
| Hora | `hora_<slot>` | `hora_5:00pm` |
| Cancelar | `cancelar_<fila>` | `cancelar_42` |
| Panel | `panel_<opcion>` | `panel_hoy` |
| Navegación | `nav_<accion>` | `nav_volver`, `nav_menu` |

Nombres con significado en vez de números sueltos: si mañana cambia el orden de las
opciones, los `id` siguen siendo correctos.

---

## Cambios técnicos obligatorios

**1. Leer `list_reply`.** Hoy el código solo lee
`message.interactive.button_reply.id`. Las listas llegan como
`message.interactive.list_reply.id` y **el código las ignora por completo**.
Sin esto no funciona nada.

**2. Incluir `appointmentState` en la rama interactiva** — es el punto 2 del backlog,
que ya está en Fase 1. Con listas, esa rama pasa a ser el camino principal del bot.

**3. Proteger el tope de 10 filas** antes de cada envío. Ver la advertencia de la
pantalla 6.

**4. Manejar los botones viejos del historial.** Un cliente que toque el menú antiguo
mandará un `id` que ya no existe. Hoy caería en *"No entendí tu opción"*. Debe responder
algo claro tipo *"Esa opción ya no está disponible. Escribe *menu* para empezar"*.

**5. `handleBack()` completo**, incluyendo el paso del nombre (punto 3 del backlog) y
la jornada, que es un paso nuevo.

---

## Lo que NO cambia

- Los textos de confirmación, recordatorio y ubicación
- La estructura de Google Sheets: mismas columnas, mismo orden
- Los horarios de los tres barberos
- El panel del barbero en cuanto a qué información muestra
- El límite de 2 turnos por día
- Los comandos escritos `menu`, `volver`, `cancelar`, `salir`

---

## Cómo se va a probar

El rediseño toca el archivo más delicado del proyecto. **No se despliega de una.**

1. Agendar completo con cada uno de los 3 barberos
2. Agendar en miércoles (jornada distinta para Bolon y Julian)
3. Probar **tocando** las opciones y luego **escribiendo los números**
4. Volver desde cada pantalla, y menú desde cada pantalla
5. Cancelar un turno
6. Panel de los 3 barberos
7. Tocar un botón viejo del historial
8. Mandar una nota de voz a mitad del flujo
9. Verificar que el barbero recibe la plantilla y que la fila en Sheets queda igual
   que antes del rediseño
