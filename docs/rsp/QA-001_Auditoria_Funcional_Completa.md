# QA-001 — Auditoría Funcional Completa de RAÍZ

**Tipo:** Auditoría QA (solo lectura — no se modificó ningún archivo del proyecto)
**Metodología:** Navegación real vía UI en navegador (Chromium embebido), servidor estático local (`npx serve`, puerto 8934), datos de prueba sintéticos vía `DB.setSesion()`/`DB.saveCuidado()`/`DB.saveCompartido()` (sin credenciales reales de Firebase). Verificación de causa raíz mediante lectura de código y consola del navegador.
**Alcance cubierto:** Autenticación, Invitaciones (crear/cancelar/reenviar), Home (4 roles), Bitácora, Salud, Alimentación, Agenda, Equipo, Hogar e insumos, Gastos, Informes IA, Logout.
**Regla aplicada:** solo se reportan hallazgos con evidencia reproducida (código + acción real en UI). No se incluyen hipótesis.

---

## 1. Resumen ejecutivo

La aplicación es funcionalmente sólida en sus flujos CRUD básicos (crear/editar/eliminar en Bitácora, Salud, Alimentación, Agenda, Equipo, Hogar, Gastos funcionan correctamente y con validaciones adecuadas). Sin embargo, la auditoría encontró **un defecto sistémico de manejo de fechas** que atraviesa transversalmente seis módulos distintos, y **tres defectos aislados de severidad alta** relacionados con manejo de estado global, un modal huérfano, y el módulo de Informes con IA (el entregable más visible del producto).

El hallazgo más importante — y el que debería priorizarse por sobre todos los demás — es que la función `hoy()` (usada en más de 10 puntos del código) calcula la fecha usando UTC en lugar de la fecha local del dispositivo. Para cualquier usuario en Chile (o cualquier huso horario UTC-negativo) durante la tarde/noche, esto hace que la app "crea" que ya es el día siguiente. El efecto no es teórico: se reprodujo en vivo, sin necesitar ningún dato de prueba especial, simplemente abriendo la app a la hora actual real del sistema.

## 2. Conteo de bugs por severidad

| Severidad | Cantidad |
|---|---|
| CRÍTICO | 2 |
| ALTO | 2 |
| MEDIO | 1 |
| BAJO | 0 |
| **Total** | **5** |

## 3. Ranking de hallazgos (de mayor a menor impacto)

1. **BUG-01** (CRÍTICO) — Desfase sistémico de fecha UTC vs. local (`hoy()`)
2. **BUG-02** (CRÍTICO) — Diálogo de confirmación global queda abierto y bloquea la UI tras navegar
3. **BUG-03** (ALTO) — Selector de cuidado en "Nuevo registro" de Bitácora desincroniza el historial mostrado
4. **BUG-04** (ALTO) — Informe IA muestra markdown crudo duplicado en cada sección
5. **BUG-05** (MEDIO) — Badge de "Salud" en el sidebar no se actualiza tras confirmar un medicamento

## 4. Clúster de hallazgos agrupables

**Clúster A — "Fecha UTC vs. local" (BUG-01):** un único defecto en `hoy()` (js/app.js:247) se manifiesta de forma independiente en 6 lugares distintos de la UI. Corregir la causa raíz una sola vez resuelve las 6 manifestaciones simultáneamente. Ver detalle de cada manifestación dentro de BUG-01.

**Clúster B — Estado global no reiniciado entre pantallas (BUG-02, BUG-03):** ambos comparten la misma causa de fondo (variables de estado compartidas — `ST.bitaCuidadoId`, el overlay `confirm-ov` — que no se resetean al navegar). Se recomienda abordarlos juntos como parte de la limpieza de estado global ya documentada en RSP-007.

---

## 5. Detalle de hallazgos

### BUG-01 — Desfase sistémico de fecha: UTC vs. hora local
- **Severidad:** CRÍTICO
- **Pantallas:** Bitácora, Alimentación, Agenda, Equipo (Calendario de turnos), Gastos, Invitar personas
- **Flujo:** Cualquier flujo que registre o muestre "la fecha de hoy"
- **Cómo reproducir:**
  1. Abrir la app con la hora del sistema en la tarde/noche (ej. 20:28 hora de Chile, GMT-4).
  2. Ir a Bitácora → se ve la entrada de hoy agrupada bajo "HOY · VIERNES, 17 DE JULIO", aunque la fecha real local es **jueves 16**.
  3. Ir a Alimentación → pestaña "Plan semanal": el día marcado "HOY" es **Jueves 16** (correcto). Ir a "Registro del día": el encabezado dice "jueves, 16 de julio" (correcto) — pero al presionar "Guardar registro de hoy", el registro se guarda con `fecha: hoy()` = **2026-07-17** (viernes), no jueves 16.
  4. Ir a Agenda: el calendario resalta el día **17** como "Hoy". La sección de alertas simultáneamente muestra "Próxima cita · **mañana**" para un evento fechado exactamente ese mismo 17 — es decir, la propia pantalla se contradice a sí misma sobre si ese día es "hoy" o "mañana".
  5. Ir a Equipo → "Calendario de turnos": el día resaltado como hoy es **Jueves 16** (correcto, usa `new Date().getDay()` local).
  6. Ir a Invitar personas → generar un código de invitación: el modal de confirmación dice "Válido por 7 días"; segundos después, en la lista de "Invitaciones pendientes", el mismo código muestra "Expira en **8 días**".
- **Resultado esperado:** la app debe usar consistentemente la fecha calendario local del dispositivo del usuario en todos los módulos, sin desfases entre pantallas.
- **Resultado obtenido:** dos sistemas de cálculo de "hoy" coexisten y no coinciden: `hoy()` (UTC) vs. `new Date().getDay()`/`new Date()` directo (local). Producen fechas distintas para el mismo instante real, y esto es visible en la misma sesión, en la misma pantalla en el caso de Agenda.
- **Causa probable:** `function hoy(){ return new Date().toISOString().split('T')[0]; }` en `js/app.js:247`. `toISOString()` siempre convierte a UTC antes de extraer la fecha. Para cualquier usuario con offset UTC negativo (todo el continente americano, incluido Chile en horario de invierno UTC-4), a partir de cierta hora de la tarde la fecha UTC ya es "mañana" en términos locales.
- **Archivo(s) y función(es) involucradas:**
  - `js/app.js:247` — `function hoy()` (causa raíz)
  - `js/app.js:1253` — `function esHoy(f){ return f===hoy(); }` (Bitácora, hereda el bug)
  - `js/app.js:3299,3310` — `guardarRegistroDiario()` (Alimentación, hereda el bug)
  - `js/app.js:4047` — `renderAgenda()`, `ST.diaSeleccionado=hoy()` (Agenda, hereda el bug)
  - `js/app.js:4028-4031` — `diasHasta()` usa `new Date()` local correctamente → de ahí la contradicción visible en Agenda
  - `js/app.js:2821` — `function diaHoy(){ return DIAS[new Date().getDay()===0?6:new Date().getDay()-1]; }` (Equipo, correcto/local — contradice a `hoy()`)
  - `js/app.js:5780-5793` — `crearInvitacion()`, calcula `expira` con `new Date()` local + 7 días, pero lo serializa con `.toISOString()` (vuelve a introducir el desfase UTC)
  - `js/app.js:5895-5896` — cálculo de `diasRestantes` compara contra `new Date()` local, exponiendo la discrepancia de 7 vs. 8 días
- **Impacto:** confusión real para el usuario sobre qué día es "hoy"; riesgo de que un cuidador registre datos clínicos (signos vitales, medicamentos, comidas) bajo la fecha calendario incorrecta; una cita "de hoy" puede aparecer marcada como "de mañana" en la misma pantalla; los códigos de invitación quedan válidos un día más de lo anunciado al usuario.
- **Prioridad:** máxima. Es el hallazgo con mayor blast radius de toda la auditoría — una sola corrección en `hoy()` (cambiarlo para usar componentes de fecha locales en vez de `toISOString()`) resuelve las 6 manifestaciones descritas.

---

### BUG-02 — El diálogo de confirmación global queda "pegado" en pantalla al navegar
- **Severidad:** CRÍTICO
- **Pantallas:** cualquiera que use el helper compartido `confirmar()` (18 puntos de uso: eliminar bitácora, eliminar gasto, eliminar persona del equipo, eliminar insumo, archivar informe, cancelar invitación, cerrar sesión, etc.)
- **Flujo:** Informes IA → "Archivar" (o cualquier acción de eliminar/archivar en cualquier módulo)
- **Cómo reproducir:**
  1. Generar y abrir un informe en Informes IA.
  2. Pulsar "📁 Archivar" → aparece el modal "¿Archivar este informe?".
  3. En vez de pulsar Cancelar o Confirmar, hacer clic en cualquier ítem del menú lateral (ej. "Invitar personas").
  4. La navegación ocurre con normalidad, pero el modal "¿Archivar este informe?" permanece visible, superpuesto sobre la nueva pantalla, con overlay oscurecido de fondo bloqueando la interacción con el contenido debajo.
- **Resultado esperado:** al navegar a otra pantalla, cualquier diálogo de confirmación abierto debería cerrarse automáticamente.
- **Resultado obtenido:** el overlay `#confirm-ov` conserva la clase `open` (`display:flex`, `z-index:300`) de forma completamente independiente del ciclo de vida de pantallas que gestiona `navTo()`. Persiste indefinidamente hasta que el usuario logra localizar y pulsar "Cancelar" (que puede quedar visualmente desalineado sobre el nuevo contenido).
- **Causa probable:** `navTo()` (js/app.js:258) gestiona la visibilidad de `.screen`, pero nunca verifica ni cierra el overlay genérico `#confirm-ov` que crea `function confirmar(title,text,cb)` (js/app.js:1117). Como este modal es compartido por 18 flujos distintos en todo el codebase, cualquiera de ellos puede dejarlo "huérfano".
- **Archivo(s) y función(es) involucradas:** `js/app.js:258` (`navTo`), `js/app.js:1117` (`confirmar`)
- **Impacto:** bloqueo de UI percibido como "la app se congeló"; el usuario no tiene una vía obvia para des-atascarse salvo recargar la página, ya que el modal se ve pero no siempre queda claro que pertenece a una acción de la pantalla anterior.
- **Prioridad:** alta. Fix acotado: en `navTo()`, cerrar/ocultar `#confirm-ov` (y cualquier overlay `.open` remanente) al inicio de la función, antes de activar la nueva pantalla.

---

### BUG-03 — El selector de cuidado en "Nuevo registro" de Bitácora desincroniza el historial mostrado
- **Severidad:** ALTO
- **Pantallas:** Bitácora (historial y "Nuevo registro"), en cuentas admin con más de un cuidado activo (multi-cuidado)
- **Flujo:** Bitácora → Nuevo registro → cambiar el selector "¿Para quién es este registro?" → volver al historial sin guardar
- **Cómo reproducir:**
  1. Como admin con 2 cuidados activos (ej. "Marta Test" activo en el sidebar, "Pedro Test" secundario), ir a Bitácora → ver el historial de Marta correctamente.
  2. Pulsar "+ Nuevo registro". En el selector de cuidado del formulario, elegir "Pedro Test" (sin guardar nada).
  3. Volver al historial de Bitácora (pestaña inferior o botón "Volver").
  4. El encabezado ahora dice "Pedro Test · historial completo" y la lista muestra "Sin registros" — pese a que el panel lateral "Cuidado activo" sigue mostrando "Marta Test".
  5. Si Pedro Test sí tiene registros, al hacer clic sobre uno de ellos aparece el toast "Registro no encontrado" y la pantalla no navega al detalle — el clic queda completamente roto mientras dure la desincronización.
  6. Cambiar de cuidado desde el switcher legítimo del sidebar tampoco corrige el problema: la variable queda "pegada" hasta que el usuario vuelve a entrar al selector de "Nuevo registro" y elige explícitamente el cuidado correcto.
- **Resultado esperado:** el listado de Bitácora debe reflejar siempre el "Cuidado activo" indicado en el sidebar, y cada entrada debe abrir su propio detalle sin errores.
- **Resultado obtenido:** `renderLista()` (que dibuja el historial) prioriza `ST.bitaCuidadoId` — una variable que solo debería vivir dentro del formulario de "Nuevo registro" — por sobre el cuidado activo real de la sesión. Mientras tanto, `verDetalle(id)` sigue buscando el registro en el cuidado activo de la sesión (`DB.getCuidado()`), no en `ST.bitaCuidadoId`. El resultado es una desincronización entre qué cuidado se está *listando* y en cuál se *busca el detalle*, generando tanto datos mostrados incorrectos como errores de "no encontrado".
- **Causa probable:** `ST.bitaCuidadoId` es una variable de estado global compartida entre el formulario "Nuevo registro" (`initSelectorCuidado`/`selCuidadoBita`, js/app.js:1261-1284) y el historial (`renderLista`, js/app.js:1320-1322), sin resetearse al salir del formulario ni al cambiar de cuidado vía el switcher del sidebar (`selCuidado`, js/app.js:1026).
- **Archivo(s) y función(es) involucradas:** `js/app.js:1281` (`selCuidadoBita`), `js/app.js:1322` (`renderLista`), `js/app.js:1428` (`verDetalle`, usa `DB.getCuidado()` en vez de `ST.bitaCuidadoId`)
- **Impacto:** en cuentas multi-cuidado (un escenario de uso real y soportado por la app), el admin puede terminar viendo — o intentando abrir sin éxito — el historial de un familiar distinto al que cree estar viendo, con riesgo de confusión clínica.
- **Prioridad:** alta. Ligado conceptualmente a la limpieza de estado global ya identificada en RSP-007.

---

### BUG-04 — El Informe IA muestra markdown crudo duplicado en cada sección
- **Severidad:** ALTO
- **Pantalla:** Informes IA → ver informe generado → versión "Para la familia"
- **Flujo:** Generar informe mensual → abrir el informe
- **Cómo reproducir:**
  1. Ir a "Informe mensual" → pulsar "Generar informe" (o generarlo directamente con datos reales de Bitácora/Salud/Gastos).
  2. Abrir el informe generado, pestaña "Para la familia".
  3. Cada sección del cuerpo del informe aparece **duplicada**: un encabezado tipo bullet ("• ESTADO GENERAL:") seguido inmediatamente por el mismo texto repetido con los asteriscos de markdown sin procesar: **"\*\*Estado general:\*\* Marta Test mostró un estado de ánimo positivo..."**
  4. Esto se repite idénticamente en las secciones Estado general, Signos vitales, Alimentación, Medicamentos y Gastos del mes — es decir, en el 100% del contenido del informe familiar.
- **Resultado esperado:** cada sección debe mostrarse una sola vez, con el título como encabezado estilizado y el texto correspondiente debajo, sin marcas de markdown visibles.
- **Resultado obtenido:** el título aparece como encabezado (correcto) Y el párrafo completo se repite debajo con los asteriscos `**` visibles literalmente.
- **Causa probable:** en `renderContenidoInforme()` (js/app.js:5574-5577), la expresión regular que debería eliminar el prefijo `**Título:**` del párrafo es `parrafo.replace(/\*\*[^*]+\*\*:\s*/,'')` — asume que el `:` viene **después** del cierre de `**`. Pero el texto real generado por `generarResumenFamiliar()` tiene el formato `**Estado general:**` — el `:` está **dentro** de los asteriscos, no después. Como el patrón nunca calza, el `.replace()` no elimina nada y el párrafo completo (con sus asteriscos) queda intacto debajo del título ya extraído.
- **Archivo(s) y función(es) involucradas:** `js/app.js:5574-5577` (`renderContenidoInforme`, causa raíz); `js/app.js:5453-5468` (`generarResumenFamiliar`, genera el texto con el formato `**Label:**` que dispara el bug)
- **Nota de alcance:** los botones "💬 WhatsApp" y "📋 Copiar" del mismo informe **no** están afectados — `compartirInformeWA()` y `copiarInforme()` usan su propio `.replace(/\*\*/g,'')`, que sí limpia correctamente los asteriscos antes de compartir. El defecto es exclusivo de la vista en pantalla.
- **Impacto:** el informe IA es el entregable central y más visible de todo el módulo "Informes"; mostrarlo con texto duplicado y marcas de markdown sin procesar transmite una imagen de producto no terminado a cada familia que lo revise, en el 100% de los casos.
- **Prioridad:** alta — visibilidad muy alta, fix acotado a una expresión regular.

---

### BUG-05 — El badge de pendientes de "Salud" en el sidebar no se actualiza al confirmar un medicamento
- **Severidad:** MEDIO
- **Pantalla:** Salud → Medicamentos (afecta el badge del ítem "Salud" en el menú lateral)
- **Flujo:** Confirmar la toma de un medicamento
- **Cómo reproducir:**
  1. Con un medicamento pendiente de confirmar hoy, el sidebar muestra el badge rojo "1" junto a "Salud".
  2. En Salud → Medicamentos, pulsar el botón de confirmar (✓) del medicamento. El panel se actualiza correctamente a "1/1 confirmados" y el botón cambia a estado confirmado.
  3. El badge "1" junto a "Salud" en el sidebar **permanece visible sin cambios**, pese a que ya no hay medicamentos pendientes.
  4. Al navegar a Inicio y volver, el badge desaparece correctamente (se corrige recién en ese momento).
- **Resultado esperado:** el badge de pendientes debe reflejar el estado actualizado inmediatamente después de confirmar/desconfirmar un medicamento.
- **Resultado obtenido:** el badge queda desactualizado hasta que ocurre una navegación que fuerce un nuevo `renderSidebar()`.
- **Causa probable:** `confMed()` (js/app.js:2095-2129) actualiza `cuidado.confirmaciones` y guarda los cambios, pero no invoca `renderSidebar()` (js/app.js:940), a diferencia de otros puntos del código que sí lo hacen tras cambios similares.
- **Archivo(s) y función(es) involucradas:** `js/app.js:2095` (`confMed`), `js/app.js:940` (`renderSidebar`)
- **Impacto:** menor — solo cosmético/informativo, no afecta datos ni bloquea ninguna acción; se autocorrige con cualquier navegación posterior.
- **Prioridad:** baja-media. Fix trivial: agregar `renderSidebar();` al final de `confMed()`.

---

## 6. Hallazgos investigados y descartados (con evidencia)

Para cumplir con la exigencia de "solo evidencia comprobada", se documentan aquí los casos que se investigaron a fondo y **no** calificaron como bug confirmado:

- **Cambio de cuidado multi-cuidado en Home:** se sospechó inicialmente un bug al cambiar entre "Marta Test"/"Pedro Test" desde las tarjetas de Home o el switcher del sidebar. Tras corregir un error en el propio selector de prueba, se confirmó que el cambio de cuidado **funciona correctamente** en ambos puntos de entrada.
- **Categoría "undefined" en el texto de rendición de Gastos (WhatsApp/Copiar) y "freq: undefined" en el informe clínico:** ambos se remontan a un registro de prueba (`{"monto":12000}` sin categoría) y un medicamento de prueba sembrados directamente en `_cache` al inicio de esta sesión de QA, sin pasar por los formularios reales. Se verificó que `guardarGasto()` exige y siempre completa el campo `cat`, y que el flujo real de alta de medicamentos siempre calcula `freq`. Por lo tanto, **no es reproducible por un usuario real** a través de la UI actual, y se excluye como hallazgo confirmado (aunque el código de fallback en cuestión — `CATS[c]?.label||c` vs. `CATS[cat]||CATS.otro` — es inconsistente y podría fallar ante datos legados; se deja como nota, no como bug).
- **Desalineación visual del subrayado de pestañas (Alimentación, Gastos):** el guion visual bajo la pestaña activa tarda una fracción de segundo en desplazarse tras el clic. Se confirmó vía DOM que la clase `on` se aplica correctamente de inmediato; el desfase es una animación CSS de transición, no un error de estado.
- **`navTo()` deja la pantalla en blanco si se le pasa un id inexistente:** cierto (el código borra `.active` de todas las pantallas antes de validar que el id exista), pero se verificó exhaustivamente que **ningún** punto real de la aplicación (botones, links, sidebar) invoca `navTo()` con un id inválido — todos los 25 call-sites literales apuntan a pantallas existentes. No es alcanzable por un usuario real; se excluye.
- **Flujo de "recordar sesión" / recuperación de sesión:** no se pudo völlig completar sin credenciales reales de Firebase Auth (política de seguridad de esta auditoría prohíbe crear cuentas reales). El comportamiento observado al simular una sesión persistida sin Auth real es un artefacto del entorno de prueba, no evidencia de un bug de producción.

---

## 7. Plan de remediación sugerido (4 sprints)

**Sprint 1 — Causa raíz de fechas (máximo impacto, fix único):**
- Corregir `hoy()` (js/app.js:247) para usar componentes de fecha locales (`getFullYear()/getMonth()/getDate()`) en vez de `toISOString()`.
- Corregir `crearInvitacion()` (línea `expira.toISOString()...`) con el mismo criterio.
- Regresión: verificar Bitácora, Alimentación, Agenda, Invitaciones tras el cambio, en especial cerca de la medianoche y con el reloj del sistema en UTC-3/UTC-4.

**Sprint 2 — Estado global colgado entre pantallas:**
- `navTo()`: cerrar cualquier overlay `.open` (en particular `#confirm-ov`) antes de activar la nueva pantalla (BUG-02).
- Resetear `ST.bitaCuidadoId` al entrar a la lista de Bitácora si no coincide con la sesión activa, o al cambiar de cuidado vía `selCuidado()` (BUG-03).
- Alinear `verDetalle()` para resolver el cuidado de la misma forma que `renderLista()`.

**Sprint 3 — Informe IA:**
- Corregir la expresión regular de `renderContenidoInforme()` para que coincida con el formato real `**Label:**` (BUG-04).
- Revisión visual de las 6 secciones del informe familiar tras el fix.

**Sprint 4 — Pulido menor:**
- Agregar `renderSidebar()` al final de `confMed()` (BUG-05).
- Revisar el patrón de fallback `CATS[c]?.label||c` en `renderRendicion()` para que use el mismo criterio de respaldo que la vista en pantalla (`CATS[cat]||CATS.otro`), como prevención ante datos legados sin categoría.

---

*Informe generado como parte de una auditoría QA de solo lectura. No se modificó ningún archivo del proyecto durante esta tarea.*
