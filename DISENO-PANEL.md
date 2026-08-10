# Diseño del panel de administración — Fase 5

> **Estado: propuesta, pendiente de aprobación.**
> Mientras diga esto, no se programa nada.

Segunda parte de la Fase 5. La web de presentación ya está en vivo; esto es la
parte privada: entrar, ver la agenda, bloquear horarios y editarlos.

---

## Lo que se decidió antes

| Tema | Decisión |
|---|---|
| Dónde vive | Misma app de Railway, rutas bajo `/panel`. Costo adicional **$0** |
| Quiénes entran | El desarrollador (`573137127100`) y Bolon |
| Cómo entran | **Código por WhatsApp**, sin contraseñas |
| Recordar dispositivo | Sí, 30 días |
| Base de datos | Google Sheets. No se migra nada |

---

## 1. Cómo se entra

### El recorrido

```
1. El admin le escribe  acceso  al bot por WhatsApp
2. El bot comprueba que ese número tenga permiso
3. Le responde:  "Tu código es 418702, válido 5 minutos"
4. El admin abre  /panel  y escribe su número y el código
5. Entra. El navegador lo recuerda 30 días
```

**Por qué empieza en WhatsApp y no en la web.** Meta solo deja enviar mensajes
libres dentro de las 24 horas siguientes al último mensaje del usuario. Fuera
de esa ventana hace falta una plantilla aprobada. Como aquí el admin escribe
primero, la ventana queda abierta y **la respuesta no cuesta nada ni necesita
aprobación de Meta**.

### Sin contraseñas, a propósito

No se guarda ninguna contraseña. No hay nada que cifrar, filtrar, olvidar ni
recuperar. Solo entra quien tenga físicamente el celular registrado.

### Detalles que importan

- El código son **6 dígitos**, vive **5 minutos** y es de **un solo uso**.
- **Máximo 5 intentos** por código. Al sexto se invalida y hay que pedir otro.
- Los códigos viven en memoria. Si Railway reinicia se pierden y se pide otro
  — es lo correcto: son de usar y tirar.
- Pedir un código nuevo invalida el anterior.

### Recordar dispositivo

Una **cookie firmada**: el servidor mete el número y la fecha de vencimiento, y
lo firma con un secreto suyo. Si alguien la modifica, la firma no cuadra.

- Dura 30 días y se renueva sola con el uso
- No se puede leer desde JavaScript ni viaja sin HTTPS
- No se guarda ninguna sesión en Sheets: verificarla no cuesta ni una lectura

⚠️ **El costo de esta simplicidad:** no se puede cerrar la sesión de *un*
dispositivo. El botón es **"cerrar sesión en todos"**, que cambia el secreto y
saca a todo el mundo. Si se pierde un celular, eso es lo que se usa.

### Quién tiene permiso

Dos niveles, a propósito:

| | Dónde vive | Se puede quitar desde la web |
|---|---|---|
| **Admin principal** | Variable de entorno en Railway | **No** |
| **Admins agregados** | Pestaña `admins_web` de la hoja | Sí |

El admin principal no se puede borrar desde la web. Es el seguro: si alguien
se equivoca editando la lista, siempre queda una forma de entrar.

---

## 2. Las pantallas

### `/panel` — entrar

```
        [ LOGO ]

   Panel de administración

   Escríbele  acceso  al bot
   por WhatsApp y te llega un código.

   ┌────────────────────────┐
   │ Tu número de WhatsApp  │
   └────────────────────────┘
   ┌────────────────────────┐
   │ Código de 6 dígitos    │
   └────────────────────────┘

        [    Entrar    ]
```

### `/panel/agenda` — la semana de un vistazo

Lo que Sheets hace mal y WhatsApp no puede: **ver la semana completa**.

```
  Agenda    Horarios    Admins              Salir

  Barbero:  [ Bolon ▾ ]        ‹  10–16 ago  ›

           Lun 10   Mar 11   Mié 12   Jue 13   Vie 14   Sáb 15
  9:00am   ● Juan   ○        —        ○        ● Luis   ○
  9:35am   ○        ○        —        ⛔       ○        ○
  10:10am  ● Pedro  ● Ana    —        ○        ○        ● Iván
  ...

  ● ocupado    ○ libre    ⛔ bloqueado    — no trabaja
```

Tocar un turno libre → **bloquearlo**.
Tocar uno bloqueado → **desbloquearlo**.
Tocar uno ocupado → ver quién es y su teléfono.

### `/panel/horarios` — editar la jornada

```
  Barbero:  [ Julian ▾ ]

  Domingo     [ no trabaja ]
  Lunes       9:40am, 10:20am, 11:00am, ...        [ editar ]
  Martes      9:40am, 10:20am, ...                 [ editar ]
  Miércoles   9:40am, 10:20am, 11:00am, 11:40am,
              12:20pm, 1:00pm                      [ editar ]
  ...

              [ Guardar cambios ]
```

Escribe en la pestaña `horarios` que ya existe desde la Fase 3. Si la pestaña
no está, **la crea con los horarios actuales ya cargados**.

⚠️ Al guardar se valida cada turno **antes** de escribir. Un `25pm` o un
`9:00` se rechazan con un mensaje claro, no se guardan a medias.

### `/panel/admins` — solo el admin principal

```
  573137127100   Admin principal    (no se puede quitar)
  573146926477   Bolon              [ quitar ]

  ┌──────────────────────┐
  │ Número nuevo         │  [ Agregar ]
  └──────────────────────┘
```

---

## 3. Bloquear horarios — cómo funciona por dentro

**No necesita lógica nueva en el bot.** Hoy los bloqueos se hacen escribiendo
filas `Descanso1`, `Descanso2` a mano en la hoja. El panel escribe exactamente
eso, pero por ti.

Como para el bot un `Descanso` es un turno ocupado normal, **el bloqueo aparece
solo** en la lista del cliente y en el panel de WhatsApp del barbero.

| Acción | Qué escribe |
|---|---|
| Bloquear | Fila nueva: nombre `Descanso`, estado `Confirmado`, teléfono vacío |
| Desbloquear | Esa fila pasa a estado `Cancelado` |

⚠️ **Nunca se borran filas.** Borrar corre los números de fila y es exactamente
el riesgo del punto 6 del backlog. Antes de escribir se relee la fila y se
verifica que sea la correcta.

---

## 4. Seguridad

Este panel puede escribir en los datos de producción. Lo que se hace al respecto:

- Todas las rutas `/panel/*` pasan por la verificación de sesión. Sin cookie
  válida, redirige a entrar.
- La cookie es `httpOnly` (no se puede leer desde JavaScript), `secure` (no
  viaja sin HTTPS) y `sameSite=strict` (no la manda un sitio ajeno).
- Los códigos son de un solo uso, con máximo 5 intentos.
- La web pública **no enlaza a `/panel`** por ningún lado. No es un secreto,
  pero tampoco hace falta anunciarlo.

### Lo que NO va a tener

Y quiero que quede escrito para que no haya sorpresas:

- **No hay bloqueo por intentos desde una misma IP.** Alguien que conozca un
  número autorizado podría probar códigos, pero tendría 5 intentos por código
  y cada código exige que el dueño del celular haya escrito al bot.
- **No hay registro de quién hizo qué.** Si Bolon y tú cambian lo mismo, no
  queda rastro de cuál fue. Se puede agregar después.

---

## 5. Cómo se va a construir

Por partes, cada una desplegable y probable sola:

| Paso | Qué | Lo ve el cliente |
|---|---|---|
| 1 | `acceso` en el bot + generación del código | No |
| 2 | `/panel` con login y sesión | No |
| 3 | `/panel/agenda`, solo ver | No |
| 4 | Bloquear y desbloquear | **Sí** ← primer efecto real |
| 5 | `/panel/horarios` | **Sí** |
| 6 | `/panel/admins` | No |

Los pasos 1 a 3 no tocan nada de lo que ve un cliente: se pueden desplegar sin
riesgo. **El paso 4 es el primero que modifica la agenda real.**

---

## 6. Dos variables nuevas en Railway

| Variable | Para qué | Si falta |
|---|---|---|
| `ADMIN_PRINCIPAL` | El número que siempre es admin | El panel no deja entrar a nadie |
| `SESION_SECRETO` | Firmar las cookies | Se genera uno al azar al arrancar: funciona, pero cada despliegue cierra las sesiones |

Ninguna de las dos rompe el bot si falta. El bot sigue igual.

---

## 7. Lo que sigue pendiente y no entra aquí

- Las **fotos de los barberos** para la web pública
- Apagar el barbero `Prueba` (`testBarberEnabled = false`)
- Los dos avisos del paso de la hora que quedaron en texto plano
- El contenido legal de verdad, revisado por alguien calificado
