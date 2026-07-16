# RSP-007 — Auditoría de Arquitectura: Estado Global y Responsabilidades
### Proyecto RAÍZ

> Informe de solo lectura. No se modificó ningún archivo durante esta auditoría. Todo hallazgo está verificado directamente contra `js/app.js` (líneas citadas corresponden al estado del archivo posterior a BT-001, BT-004, BT-005, BT-010, BT-011, BT-012, BT-013, BT-027, BT-028, BT-029, BT-032 y los dos fixes de bugs de reutilización de invitación / stock de insumos). No se proponen soluciones ni implementaciones — es un mapa de evidencia para decisiones futuras.

---

## 1. `ST` — Estado global

**Declaración:** `const ST = {...}`, línea 1210-1246, objeto único a nivel de módulo.

### 1.1 Propiedades realmente declaradas en el literal (22 + `form` anidado)

`bitaCuidadoId, filtro, bitacoraActual, form{quien,presion,temp,sato,desayuno,almuerzo,cena,bano,hidra,activ,visita,animo}, tabActivo, medEditando, tab, porciones, vasitos, mesVista, gastoEditandoId, tabEquip, diasSeleccionados, editDiasSeleccionados, tabHogar, anioActual, mesActual, diaSeleccionado, eventoEditandoId, tipoActual, eventoCuidadoId, ocrMeds`

### 1.2 Hallazgo — propiedades usadas en tiempo de ejecución que NUNCA fueron declaradas en el literal

Búsqueda exhaustiva de `ST\.\w+` en todo el archivo encontró **30 propiedades de primer nivel en uso real**, 8 de las cuales no existen en el literal de la línea 1210 y solo cobran existencia la primera vez que alguna función las asigna (quedan `undefined` hasta entonces):

| Propiedad no declarada | Dónde nace | Riesgo |
|---|---|---|
| `docFiltro` | `setDocFiltro()` | Bajo — leída solo por `renderDocs()`, que ya maneja `undefined` con fallback. |
| `editInsumoId` | `abrirSheetInsumo()`/`editarInsumo()` | Bajo, uso análogo a `gastoEditandoId` (sí declarada) — inconsistencia de convención, no de riesgo funcional. |
| `editProvId` | `abrirSheetProveedor()`/`editarProveedor()` | Igual que arriba. |
| `informeActual` | `mostrarInforme()` | Bajo. |
| `medEditandoId` | `editarStock()` | Ver 1.4 — nunca se limpia. |
| `mesGenerando` | `iniciarGeneracion()` | Bajo. |
| `filtroInsumo` | `setFiltroInsumo()` | Bajo. |
| `vasosAgua` | `renderDiario()`/`togVaso()` | **Alto** — ver 1.3, reemplaza de facto a `vasitos` sin que nadie lo haya declarado. |
| `version` | `mostrarInforme()`/`selVersion()` | Bajo. |
| `_homeDirty` | `navTo()` | Se escribe (tras entrar a un home) pero **no se lee en ningún punto del archivo** — bandera muerta. |

### 1.3 Deriva de nombre confirmada: `vasitos` vs. `vasosAgua`

La propiedad declarada `vasitos: 0` (línea 1227) **no se lee ni se escribe en ningún otro punto del archivo** (0 referencias además de la declaración). El feature real de "vasos de agua" del módulo Alimentación opera enteramente sobre `ST.vasosAgua`, una propiedad **no declarada**, inicializada solo la primera vez que `renderDiario()` la asigna (línea 3159: `if(bitaHoy.vasosAgua!==undefined) ST.vasosAgua=bitaHoy.vasosAgua||0`). Si `renderDiario()` se invoca antes de esa asignación condicional (p. ej. un día sin bitácora previa), `ST.vasosAgua` permanece `undefined` y las comparaciones `i<ST.vasosAgua` (línea 3183) evalúan `false` para todo `i`, degradando silenciosamente a "0 vasos" — funciona por coincidencia aritmética, no por diseño.

### 1.4 Deriva de nombre confirmada: `medEditando` vs. `medEditandoId`

Son **dos slots distintos para dos flujos distintos** dentro del mismo módulo de Medicamentos:
- `medEditando`: escrita/leída por `abrirSheetMed()`, `editarMed()`, `guardarMedManual()` (flujo "agregar/editar medicamento"). Se resetea a `null` correctamente al cerrar (línea 2331).
- `medEditandoId`: escrita solo por `editarStock()` (línea 2158), leída solo por `guardarReposicion()` (línea 2210). **Nunca se resetea a `null`** tras usarse — no causa bug hoy porque cada apertura de `editarStock(medId)` la sobrescribe antes de la siguiente lectura, pero es el tipo exacto de propiedad "huérfana" que un futuro refactor podría leer en un contexto equivocado, dado lo similar de su nombre a `medEditando`.

### 1.5 Hallazgo mayor — colisión real entre módulos vía `ST.tab`

`ST.tab` es escrita por **cuatro funciones de cuatro módulos distintos** como si fuera su propia variable de "tab activo", cuando en realidad es una sola:

| Función | Línea | Módulo | También escribe |
|---|---|---|---|
| `setTabAlim` | 2835 | Alimentación (M5) | — (`tab` es su única variable de tab) |
| `setTabEquip` | 3577 | Equipo (M6) | `ST.tabEquip` (ambas a la vez) |
| `setTabHogar` | 4455 | Hogar (M8) | `ST.tabHogar` (ambas a la vez) |
| `setTabGastos` | 4821 | Gastos (M9) | — |

Y es **leída por `eliminarPersona()`** (Equipo/M6, línea 3989): `renderTab(ST.tab)`. El problema: `renderTab()` (línea 1927) es el dispatcher **exclusivo del módulo Salud (M4)** — solo reconoce `tab==='meds'|'ficha'|'docs'|'historial'`. Cuando un admin elimina una cuidadora o especialista desde la pantalla de Equipo, `ST.tab` contiene `'cuidadoras'` o `'especialistas'` (dejado ahí por `setTabEquip`), valor que **ninguna rama de `renderTab()` reconoce** — la llamada no hace nada útil (solo actualiza el subtítulo de la pantalla de Salud, invisible porque el usuario no está ahí). **Consecuencia: tras eliminar una persona del equipo de cuidado, la lista en pantalla no se refresca** — la persona eliminada sigue visible hasta que el usuario navega fuera y vuelve a entrar a Equipo. Confirmado por lectura directa de `renderTab()`; no se probó en navegador porque la instrucción de esta auditoría es de solo lectura.

### 1.6 Riesgo de "bleed" entre cuidados vía `ST.porciones`

`ST.porciones` (declarada `{}`) se reconstruye parcialmente cada vez que `renderDiario()` corre, con la lógica `ST.porciones.desayuno = bitaHoy.desayuno || ST.porciones.desayuno` (líneas 3156-3158) — es decir, **si la bitácora de hoy del cuidado activo no tiene un campo aún registrado, se conserva el valor previo que había en `ST.porciones`**, sin importar de qué cuidado provino. En una cuenta de administrador con más de un familiar a cargo, cambiar de cuidado activo y entrar a "Registro diario" antes de que ese campo se registre para el nuevo cuidado puede mostrar temporalmente el valor de porción del cuidado anterior. Mismo patrón de causa raíz que 1.5 (variable compartida sin namespacing por cuidado/módulo).

### 1.7 Quién escribe / quién lee — tabla completa por propiedad

| Propiedad | Escriben | Leen | Pantallas |
|---|---|---|---|
| `bitaCuidadoId` | `initSelectorCuidado`, `selCuidadoBita` | `initSelectorCuidado`, `renderLista` | Bitácora (M3) |
| `filtro` | `setFiltro` | `renderLista` | Bitácora (M3) |
| `bitacoraActual` | `mostrarResumenIA`, `verDetalle` | `copiarResumen`, `enviarWhatsApp`, `textoWA` | Bitácora (M3) |
| `form` (+ subcampos) | `initFormulario` (reset completo), `selQuien`, `selPorcion`, `togChk`, `selAnimo`, `validarPresion`, `validarTemp`, `validarSato` | `guardarBitacora`, todas las anteriores | Bitácora (M3) — Nueva bitácora |
| `tabActivo` | `navTo`, `setTab`, `agregarMedsOCR` | `fabAction` | Salud (M4) |
| `medEditando` | `abrirSheetMed`, `editarMed`, `guardarMedManual` | `guardarMedManual` | Salud (M4) — Medicamentos |
| `medEditandoId` | `editarStock` | `guardarReposicion` | Salud (M4) — Stock |
| `docFiltro`* | `setDocFiltro` | `renderDocs` | Salud (M4) — Documentos |
| `tab` | `setTabAlim`, `setTabEquip`*, `setTabHogar`*, `setTabGastos` | `navTo`, `fabActionAlim`, `renderTabGastos`, **`eliminarPersona` (bug, 1.5)** | Alimentación/Equipo/Hogar/Gastos |
| `porciones` | `renderDiario`, `selPorcionAlim` | `renderDiario`, `guardarRegistroDiario` | Alimentación (M5) — Registro diario |
| `vasosAgua`* | `renderDiario`, `togVaso` | `renderDiario`, `togVaso`, `guardarRegistroDiario` | Alimentación (M5) — Registro diario |
| `mesVista` | `selMes` | `renderRegistro`, `renderPresupuesto`, `renderRendicion`, `renderTabGastos` | Gastos (M9) |
| `gastoEditandoId` | `abrirSheetGasto`, `editarGasto` | `guardarGasto`, `eliminarGastoActual` | Gastos (M9) |
| `tabEquip` | `setTabEquip` | `fabActionEquip` | Equipo (M6) |
| `diasSeleccionados` / `editDiasSeleccionados` | `abrirSheetCuidadora` / `editarCuidadora` | `guardarCuidadora`/`actualizarCuidadora`, `toggleDiaEquip` | Equipo (M6) |
| `editInsumoId`* / `editProvId`* | `abrirSheetInsumo`/`editarInsumo` · `abrirSheetProveedor`/`editarProveedor` | `guardarInsumo`/`eliminarInsumoActual` · `guardarProveedor`/`eliminarProvActual` | Hogar (M8) |
| `filtroInsumo`* | `setFiltroInsumo` | `renderInsumos` | Hogar (M8) |
| `tabHogar` | `setTabHogar` | `fabActionHogar` | Hogar (M8) |
| `anioActual`/`mesActual`/`diaSeleccionado` | `cambiarMes`, `guardarEvento`, `renderAgenda`, `selDia` | `renderCalendarioAgenda`, `renderDiaSeleccionado`, `abrirSheetEvento`, `guardarComida` | Agenda (M7) |
| `eventoEditandoId`/`tipoActual`/`eventoCuidadoId` | `abrirSheetEvento`, `editarEvento`, `selTipo`, `initSelectorCuidadoEvento`, `selCuidadoEvento` | `guardarEvento`, `eliminarEventoActual`, `actualizarEstilosTipo`, `renderChipsCuidadoEvento` | Agenda (M7) |
| `ocrMeds` | `mostrarResultadoOCR`, `resetOCR` | `agregarMedsOCR`, `toggleOcrMed` | Salud (M4) — OCR |
| `mesGenerando`*/`informeActual`*/`version`* | `iniciarGeneracion`, `mostrarInforme`, `selVersion` | `generarInformeIA`, `archivarInforme`, `compartirInformeWA`, `copiarInforme`, `renderContenidoInforme` | Informe IA (M10) |
| `_homeDirty`* | `navTo` | **ninguna función la lee** | (transversal) |
| `vasitos` | ninguna | ninguna | — (muerta) |

`*` = propiedad no declarada en el literal (ver 1.2).

### 1.8 Cuáles nunca se limpian
`medEditandoId` (1.4), `bitaCuidadoId` (persiste entre sesiones de bitácora, posiblemente intencional), `_homeDirty` (se escribe pero no se lee — ni "limpiar" ni "usar" tienen sentido para una bandera que nadie consume).

### 1.9 Cuáles podrían agruparse
Los pares "editar X" (`medEditando`/`medEditandoId`, `gastoEditandoId`, `eventoEditandoId`, `editInsumoId`, `editProvId`, `editDiasSeleccionados`) siguen exactamente el mismo patrón (`null` por defecto, se asigna un id al entrar en modo edición, se limpia al abrir "nuevo") y podrían vivir bajo un único namespace `ST.editing = {tipo, id}` en vez de 6+ propiedades paralelas. De igual forma, los `tabX` (`tab`, `tabActivo`, `tabEquip`, `tabHogar`) podrían namespacearse por módulo (`ST.tabs = {alim, salud, equipo, hogar, gastos}`) — lo que habría prevenido directamente el bug de 1.5.

---

## 2. `renderHome()`

**Ubicación:** línea 726-952. **Tamaño:** 227 líneas — la función más grande del archivo.

**Responsabilidades identificadas (mezcladas en una sola función):**
1. Guardia de recuperación de datos corruptos/`cuidadoId` inválido (727-761, ~35 líneas) — incluye lógica de re-intento recursivo (`renderHome(rol)` se llama a sí misma).
2. Cómputo de datos compartidos por las 4 ramas de rol (762-799): `bitaHoy`, `meds`, `medsHoy`, `comp`, `gastos`, `totalGastos`, `todosCuidados`.
3. Tres helpers-closure redefinidos en cada invocación (`setHdr`, `sem`, `hero` — líneas 776-797) — se recrean en memoria en cada render en lugar de existir una sola vez.
4. Rama **admin** (801-866, ~66 líneas): construye una tarjeta por cada cuidado administrado (plantilla HTML inline de ~40 líneas dentro de un `forEach`) + botón "agregar cuidado" + acciones rápidas.
5. Rama **familiar** (868-898, ~31 líneas): próximos eventos + resumen IA + acciones rápidas + resumen de gastos.
6. Rama **observador** (900-912, ~13 líneas): vista de solo lectura.
7. Rama **cuidadora** (914-951, ~38 líneas): checklist de turno con progreso.

**Funciones que llama:** `DB.getSesion`, `DB.getCuidado`, `DB.getCuidados`, `DB.setSesion`, `DB.getCuidadosAdmin`, `DB.getCompartido`, `DB.getAlim`, `fechaHoy`, `hoy`, `initials`, `calcularEdad`, `fmt`, `renderSidebar` (una vez por cada una de las 4 ramas), `$`, y llamadas recursivas a sí misma (guardia de recuperación).

**Dependencias:** **cero referencias a `ST`** — opera exclusivamente sobre `DB` (sesión/cuidado/compartido) y sus propios closures locales. Es, paradójicamente, la función menos acoplada al estado global compartido pese a ser la más grande — su complejidad es de tamaño/ramificación, no de acoplamiento a `ST`.

**Funciones que podrían extraerse** (solo como referencia de dónde están los cortes naturales — no se proponen implementaciones):
- El bloque de guardia/recuperación (727-761) → función independiente, p. ej. `renderHomeSinDatos(rol)`.
- Cada rama de rol → 4 funciones independientes (`renderHomeAdmin`, `renderHomeFamiliar`, `renderHomeObservador`, `renderHomeCuidadora`), cada una recibiendo los datos ya calculados.
- La plantilla de tarjeta de cuidado dentro del `forEach` admin (807-846, ~40 líneas) → su propio helper de template.
- Los tres closures compartidos (`setHdr`, `sem`, `hero`) → funciones de nivel de módulo en vez de recrearse en cada llamada.

---

## 3. Variables singleton/globales (fuera de `ST`)

Además de las constantes de solo-lectura (`ROL_COLOR`, `DIAS`, `TIPO_ICO`, `CATS`, etc., que son tablas de referencia inmutables, no estado), existen **11 variables mutables de módulo** + **4 asignaciones a `window`**:

| Variable | Línea decl. | Escriben | Leen | ¿Eliminable? | ¿Integrar a `ST`? |
|---|---|---|---|---|---|
| `_tipoReg` | 331 | `selTipoRegistro` | `continuarRegistro` | No (vive fuera del ciclo de vida de `ST`, es pre-sesión) | Podría, bajo prioridad |
| `_codigoActual` | 449 | `actualizarCodigo` | `validarCodigo` | No | Podría |
| `_invActual` | 449 | `validarCodigo` | `registrarInvitado` (9 usos) | No — es el puente entre validar y registrar invitado | Sí, encaja en el patrón "editing slot" |
| `_onbCuidadoras` | 588 | `crearNuevoCuidado`* | `onbRenderCuidadoras`, `onbAgregarCuidadora`, `onbEliminarCuidadora`, `guardarOnbSalud` | No | Podría |
| `_cb` | 1131 | `confirmar`, `cerrarConfirm` | las 9 asignaciones idénticas `$('cb-ok').onclick=...` (ya documentadas como duplicación en el backlog) | No — es la base de todo el sistema de confirmación | No — es infraestructura transversal, no dato de un módulo |
| `_navOrig` | 2787 | (asignación única, referencia a la función original) | `window.navTo` | No | No aplica — es una referencia de función, no estado |
| `_catCompraActual` | 3419 | `abrirSheetCompra`, `selCatCompra` | `guardarCompra` | Sí, candidata a fusionarse con las otras 3 `_catXActual` | Sí |
| `_catInsumoActual` | 4574 | `abrirSheetInsumo`, `editarInsumo`, `selCatInsumo` | `editarInsumo`, `guardarInsumo` | Sí | Sí |
| `_catProvActual` | 4699 | `abrirSheetProveedor`, `editarProveedor`, `selCatProv` | `editarProveedor`, `guardarProveedor` | Sí | Sí |
| `_catActual` | 5108 | `abrirSheetGasto`, `editarGasto`, `selCat` | `editarGasto`, `guardarGasto`, `selCat` | Sí | Sí |
| `_invCodigoActual` | 5725 | `abrirSheetInvitacion`, `crearInvitacion`, `reenviarInvitacion` | `copiarCodigoInv`, `compartirCodigoInv` | No | Podría |
| `_boletaDataUrl` | 6024 | `previewBoleta`, `limpiarBoleta`, `cargarBoletaExistente` | `previewBoleta`, `guardarGasto` | No | Podría |
| `window._raizOnAuth` | 1157 | (asignación única) | invocada por `onAuthStateChanged` en `js/firebase-config.js` | No — es el contrato entre archivos | No aplica |
| `window.navTo` | 2788 | (asignación única, sobreescribe la función original) | todos los `onclick="navTo(...)"` de `index.html` | No | No aplica (es monkey-patch de función, no dato) |
| `window.RAIZ` | 1202 | (asignación única) | nadie dentro de `app.js` — es API pública/debug expuesta a la consola | Revisar con el equipo — superficie de depuración externa | No aplica |
| `window._resumenRendicion` | 5102 | `renderRendicion` | `copiarRendicion` | Sí, es exactamente el mismo patrón que `_cb` (slot único implícito) | Sí — candidato más claro para integrarse a `ST` |

**Patrón repetido detectado:** las 4 variables `_catXActual` (Compra, Insumo, Proveedor, Gasto — "categoría seleccionada en sheet") son, en la práctica, **el mismo concepto repetido 4 veces** con nombres distintos — mismo ciclo de vida (`abrirSheetX` la resetea, `selCatX` la cambia, `guardarX` la lee una sola vez). Son el ejemplo más claro de variables singleton que podrían vivir como una única propiedad namespaced dentro de `ST` (p. ej. `ST.catSeleccionada`) en vez de 4 globales paralelas.

---

## 4. Firestore — mapa completo

**Helpers de acceso:** `_fsSet(path, data)` (línea 19, siempre `setDoc(ref, data, {merge:false})` — reemplazo completo del documento) y `_fsGet(path)` (línea 31, `getDoc` envuelto). Coexisten con llamadas **directas** a `fb.getDoc`/`fb.getDocs`/`fb.collection`/`fb.query` fuera de esos helpers (inconsistencia de acceso, ver más abajo).

| Colección/Documento | Escrituras (función → línea) | Lecturas (función → línea) | Estado |
|---|---|---|---|
| `usuarios/{uid}` | `registrarAdmin`(421), `registrarInvitado`(531), `DB.setUsuarios`(118, iterando) | `_fsGet` en `validarCodigo`(366, dentro de onboarding), `window._raizOnAuth`(1161), `recargarDesdeFB`(6114); `fb.getDoc` directo(58) + query por `adminId`(51-54) en `_cargarDatosFirestore` | Activa, consistente |
| `cuidados/{id}` | `registrarAdmin`(422), `guardarOnbSalud`(714, explícito) + `DB.saveCuidado`/`DB.setCuidados`(133,145, iterando) | `_fsGet` en `validarCodigo`(499); query por `adminId`(65-68) en `_cargarDatosFirestore` | Activa, consistente |
| `compartido/{adminId}` | `registrarAdmin`(427), `guardarOnbSalud`(715, explícito — nota: escribe a `compartido/{s.userId}`, correcto solo porque en ese punto del flujo `s.userId===adminId`) + `DB.saveCompartido`(168, todos los módulos M5-M9 la usan indirectamente) | `fb.getDoc` directo(74) en `_cargarDatosFirestore` — **no usa el helper `_fsGet`**, inconsistencia de acceso | Activa, pero con doble mecanismo de escritura redundante en onboarding (explícito + vía `DB`) |
| `invitaciones` (colección, query por `adminId`) | **Ninguna función escribe aquí** | `_cargarDatosFirestore`(80-82) | **Lectura muerta** — la consulta siempre devuelve vacío porque nada escribe en esta colección. |
| `invitaciones_hogar/{adminId}` (documento, `{lista,actualizado}`) | `DB.setInvs`(126) — se dispara en cada cambio de invitaciones | **Ningún `_fsGet`/`getDoc` la lee como documento** | **Escritura huérfana** — se escribe en cada cambio pero nunca se vuelve a leer. |
| `invitaciones_hogar` (la misma colección, consultada SIN filtro) | — | `validarCodigo`(474-476) — el resultado (`snap`) **se asigna y nunca se usa** (el propio código comenta "no podemos buscar por subcampo — usar la alternativa") | **Lectura muerta** dentro de una función viva. |
| `codigos_inv/{codigo}` (documento, uno por código de invitación) | `crearInvitacion`(5804), `registrarInvitado`(537, agregado en el fix del bug de reutilización) | `validarCodigo`(479) | **Único camino de invitación realmente funcional de punta a punta entre dispositivos.** |

**Duplicidades/modelos inconsistentes confirmados:**
1. **Tres nombres de colección para el mismo concepto** ("invitación"): `invitaciones`, `invitaciones_hogar`, `codigos_inv` — solo el tercero funciona de extremo a extremo.
2. **Dos mecanismos de lectura de documento coexistiendo**: el helper `_fsGet()` vs. llamadas directas `fb.getDoc(fb.doc(...))` (líneas 58 y 74) dentro de la misma función (`_cargarDatosFirestore`), sin razón aparente para la inconsistencia.
3. **Escritura duplicada en onboarding**: `guardarOnbSalud` escribe `cuidados/{id}` y `compartido/{userId}` explícitamente (714-715) inmediatamente después de que `DB.saveCuidado`/`DB.saveCompartido` (llamadas más arriba en la misma función) ya disparen la misma escritura vía `_fsSet` internamente — dos escrituras al mismo documento en la misma operación.
4. **`onSnapshot` y `deleteDoc`** siguen expuestos en `window._fb` (`js/firebase-config.js`) con **cero usos** en todo `app.js` — sin sincronización en tiempo real, sin borrado real de documentos (todo "eliminar" es sobrescritura de un arreglo más chico dentro de un doc padre).
5. **`_fsSet` siempre usa `{merge:false}`** — cada escritura reemplaza el documento completo; no hay ninguna transacción ni control de concurrencia sobre `compartido/{adminId}`, que es escrito por potencialmente varios roles/dispositivos a la vez.

---

## 5. `localStorage` — mapa completo

**Hallazgo principal de esta sección:** de todas las claves con prefijo `raiz_` que aparecen como *keys de caché* en el código (`raiz_users`, `raiz_cuidados`, `raiz_compartido_{adminId}`, `raiz_invitaciones`, `raiz_sesion`), **solo `raiz_sesion` se escribe realmente en `localStorage`**. Las demás son claves de un objeto **en memoria** (`_cache`, línea 16), no de `localStorage`, pese a compartir la misma convención de nombres.

| Clave | Ubicación real | Quién escribe | Quién lee | ¿Caché o estado? | ¿Eliminable? |
|---|---|---|---|---|---|
| `raiz_sesion` | **`localStorage` real** (líneas 102,107,111) | `DB.setSesion` | `DB.getSesion` (al arrancar la app, antes de que Firebase responda) | Estado — es la única persistencia real entre recargas de página | No — es el único mecanismo que evita el parpadeo de login al recargar |
| `raiz_qa` | `localStorage` real, pero **se escribe y se borra en la misma línea** (1140) | `qaAutoTest` | nadie (se remueve inmediatamente) | Ninguno — es solo una prueba de capacidad de `localStorage`, no persiste nada | Sí, es un no-op funcional |
| `raiz_users` | **Solo `_cache`** (objeto en memoria, no `localStorage`) | `DB.setUsuarios`/`_set` | `DB.getUsuarios` | Caché en memoria — se pierde en cada recarga de página | No aplica a `localStorage` |
| `raiz_cuidados` | **Solo `_cache`** | `DB.setCuidados`/`DB.saveCuidado` | `DB.getCuidados`/`getCuidado` | Caché en memoria | No aplica |
| `raiz_compartido_{adminId}` | **Solo `_cache`** | `DB.saveCompartido` | `DB.getCompartido` | Caché en memoria | No aplica |
| `raiz_invitaciones` | **Solo `_cache`** | `DB.setInvs` | `DB.getInvs` | Caché en memoria | No aplica |

**Implicancia arquitectónica:** al recargar la página, únicamente `raiz_sesion` sobrevive. Todo el resto de los datos (cuidados, compartido, usuarios, invitaciones) se pierde de `_cache` y depende por completo de que `window._raizOnAuth` (disparado por `onAuthStateChanged` de Firebase) vuelva a poblar `_cache` vía `_cargarDatosFirestore` — si Firebase tarda, falla, o el dispositivo está offline, no existe ningún respaldo local más allá de la sesión. Esto además explica por qué el código eliminado en BT-013 (`resetearDatosDemo`, que hacía `Object.keys(localStorage).filter(k=>k.startsWith('raiz_'))...`) y `qaAutoTest` (aún vigente) asumían que había múltiples claves `raiz_*` en `localStorage` para limpiar — en la práctica esa limpieza solo habría afectado a `raiz_sesion`.

---

## 6. Funciones mayores a ~150 líneas

Recalculado sobre el archivo actual (recuento exacto por profundidad de llaves):

| Función | Línea | Tamaño | Responsabilidad | Complejidad | Dependencias | Prioridad de refactor |
|---|---|---|---|---|---|---|
| `renderHome` | 726 | **227** | Renderiza el Home completo, bifurcando en 4 ramas de rol con lógica y HTML distintos por rama (ver Sección 2) | Alta (ramificación, no acoplamiento a `ST`) | Solo `DB` (cero `ST`) | **Alta** — es la única que supera 150 líneas; su tamaño viene de 4 responsabilidades independientes (una por rol) concatenadas en una sola función |

Ninguna otra función del archivo alcanza 150 líneas. Las siguientes en tamaño quedan por debajo del umbral pedido pero cerca de él, y comparten el mismo patrón (mezclan cálculo de datos derivados + construcción de HTML en el mismo cuerpo): `renderMeds` (130, línea 1969), `renderDiario` (113, línea 3151 — además la función con más acoplamiento a `ST` de todo el archivo, ver 1.6), `renderLista` (105, línea 1326), `verDetalle` (101, línea 1433).

---

## 7. Ranking de los 10 mayores riesgos técnicos (por impacto)

1. **`ST.tab` compartido entre 4 módulos causa que `eliminarPersona()` (Equipo) no refresque la lista tras eliminar una cuidadora/especialista** (Sección 1.5) — bug confirmado por lectura de código, afecta una acción destructiva real, sin ningún error visible que alerte al usuario de que algo falló.
2. **Ausencia de control de concurrencia en Firestore** (`_fsSet` siempre `merge:false`, sin transacciones) sobre `compartido/{adminId}`, escrito por múltiples roles — riesgo de pérdida silenciosa de datos de cuidado real entre dispositivos.
3. **`onSnapshot`/`deleteDoc` importados pero con cero uso real** — sin sincronización en tiempo real entre dispositivos/roles y sin borrado real de documentos pese a que el SDK lo soporta.
4. **Persistencia real limitada a `raiz_sesion`** (Sección 5) — toda la demás data depende enteramente de que Firebase responda a tiempo tras cada recarga; no hay tolerancia a fallos de red más allá de la sesión.
5. **Tres nombres de colección de Firestore para "invitación"**, dos de ellos con lecturas/escrituras muertas (`invitaciones` nunca se escribe; `invitaciones_hogar` se escribe pero nunca se lee como documento) — deuda de modelo de datos con superficie de confusión alta para cambios futuros.
6. **`ST.porciones` puede filtrar datos de un cuidado hacia otro** (Sección 1.6) en cuentas admin con más de un familiar a cargo, mientras la bitácora del día no tenga todos los campos aún registrados.
7. **Propiedades de `ST` usadas sin declarar en el literal** (8 de 30, Sección 1.2) — ninguna documentación central de la forma real del objeto; cualquier desarrollador que lea solo la declaración de `ST` tiene una imagen incompleta y desactualizada del estado real de la aplicación.
8. **`renderHome` concentra 4 responsabilidades de rol en 227 líneas** — el punto de entrada visual más usado de la app es también el más difícil de modificar con seguridad para un solo rol sin revisar las otras 3 ramas.
9. **Convención de nombres `raiz_*` engañosa** — el propio código (funciones ya eliminadas como `resetearDatosDemo`, y `qaAutoTest` que sigue viva) asumió que limpiar `localStorage` con ese prefijo limpiaba "todos los datos", cuando en realidad solo limpia la sesión — riesgo de que un futuro "borrar mis datos" de cara al usuario no borre lo que el usuario espera que borre.
10. **4 variables globales `_catXActual` duplicando el mismo patrón** (Compra/Insumo/Proveedor/Gasto) y `window._resumenRendicion` como slot único implícito — no son bugs activos hoy, pero son la superficie más amplia de "estado paralelo a `ST` sin ninguna razón estructural", aumentando el costo de cualquier auditoría o refactor futuro de estado global.

---

**Confirmación:** no se modificó, refactorizó ni corrigió ningún archivo durante esta auditoría. Todos los hallazgos están basados en lectura directa del código y búsquedas exhaustivas (`grep`/análisis de profundidad de llaves), sin ejecución del código ni pruebas en navegador.
