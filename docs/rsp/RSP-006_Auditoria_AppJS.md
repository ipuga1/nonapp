# RSP-006 — Auditoría Técnica de `js/app.js`
### Proyecto RAÍZ — Documento de referencia arquitectónica

> Este documento es una **auditoría**, no contiene refactorizaciones, correcciones de bugs ni propuestas de solución. Todo lo aquí descrito está basado en evidencia verificada directamente en el código fuente (`js/app.js`, 6277 líneas, y su punto de entrada `index.html` donde fue necesario confirmar puntos de invocación). Las líneas citadas corresponden al archivo `js/app.js` en su estado posterior a RSP-002/RSP-004/RSP-005, salvo que se indique lo contrario.

---

## SECCIÓN 1 — RESUMEN EJECUTIVO

**Tamaño del archivo:** 6277 líneas, ~272 KB (272.334 bytes).

**Cantidad de funciones:** 274 unidades funcionales en total:
- 244 funciones de nivel superior (`function nombre(){...}` / `async function nombre(){...}`).
- 28 métodos del objeto `DB` (capa de datos, líneas 95-232).
- 2 funciones asignadas directamente a `window` (`window._raizOnAuth`, línea 1243; `window.navTo`, línea 2878, que envuelve/sobrescribe la función `navTo` original).

**Complejidad general:** Alta en superficie (274 funciones, 10 módulos funcionales numerados M1-M10 más un módulo de Invitaciones/Accesos), pero **baja en profundidad por función**: solo 5 funciones superan las 100 líneas y ninguna supera las 300 (ver Sección 4). El patrón dominante es el mismo repetido ~10 veces: "hub con tabs → render por tab → abrir sheet → guardar → eliminar", todo sobre un único objeto de estado mutable (`ST`) y una única capa de acceso a datos (`DB`).

**Estado técnico:** El archivo es el resultado de concatenar 10 módulos que originalmente parecen haber sido desarrollados como bloques independientes ("BLOQUE 1", "Módulo 3 · Bitácora — JavaScript completo", etc., ver comentarios de cabecera) y luego fusionados en un solo archivo plano sin deduplicar. Esto se evidencia en:
- Bloques de comentarios de sección vacíos y repetidos al final de cada módulo (`/* SHEETS / CONFIRM */`, `/* QA AUTOMÁTICO */`, `/* INICIALIZACIÓN */`).
- El mismo handler `$('cb-ok').onclick=...` reasignado **9 veces de forma idéntica** (líneas 1219, 1966, 2885, 3608, 4085, 4503, 4867, 5339, 5806).
- Un helper local `deskBtn` redefinido **3 veces** con código idéntico (líneas 3695, 4574, 4937).
- Al menos 8 grupos de funciones CRUD (get→render→abrir sheet→guardar→eliminar) casi idénticas entre sí, cambiando solo el nombre del arreglo y los campos (Alimentación, Equipo de Cuidado, Hogar/Insumos-Proveedores, Gastos).

**Principales riesgos observados** (ver detalle y clasificación completa en Sección 13):
1. La función `procesarRecetaOCR` (OCR de receta médica vía IA) llama directamente a `https://api.anthropic.com/v1/messages` desde el navegador **sin ninguna API key ni header de autenticación** — la llamada no puede funcionar tal como está escrita.
2. `onSnapshot` y `deleteDoc` se importan y exponen en `window._fb` (`js/firebase-config.js`) pero **jamás se invocan** en `app.js`: no hay sincronización en tiempo real entre dispositivos, y ninguna operación de "eliminar" borra realmente un documento de Firestore (todo se modela como sobrescritura de arreglos dentro de documentos compartidos).
3. Se identificaron **11 funciones definidas que no tienen ningún punto de invocación** ni en `app.js` ni en `index.html` (código muerto confirmado, ver Sección 12), incluyendo `initDemo` (todo el sembrado de datos/usuarios demo con contraseñas hardcodeadas nunca se ejecuta) y `abrirLightbox` (existe el cierre del lightbox pero no la apertura).
4. El botón físico del FAB de Gastos en `index.html` (línea 684) llama directamente a `abrirSheetGasto()`, **sin pasar por** `fabActionGastos()` (que sí valida el rol del usuario) — a diferencia de los FAB de Equipo/Hogar/Alimentación, que sí invocan su wrapper `fabActionX()`.
5. Existe una variable `_pending` (línea 17) declarada para "escrituras pendientes" que nunca se usa en ningún punto del archivo.
6. Toda la persistencia depende de un único objeto de estado mutable global (`ST`, 24 propiedades) y una única capa `DB` (28 métodos) sin ningún mecanismo de bloqueo/consistencia entre pestañas o dispositivos.

---

## SECCIÓN 2 — INVENTARIO COMPLETO DE FUNCIONES

Organizado por módulo, en el orden en que aparece cada bloque en el archivo. Columnas: **Complejidad** (Baja <15 líneas y lógica lineal · Media 15-50 líneas o ramificación moderada · Alta >50 líneas o ramificación/dependencias complejas), **Usa Firebase** (llama directa o indirectamente — vía `_fsSet`/`_fsGet`/`window._fb` — a Firebase; nota: la mayoría de las funciones de UI acceden a datos exclusivamente a través de `DB.*`, que internamente sí toca Firebase, pero se marca "No" en la función de UI si esta no referencia Firebase directamente), **Manipula DOM** (sí si toca `document.`, `innerHTML`, `classList`, `$(`, `.value`, etc.).

### 2.1 Capa de Datos (líneas 1-244)

| Nombre | Línea | Líneas | Responsabilidad | Complejidad | Firebase | DOM | Módulo |
|---|---|---|---|---|---|---|---|
| `_fsSet` | 20-29 | 10 | Escribe un documento en Firestore de forma no bloqueante vía `window._fb`/`setDoc`, atrapando errores. | Baja | Sí | No | Capa de Datos |
| `_fsGet` | 32-43 | 12 | Lee un documento de Firestore por path y devuelve sus datos o `null`. | Baja | Sí | No | Capa de Datos |
| `_cargarDatosFirestore` | 46-93 | 48 | Carga en caché en memoria usuarios, cuidados, datos compartidos e invitaciones de un hogar completo tras el login. | Alta | Sí | No | Capa de Datos |
| `DB._get` | 97 | 1 | Lectura síncrona genérica de una clave del caché en memoria. | Baja | No | No | Capa de Datos |
| `DB._set` | 98 | 1 | Escritura síncrona genérica de una clave del caché en memoria. | Baja | No | No | Capa de Datos |
| `DB.getSesion` | 101 | 5 | Devuelve la sesión activa desde caché o `localStorage`. | Baja | No | No | Capa de Datos |
| `DB.setSesion` | 106 | 4 | Guarda la sesión en caché y `localStorage`. | Baja | No | No | Capa de Datos |
| `DB.clearSesion` | 110 | 4 | Elimina la sesión de caché y `localStorage`. | Baja | No | No | Capa de Datos |
| `DB.getUsuarios` | 116 | 1 | Devuelve usuarios cacheados. | Baja | No | No | Capa de Datos |
| `DB.setUsuarios` | 117 | 4 | Actualiza caché de usuarios y persiste cada uno vía `_fsSet`. | Baja | Sí | No | Capa de Datos |
| `DB.getInvs` | 123 | 1 | Devuelve invitaciones cacheadas. | Baja | No | No | Capa de Datos |
| `DB.setInvs` | 124 | 5 | Actualiza caché de invitaciones y las persiste bajo el `adminId`. | Baja | Sí | No | Capa de Datos |
| `DB.getCuidados` | 131 | 1 | Devuelve cuidados cacheados. | Baja | No | No | Capa de Datos |
| `DB.setCuidados` | 132 | 4 | Actualiza caché de cuidados y persiste cada uno. | Baja | Sí | No | Capa de Datos |
| `DB.getCuidado` | 136 | 4 | Devuelve el cuidado activo de la sesión actual. | Baja | No | No | Capa de Datos |
| `DB.getCuidadoById` | 140 | 1 | Busca un cuidado por id. | Baja | No | No | Capa de Datos |
| `DB.saveCuidado` | 141 | 7 | Inserta/actualiza un cuidado en caché y Firestore. | Baja | Sí | No | Capa de Datos |
| `DB.getCuidadosAdmin` | 148 | 5 | Devuelve todos los cuidados del admin de sesión. | Baja | No | No | Capa de Datos |
| `DB._adminId` | 155 | 5 | Resuelve el `adminId` del hogar según el rol de sesión. | Baja | No | No | Capa de Datos |
| `DB._keyC` | 160 | 1 | Construye la clave de caché `raiz_compartido_<adminId>`. | Baja | No | No | Capa de Datos |
| `DB.getCompartido` | 161 | 4 | Devuelve datos compartidos del hogar o un objeto vacío. | Baja | No | No | Capa de Datos |
| `DB.saveCompartido` | 165 | 6 | Guarda datos compartidos en caché y Firestore. | Baja | Sí | No | Capa de Datos |
| `DB._cVacio` | 171 | 8 | Estructura vacía por defecto de datos compartidos. | Baja | No | No | Capa de Datos |
| `DB.getAlim` | 181 | 8 | Obtiene y normaliza (defaults) la sección alimentación. | Baja | No | No | Capa de Datos |
| `DB.saveAlim` | 189 | 5 | Reemplaza sección alimentación, delega a `saveCompartido`. | Baja | No | No | Capa de Datos |
| `DB.getHogar` | 196 | 7 | Obtiene y normaliza sección "hogar". | Baja | No | No | Capa de Datos |
| `DB.saveHogar` | 203 | 5 | Reemplaza sección "hogar", delega a `saveCompartido`. | Baja | No | No | Capa de Datos |
| `DB.getEquipo` | 210 | 5 | Obtiene arreglo "equipo" normalizado. | Baja | No | No | Capa de Datos |
| `DB.saveEquipo` | 215 | 5 | Reemplaza equipo de cuidado, delega a `saveCompartido`. | Baja | No | No | Capa de Datos |
| `DB.getEventos` | 222 | 5 | Obtiene arreglo "eventos" normalizado. | Baja | No | No | Capa de Datos |
| `DB.saveEventos` | 227 | 5 | Reemplaza eventos de agenda, delega a `saveCompartido`. | Baja | No | No | Capa de Datos |

### 2.2 Helpers globales (líneas 245-265)

| Nombre | Línea | Líneas | Responsabilidad | Complejidad | Firebase | DOM | Módulo |
|---|---|---|---|---|---|---|---|
| `hashPass` | 246-251 | 6 | Calcula un hash djb2 (no criptográfico) de una contraseña para comparación local. | Baja | No | No | Helpers |
| `$` (arrow) | 254 | 1 | Alias de `document.getElementById`. | Baja | No | Sí | Helpers |
| `toast` | 255-258 | 4 | Muestra una notificación temporal, programa su ocultamiento. | Baja | No | Sí | Helpers |
| `showErr` | 259 | 1 | Muestra un mensaje de error asociado a un elemento. | Baja | No | Sí | Helpers |
| `hideErr` | 260 | 1 | Oculta el mensaje de error de un elemento. | Baja | No | Sí | Helpers |
| `setLoading` | 261 | 1 | Alterna spinner/opacidad de botón durante una carga. | Baja | No | Sí | Helpers |
| `initials` | 262 | 1 | Genera iniciales (máx. 2 letras) de un nombre. | Baja | No | No | Helpers |
| `hoy` | 263 | 1 | Fecha actual en formato `YYYY-MM-DD`. | Baja | No | No | Helpers |
| `fechaHoy` | 264 | 1 | Fecha actual formateada en `es-CL`. | Baja | No | No | Helpers |
| `fmt` | 265 | 1 | Formatea un número como monto CLP. | Baja | No | No | Helpers |

### 2.3 Navegación central (líneas 267-332)

| Nombre | Línea | Líneas | Responsabilidad | Complejidad | Firebase | DOM | Módulo |
|---|---|---|---|---|---|---|---|
| `navTo` | 274-325 | 52 | Controla la navegación central: activa pantalla, gestiona sidebar, dispara hooks `setTimeout` de inicialización por pantalla. | Alta | No | Sí | Navegación |
| `irAlHome` | 327-331 | 5 | Redirige al Home según el rol de sesión (o splash si no hay sesión). | Baja | No | No | Navegación |

### 2.4 Demo Data (líneas 333-415)

| Nombre | Línea | Líneas | Responsabilidad | Complejidad | Firebase | DOM | Módulo |
|---|---|---|---|---|---|---|---|
| `initDemo` | 334-414 | 81 | Siembra datos demo (4 usuarios, cuidado, hogar compartido, invitación) si no existen usuarios. **Sin ningún punto de invocación en todo el proyecto — código muerto, ver Sección 12.** | Alta | No | No | Demo Data |

### 2.5 Auth — Módulo 1 (líneas 416-671)

| Nombre | Línea | Líneas | Responsabilidad | Complejidad | Firebase | DOM | Módulo |
|---|---|---|---|---|---|---|---|
| `selTipoRegistro` | 420-427 | 8 | Marca visualmente el tipo de registro elegido (admin/invitado). | Baja | No | Sí | Auth (M1) |
| `continuarRegistro` | 428-431 | 4 | Navega a la pantalla de registro según el tipo seleccionado. | Baja | No | No | Auth (M1) |
| `hacerLogin` | 434-474 | 41 | Valida credenciales y hace login con Firebase Auth, carga datos del hogar, establece sesión. | Media | Sí | Sí | Auth (M1) |
| `validarPass` | 478 | 1 | Valida en vivo longitud mínima de contraseña. | Baja | No | Sí | Auth (M1) |
| `validarPass2` | 479 | 1 | Valida en vivo coincidencia de confirmación de contraseña. | Baja | No | Sí | Auth (M1) |
| `registrarAdmin` | 480-534 | 55 | Crea cuenta admin en Firebase Auth + cuidado + datos compartidos vacíos, inicia sesión. | Alta | Sí | Sí | Auth (M1) |
| `actualizarCodigo` | 538-545 | 8 | Formatea el código de invitación dígito a dígito, valida automáticamente al completar 6. | Baja | No | Sí | Auth (M1) |
| `validarCodigo` | 546-593 | 48 | Busca invitación pendiente por código (caché y Firestore) y navega al registro de invitado. | Alta | Sí | Sí | Auth (M1) |
| `registrarInvitado` | 596-639 | 44 | Crea cuenta de invitado en Firebase Auth, marca invitación usada, carga datos del hogar. | Media | Sí | Sí | Auth (M1) |
| `mostrarBienvenida` | 642-656 | 15 | Renderiza pantalla de bienvenida post-login con datos de usuario/rol/cuidado. | Media | No | Sí | Auth (M1) |
| `cerrarSesion` | 658-670 | 13 | Cierra sesión en Firebase Auth, limpia caché/sesión local, navega a splash. | Baja | Sí | Sí | Auth (M1) |

### 2.6 Onboarding — Módulo 2 (líneas 672-810)

| Nombre | Línea | Líneas | Responsabilidad | Complejidad | Firebase | DOM | Módulo |
|---|---|---|---|---|---|---|---|
| `onbRenderCuidadoras` | 676-688 | 13 | Renderiza lista editable de cuidadoras del onboarding. | Baja | No | Sí | Onboarding (M2) |
| `onbAgregarCuidadora` | 690-698 | 9 | Agrega fila vacía a la lista de cuidadoras. | Baja | No | Sí | Onboarding (M2) |
| `onbEliminarCuidadora` | 700-704 | 5 | Elimina una cuidadora de la lista (si queda ≥1). | Baja | No | No | Onboarding (M2) |
| `calcularEdad` | 709-717 | 9 | Calcula edad en años desde fecha de nacimiento, valida rango 0-129. | Baja | No | No | Onboarding (M2) |
| `formatearRut` | 720-731 | 12 | Formatea RUT chileno con puntos y guion en vivo. | Baja | No | Sí | Onboarding (M2) |
| `eliminarCuidado` | 734-749 | 16 | Elimina un cuidado del admin (no el activo) previa confirmación. | Media | No | No | Onboarding (M2) |
| `guardarOnbAM` | 752-770 | 19 | Guarda antecedentes del familiar, avanza al paso de salud. | Media | No | Sí | Onboarding (M2) |
| `guardarOnbSalud` | 771-809 | 39 | Guarda condiciones de salud y cuidadoras al equipo compartido, persiste en Firestore, navega a activación. | Media | Sí | Sí | Onboarding (M2) |

### 2.7 Home — Módulo 2 (líneas 811-1040)

| Nombre | Línea | Líneas | Responsabilidad | Complejidad | Firebase | DOM | Módulo |
|---|---|---|---|---|---|---|---|
| `renderHome` | 812-1038 | 227 | Renderiza el Home según rol (admin/familiar/observador/cuidadora): tarjetas de estado, semáforos de vitales, acciones rápidas. **Función más grande del archivo.** | Alta | No | Sí | Home (M2) |

### 2.8 Shell: Sidebar / Multi-cuidado / Perfil / Sheets-Confirm-QA (líneas 1041-1291)

| Nombre | Línea | Líneas | Responsabilidad | Complejidad | Firebase | DOM | Módulo |
|---|---|---|---|---|---|---|---|
| `renderSidebar` | 1041-1082 | 42 | Construye el menú lateral según rol, marca el ítem activo. | Media | No | Sí | Sidebar |
| `crearNuevoCuidado` | 1086-1108 | 23 | Crea un cuidado vacío nuevo asociado al admin, navega a onboarding. | Media | No | Sí | Multi-cuidado |
| `selCuidadoYNav` | 1111-1114 | 4 | Cambia de cuidado activo solo si difiere del actual, delega en `selCuidado`. Usado desde `renderHome` (onclick línea 905). | Baja | No | No | Multi-cuidado |
| `abrirSwitcher` | 1116-1126 | 11 | Renderiza lista de cuidados del admin en el sheet switcher y lo abre. | Baja | No | Sí | Multi-cuidado |
| `selCuidado` | 1127-1137 | 11 | Cambia el `cuidadoId` activo, cierra sheet, navega al home. | Baja | No | No | Multi-cuidado |
| `renderPerfil` | 1140-1190 | 51 | Renderiza pantalla de perfil (hero, datos AM, presupuesto, lista de cuidados). | Alta | No | Sí | Perfil |
| `guardarPerfil` | 1191-1213 | 23 | Valida y persiste cambios del formulario de perfil. | Media | No | Sí | Perfil |
| `cerrarSheet` | 1216 | 1 | Cierra un sheet/overlay quitando clase `open`. | Baja | No | Sí | Sheets/Confirm |
| `confirmar` | 1218 | 1 | Configura y abre el diálogo de confirmación genérico. | Baja | No | Sí | Sheets/Confirm |
| `cerrarConfirm` | 1220 | 1 | Cierra el diálogo de confirmación, limpia callback pendiente. | Baja | No | Sí | Sheets/Confirm |
| `qaAutoTest` | 1224-1239 | 16 | Self-test de QA (localStorage, pantallas clave, ids duplicados). **Sin ningún punto de invocación — ver Sección 12.** | Media | No | Sí | QA |

### 2.9 Helpers compartidos (líneas 1334-1401; `ST` documentado en Sección 6)

| Nombre | Línea | Líneas | Responsabilidad | Complejidad | Firebase | DOM | Módulo |
|---|---|---|---|---|---|---|---|
| `horaActual` | 1337-1339 | 3 | Hora actual formateada `es-CL`. | Baja | No | No | Helpers compartidos |
| `fechaCorta` | 1340-1344 | 5 | Formatea fecha ISO a formato corto "día mes". | Baja | No | No | Helpers compartidos |
| `esHoy` | 1345 | 1 | Compara una fecha con `hoy()`. | Baja | No | No | Helpers compartidos |
| `esEstaSemana` | 1346-1349 | 4 | Determina si una fecha cae en la semana actual. | Baja | No | No | Helpers compartidos |
| `esEsteMes` | 1350 | 1 | Determina si una fecha pertenece al mes actual. | Baja | No | No | Helpers compartidos |
| `initSelectorCuidado` | 1353-1372 | 20 | Renderiza chips selectores de cuidado en bitácora (si admin tiene >1). | Media | No | Sí | Bitácora (M3) |
| `selCuidadoBita` | 1373-1376 | 4 | Cambia `ST.bitaCuidadoId` y re-renderiza el selector. | Baja | No | No | Bitácora (M3) |
| `fechaLarga` | 1395-1398 | 4 | Formatea fecha a formato largo ("lunes, 15 de julio"). | Baja | No | No | Bitácora (M3) |

### 2.10 Bitácora — Módulo 3 (líneas 1402-1973)

| Nombre | Línea | Líneas | Responsabilidad | Complejidad | Firebase | DOM | Módulo |
|---|---|---|---|---|---|---|---|
| `setFiltro` | 1405-1410 | 6 | Cambia filtro activo de lista de bitácoras, re-renderiza. | Baja | No | Sí | Bitácora (M3) |
| `renderLista` | 1412-1516 | 105 | Renderiza historial de bitácoras filtrado/agrupado por fecha, con permisos por rol. | Alta | No | Sí | Bitácora (M3) |
| `verDetalle` | 1519-1619 | 101 | Construye y muestra el detalle de un registro de bitácora. | Alta | No | Sí | Bitácora (M3) |
| `eliminarBitacora` | 1622-1634 | 13 | Confirma y elimina un registro de bitácora. | Baja | No | No | Bitácora (M3) |
| `initFormulario` | 1637-1690 | 54 | Inicializa/resetea el formulario de nuevo registro de bitácora. **Sin ningún punto de invocación — ver Sección 12 (posible bug funcional).** | Alta | No | Sí | Bitácora (M3) |
| `selQuien` | 1693-1697 | 5 | Actualiza `ST.form.quien`, marca botón seleccionado. | Baja | No | Sí | Bitácora (M3) |
| `selPorcion` | 1699-1704 | 6 | Actualiza porción de una comida en `ST.form`. | Baja | No | Sí | Bitácora (M3) |
| `togChk` | 1706-1711 | 6 | Alterna booleano de `ST.form` (baño/hidratación/actividad/visita). | Baja | No | Sí | Bitácora (M3) |
| `selAnimo` | 1713-1717 | 5 | Actualiza `ST.form.animo`, marca botón. | Baja | No | Sí | Bitácora (M3) |
| `validarPresion` | 1720-1729 | 10 | Valida formato de presión arterial. | Baja | No | Sí | Bitácora (M3) |
| `validarTemp` | 1731-1745 | 15 | Valida rango de temperatura (34-42°C), advertencia contextual. | Media | No | Sí | Bitácora (M3) |
| `validarSato` | 1747-1760 | 14 | Valida rango de saturación O₂ (70-100%). | Baja | No | Sí | Bitácora (M3) |
| `guardarBitacora` | 1763-1819 | 57 | Recolecta datos del formulario, genera resumen IA, persiste vía `DB.saveCuidado`. | Alta | No | Sí | Bitácora (M3) |
| `generarResumenIA` | 1822-1889 | 68 | Genera (simulado, sin llamada de red) un texto narrativo del registro combinando signos/alimentación/controles/ánimo. | Alta | No | No | Bitácora (M3) |
| `mostrarResumenIA` | 1892-1923 | 32 | Rellena la vista de resumen IA y navega a ella. | Media | No | Sí | Bitácora (M3) |
| `textoWA` | 1926-1928 | 3 | Construye texto para compartir resumen por WhatsApp. | Baja | No | No | Bitácora (M3) |
| `enviarWhatsApp` | 1930-1934 | 5 | Abre `wa.me` con el resumen de `ST.bitacoraActual`. | Baja | No | No | Bitácora (M3) |
| `copiarResumen` | 1936-1939 | 4 | Copia al portapapeles el texto WhatsApp del resumen actual. | Baja | No | No | Bitácora (M3) |
| `enviarWhatsAppResumen` | 1941-1945 | 5 | Busca bitácora por id, abre WhatsApp con su resumen. | Baja | No | No | Bitácora (M3) |
| `copiarResumenDetalle` | 1947-1951 | 5 | Busca bitácora por id, copia su resumen al portapapeles. | Baja | No | No | Bitácora (M3) |
| `copiarTexto` | 1953-1962 | 10 | Copia texto arbitrario al portapapeles (`navigator.clipboard` o fallback `execCommand`). | Baja | No | Sí | Bitácora (M3) |

### 2.11 Salud — Módulo 4 (líneas 1974-2892: Medicamentos, OCR, Ficha, Documentos, Historial)

| Nombre | Línea | Líneas | Responsabilidad | Complejidad | Firebase | DOM | Módulo |
|---|---|---|---|---|---|---|---|
| `setTab` | 1997-2002 | 6 | Cambia tab activo del hub de salud, dispara `renderTab`. | Baja | No | Sí | Salud (M4) |
| `fabAction` | 2004-2011 | 8 | Acción del FAB según tab activo y rol. | Baja | No | No | Salud (M4) |
| `renderTab` | 2013-2052 | 40 | Orquesta render del hub de salud según tab y permisos. | Media | No | Sí | Salud (M4) |
| `renderMeds` | 2055-2184 | 130 | Renderiza lista de medicamentos por turno, alertas de stock, progreso de adherencia diaria. | Alta | No | Sí | Salud (M4) — Medicamentos |
| `confMed` | 2187-2227 | 41 | Marca/desmarca confirmación diaria de un medicamento, ajusta stock. | Media | No | Sí | Salud (M4) — Medicamentos |
| `eliminarMed` | 2230-2238 | 9 | Elimina un medicamento tras confirmación. | Baja | No | No | Salud (M4) — Medicamentos |
| `editarStock` | 2241-2276 | 36 | Abre sheet de gestión de stock, muestra historial de reposiciones. | Media | No | Sí | Salud (M4) — Medicamentos |
| `ajustarStockInsumo` | 2279-2286 | 8 | Ajusta cantidad de un insumo del hogar. | Baja | No | No | Salud (M4) — Medicamentos |
| `ajustarStock` | 2288-2291 | 4 | Incrementa/decrementa input de cantidad en sheet de reposición. | Baja | No | Sí | Salud (M4) — Medicamentos |
| `guardarReposicion` | 2293-2319 | 27 | Registra nueva reposición de stock, actualiza `stockActual`. | Media | No | Sí | Salud (M4) — Medicamentos |
| `guardarStock` | 2321-2324 | 4 | Alias de retrocompatibilidad que redirige a `guardarReposicion`. **Sin ningún punto de invocación — ver Sección 12.** | Baja | No | No | Salud (M4) — Medicamentos |
| `abrirSheetMed` | 2327-2338 | 12 | Abre/resetea el sheet "agregar medicamento". | Baja | No | Sí | Salud (M4) — Medicamentos |
| `actualizarPreviewHorarios` | 2340-2353 | 14 | Calcula preview de horarios de toma según frecuencia. | Baja | No | Sí | Salud (M4) — Medicamentos |
| `editarMed` | 2355-2370 | 16 | Precarga formulario con datos de medicamento existente. | Media | No | Sí | Salud (M4) — Medicamentos |
| `guardarMedManual` | 2372-2425 | 54 | Valida y guarda medicamento manual completo (horarios, stock, reposición inicial). | Alta | No | Sí | Salud (M4) — Medicamentos |
| `procesarRecetaOCR` | 2428-2508 | 81 | Sube archivo, lo convierte a base64, llama `fetch` a `api.anthropic.com/v1/messages` para extraer medicamentos (**sin API key ni header de autenticación — ver Sección 12/13**), con fallback manual si falla. | Alta | No | Sí | Salud (M4) — OCR Receta |
| `mostrarResultadoOCR` | 2510-2536 | 27 | Renderiza medicamentos detectados por OCR con selección por checkbox. | Media | No | Sí | Salud (M4) — OCR Receta |
| `toggleOcrMed` | 2538-2544 | 7 | Alterna selección de un medicamento detectado. | Baja | No | Sí | Salud (M4) — OCR Receta |
| `agregarMedsOCR` | 2546-2560 | 15 | Agrega medicamentos seleccionados del OCR a `cuidado.meds`. | Media | No | No | Salud (M4) — OCR Receta |
| `resetOCR` | 2562-2571 | 10 | Restablece la UI del flujo OCR a su estado inicial. | Baja | No | Sí | Salud (M4) — OCR Receta |
| `renderFicha` | 2574-2661 | 88 | Renderiza ficha clínica completa (datos, equipo médico, condiciones, alergias). | Alta | No | Sí | Salud (M4) — Ficha Clínica |
| `guardarFicha` | 2664-2695 | 32 | Guarda cambios de ficha clínica, actualiza sidebar/home en segundo plano. | Media | No | Sí | Salud (M4) — Ficha Clínica |
| `prellenarFicha` | 2698-2712 | 15 | Precarga formulario de edición de ficha clínica. | Media | No | Sí | Salud (M4) — Ficha Clínica |
| `renderDocs` | 2715-2756 | 42 | Renderiza documentos médicos filtrados por tipo. | Media | No | Sí | Salud (M4) — Documentos |
| `setDocFiltro` | 2758-2765 | 8 | Cambia filtro activo de tipo de documento. | Baja | No | Sí | Salud (M4) — Documentos |
| `abrirSheetDoc` | 2767-2771 | 5 | Abre sheet "agregar documento" con fecha de hoy por defecto. | Baja | No | Sí | Salud (M4) — Documentos |
| `guardarDocumento` | 2773-2791 | 19 | Valida y guarda un documento médico nuevo. | Media | No | Sí | Salud (M4) — Documentos |
| `eliminarDoc` | 2793-2801 | 9 | Elimina un documento tras confirmación. | Baja | No | No | Salud (M4) — Documentos |
| `renderHistorial` | 2804-2868 | 65 | Construye línea de tiempo unificada de bitácoras/documentos/medicamentos. | Alta | No | Sí | Salud (M4) |
| `var_color` | 2870-2873 | 4 | Devuelve color hexadecimal por nombre lógico para pintar eventos del historial. | Baja | No | No | Salud (M4) |

### 2.12 Alimentación — Módulo 5 (líneas 2893-3617)

| Nombre | Línea | Líneas | Responsabilidad | Complejidad | Firebase | DOM | Módulo |
|---|---|---|---|---|---|---|---|
| `diaHoy` | 2917 | 1 | Nombre del día de la semana actual. | Baja | No | No | Alimentación (M5) |
| `setTabAlim` | 2924-2930 | 7 | Cambia tab activo de Alimentación. | Baja | No | Sí | Alimentación (M5) |
| `fabActionAlim` | 2932-2939 | 8 | Determina acción del FAB según rol/tab activo. | Baja | No | No | Alimentación (M5) |
| `renderTabAlim` | 2941-2988 | 48 | Orquesta render del tab activo (plan/restricciones/diario/compras). | Media | No | Sí | Alimentación (M5) |
| `renderPlanSemanal` | 2991-3069 | 79 | Renderiza plan semanal en tarjetas expandibles, alertas de restricciones. | Alta | No | Sí | Alimentación (M5) — Plan Semanal |
| `toggleDia` | 3071-3076 | 6 | Expande/colapsa un día del plan semanal. | Baja | No | Sí | Alimentación (M5) — Plan Semanal |
| `abrirSeleccionarDia` | 3079-3088 | 10 | Abre overlay para elegir día al que agregar comida. | Baja | No | Sí | Alimentación (M5) — Plan Semanal |
| `selDiaYAbrirComida` | 3090-3093 | 4 | Cierra selector de día, abre sheet de agregar comida. | Baja | No | No | Alimentación (M5) — Plan Semanal |
| `abrirAddComida` | 3095-3102 | 8 | Prepara y abre formulario de agregar comida. | Baja | No | Sí | Alimentación (M5) — Plan Semanal |
| `guardarComida` | 3104-3122 | 19 | Guarda comida en `alim.plan` y `alim.diario` del día. | Media | No | Sí | Alimentación (M5) — Plan Semanal |
| `eliminarComida` | 3124-3132 | 9 | Elimina una comida del plan semanal por id. | Baja | No | No | Alimentación (M5) — Plan Semanal |
| `renderRestricciones` | 3135-3205 | 71 | Renderiza restricciones combinando ficha clínica + propias del módulo. | Alta | No | Sí | Alimentación (M5) — Restricciones |
| `abrirSheetRestriccion` | 3207-3212 | 6 | Abre sheet de nueva restricción alimentaria. | Baja | No | Sí | Alimentación (M5) — Restricciones |
| `guardarRestriccion` | 3214-3228 | 15 | Guarda restricción alimentaria nueva. | Media | No | Sí | Alimentación (M5) — Restricciones |
| `eliminarRestriccion` | 3230-3238 | 9 | Elimina restricción alimentaria por id. | Baja | No | No | Alimentación (M5) — Restricciones |
| `renderDiario` | 3241-3353 | 113 | Renderiza registro diario de alimentación (porciones, hidratación). | Alta | No | Sí | Alimentación (M5) — Registro Diario |
| `selPorcionAlim` | 3355-3370 | 16 | Registra porción consumida en `ST.porciones`. | Media | No | Sí | Alimentación (M5) — Registro Diario |
| `togVaso` | 3372-3388 | 17 | Alterna/ajusta contador de vasos de agua. | Media | No | Sí | Alimentación (M5) — Registro Diario |
| `guardarRegistroDiario` | 3390-3420 | 31 | Sincroniza porciones/hidratación con la bitácora del día. | Media | No | No | Alimentación (M5) — Registro Diario |
| `renderCompras` | 3423-3506 | 84 | Renderiza lista de compras con progreso, agrupación por categoría. | Alta | No | Sí | Alimentación (M5) — Lista de Compras |
| `selCatCompra` | 3510-3514 | 5 | Selecciona categoría activa del formulario de compra. | Baja | No | Sí | Alimentación (M5) — Lista de Compras |
| `abrirSheetCompra` | 3516-3522 | 7 | Abre sheet de nueva compra. | Baja | No | Sí | Alimentación (M5) — Lista de Compras |
| `guardarCompra` | 3524-3540 | 17 | Agrega nuevo ítem a la lista de compras. | Media | No | Sí | Alimentación (M5) — Lista de Compras |
| `toggleCompra` | 3542-3549 | 8 | Alterna estado `completada` de un ítem. | Baja | No | No | Alimentación (M5) — Lista de Compras |
| `eliminarCompra` | 3551-3557 | 7 | Elimina un ítem de compra por id (sin confirmación previa, a diferencia de otros `eliminar*` del módulo). | Baja | No | No | Alimentación (M5) — Lista de Compras |
| `limpiarCompletadas` | 3559-3567 | 9 | Elimina de golpe los ítems marcados como completados. | Baja | No | No | Alimentación (M5) — Lista de Compras |
| `generarListaIA` | 3569-3604 | 36 | Agrega un set fijo de productos sugeridos (**simulado, sin llamada de red ni IA real** — comentario explícito en el propio código). | Media | No | No | Alimentación (M5) — Lista de Compras |

### 2.13 Equipo de Cuidado — Módulo 6 (líneas 3618-4091)

| Nombre | Línea | Líneas | Responsabilidad | Complejidad | Firebase | DOM | Módulo |
|---|---|---|---|---|---|---|---|
| `diaHoyIdx` | 3657 | 1 | Índice numérico del día actual (0=lunes…6=domingo). **Sin ningún punto de invocación — ver Sección 12.** | Baja | No | No | Equipo de Cuidado (M6) |
| `paleta` | 3659 | 1 | Devuelve colores de `PALETA` según índice, cíclico. | Baja | No | No | Equipo de Cuidado (M6) |
| `setTabEquip` | 3666-3671 | 6 | Cambia tab activo del hub de Equipo. | Baja | No | Sí | Equipo de Cuidado (M6) |
| `renderTabEquip` | 3679-3718 | 40 | Despacha render de sub-tab (cuidadoras/especialistas/turnos). | Media | No | Sí | Equipo de Cuidado (M6) |
| `renderCuidadoras` | 3721-3798 | 78 | Renderiza tarjetas de cuidadoras con turno semanal, contacto. | Alta | No | Sí | Equipo de Cuidado (M6) |
| `renderEspecialistas` | 3801-3854 | 54 | Renderiza tarjetas de especialistas agrupadas por tipo. | Alta | No | Sí | Equipo de Cuidado (M6) |
| `renderCalendario` | 3857-3944 | 88 | Dibuja grilla de turnos por cuidadora/día de la semana actual. | Alta | No | Sí | Equipo de Cuidado (M6) |
| `renderDiasBtns` | 3947-3955 | 9 | Renderiza botones de día marcando seleccionados. | Baja | No | Sí | Equipo de Cuidado (M6) |
| `toggleDiaEquip` | 3965-3979 | 15 | Alterna un día dentro/fuera del set de selección. | Media | No | Sí | Equipo de Cuidado (M6) |
| `abrirSheetCuidadora` | 3980-3988 | 9 | Abre sheet "agregar cuidadora" con defaults. | Baja | No | Sí | Equipo de Cuidado (M6) |
| `guardarCuidadora` | 3990-4008 | 19 | Agrega nueva cuidadora al arreglo `equipo`. | Media | No | Sí | Equipo de Cuidado (M6) |
| `editarCuidadora` | 4010-4023 | 14 | Carga datos de cuidadora existente para edición. | Baja | No | Sí | Equipo de Cuidado (M6) |
| `actualizarCuidadora` | 4025-4044 | 20 | Persiste cambios de una cuidadora existente. | Media | No | Sí | Equipo de Cuidado (M6) |
| `abrirSheetEspecialista` | 4047-4052 | 6 | Abre sheet "agregar especialista" con defaults. | Baja | No | Sí | Equipo de Cuidado (M6) |
| `guardarEspecialista` | 4054-4071 | 18 | Agrega nuevo especialista al arreglo `equipo`. | Media | No | Sí | Equipo de Cuidado (M6) |
| `eliminarPersona` | 4074-4081 | 8 | Elimina cuidadora/especialista del equipo tras confirmación. | Baja | No | No | Equipo de Cuidado (M6) |

### 2.14 Agenda — Módulo 7 (líneas 4092-4509)

| Nombre | Línea | Líneas | Responsabilidad | Complejidad | Firebase | DOM | Módulo |
|---|---|---|---|---|---|---|---|
| `padZ` | 4116 | 1 | Rellena número con cero a la izquierda hasta 2 dígitos. | Baja | No | No | Agenda (M7) |
| `ymd` | 4117 | 1 | Formatea año/mes/día en string `YYYY-MM-DD`. | Baja | No | No | Agenda (M7) |
| `fechaLegible` | 4124-4128 | 5 | Convierte `YYYY-MM-DD` en fecha legible en español. **Sin ningún punto de invocación — ver Sección 12.** | Baja | No | No | Agenda (M7) |
| `diasHasta` | 4129-4133 | 5 | Calcula días entre hoy y una fecha dada. | Baja | No | No | Agenda (M7) |
| `renderAgenda` | 4141-4168 | 28 | Configura subtítulo/FAB, dispara render de calendario/día/alertas. | Media | No | Sí | Agenda (M7) |
| `renderCalendarioAgenda` | 4171-4229 | 59 | Construye grilla del calendario mensual con puntos de color por evento. | Alta | No | Sí | Agenda (M7) |
| `cambiarMes` | 4231-4237 | 7 | Avanza/retrocede mes y año, re-renderiza. | Baja | No | No | Agenda (M7) |
| `selDia` | 4239-4243 | 5 | Fija día seleccionado, refresca calendario y detalle. | Baja | No | No | Agenda (M7) |
| `renderDiaSeleccionado` | 4246-4285 | 40 | Renderiza eventos del día elegido o sugiere próximos eventos. | Media | No | Sí | Agenda (M7) |
| `renderEventoCard` | 4287-4320 | 34 | Genera HTML de tarjeta de evento con cuenta regresiva. | Media | No | No | Agenda (M7) |
| `renderAlertas` | 4323-4346 | 24 | Filtra eventos próximos según umbral de alerta, renderiza banners. | Media | No | Sí | Agenda (M7) |
| `initSelectorCuidadoEvento` | 4350-4360 | 11 | Muestra selector de destinatario del evento. | Baja | No | Sí | Agenda (M7) |
| `renderChipsCuidadoEvento` | 4362-4374 | 13 | Renderiza chips para elegir Cuidado destinatario. | Baja | No | Sí | Agenda (M7) |
| `selCuidadoEvento` | 4376-4381 | 6 | Actualiza Cuidado seleccionado para el evento en edición. | Baja | No | Sí | Agenda (M7) |
| `abrirSheetEvento` | 4383-4400 | 18 | Abre sheet de nuevo evento con fecha prellenada. | Media | No | Sí | Agenda (M7) |
| `editarEvento` | 4402-4419 | 18 | Carga datos de evento existente para edición. | Media | No | Sí | Agenda (M7) |
| `selTipo` | 4421-4426 | 6 | Fija tipo de evento elegido, actualiza estilos. | Baja | No | Sí | Agenda (M7) |
| `actualizarEstilosTipo` | 4428-4440 | 13 | Aplica color/fondo del tipo de evento al botón activo. | Baja | No | Sí | Agenda (M7) |
| `guardarEvento` | 4442-4486 | 45 | Crea/actualiza evento, refresca calendario/día/alertas. | Media | No | Sí | Agenda (M7) |
| `eliminarEventoActual` | 4488-4499 | 12 | Elimina el evento en edición tras confirmación. | Baja | No | No | Agenda (M7) |

### 2.15 Hogar e Insumos — Módulo 8 (líneas 4510-4873)

| Nombre | Línea | Líneas | Responsabilidad | Complejidad | Firebase | DOM | Módulo |
|---|---|---|---|---|---|---|---|
| `setTabHogar` | 4549-4554 | 6 | Fija sub-tab activa de Hogar, renderiza contenido. | Baja | No | Sí | Hogar e Insumos (M8) |
| `renderTabHogar` | 4562-4587 | 26 | Despacha render de Insumos/Proveedores según tab. | Media | No | Sí | Hogar e Insumos (M8) |
| `renderInsumos` | 4590-4649 | 60 | Renderiza insumos con alerta de stock, filtro por categoría. | Alta | No | Sí | Hogar e Insumos (M8) |
| `setFiltroInsumo` | 4651-4657 | 7 | Cambia filtro de categoría de insumos. | Baja | No | Sí | Hogar e Insumos (M8) |
| `selCatInsumo` | 4670-4674 | 5 | Selecciona categoría en sheet de insumo. | Baja | No | Sí | Hogar e Insumos (M8) |
| `abrirSheetInsumo` | 4676-4686 | 11 | Abre sheet "agregar insumo" con defaults. | Baja | No | Sí | Hogar e Insumos (M8) |
| `editarInsumo` | 4688-4702 | 15 | Precarga datos de insumo existente para edición. | Media | No | Sí | Hogar e Insumos (M8) |
| `guardarInsumo` | 4704-4729 | 26 | Crea/actualiza insumo (duplica campos `stock`/`cantidad`, `minimo`/`stockMin` — ver Sección 11). | Media | No | Sí | Hogar e Insumos (M8) |
| `eliminarInsumoActual` | 4731-4741 | 11 | Elimina el insumo en edición tras confirmación. | Baja | No | No | Hogar e Insumos (M8) |
| `renderProveedores` | 4744-4791 | 48 | Renderiza proveedores agrupados por categoría, botón "Llamar". | Media | No | Sí | Hogar e Insumos (M8) |
| `selCatProv` | 4795-4799 | 5 | Selecciona categoría en sheet de proveedor. | Baja | No | Sí | Hogar e Insumos (M8) |
| `abrirSheetProveedor` | 4801-4810 | 10 | Abre sheet "agregar proveedor" con defaults. | Baja | No | Sí | Hogar e Insumos (M8) |
| `editarProveedor` | 4812-4826 | 15 | Precarga datos de proveedor existente para edición. | Media | No | Sí | Hogar e Insumos (M8) |
| `guardarProveedor` | 4828-4851 | 24 | Crea/actualiza proveedor. | Media | No | Sí | Hogar e Insumos (M8) |
| `eliminarProvActual` | 4853-4863 | 11 | Elimina el proveedor en edición tras confirmación. | Baja | No | No | Hogar e Insumos (M8) |

### 2.16 Gastos y Finanzas — Módulo 9 (líneas 4874-5345)

| Nombre | Línea | Líneas | Responsabilidad | Complejidad | Firebase | DOM | Módulo |
|---|---|---|---|---|---|---|---|
| `mesLabel` | 4896-4900 | 5 | Convierte "YYYY-MM" en etiqueta legible. | Baja | No | No | Gastos (M9) |
| `mesesDisponibles` | 4903-4908 | 6 | Calcula meses distintos presentes en el arreglo de gastos. | Baja | No | No | Gastos (M9) |
| `setTabGastos` | 4915-4920 | 6 | Cambia tab activo de Gastos. | Baja | No | Sí | Gastos (M9) |
| `renderTabGastos` | 4922-4957 | 36 | Orquesta sub-vista (registro/presupuesto/rendición) según rol. | Media | No | Sí | Gastos (M9) |
| `renderRegistro` | 4960-5048 | 89 | Renderiza barra de presupuesto, desglose por categoría, lista de gastos. | Alta | No | Sí | Gastos (M9) |
| `selMes` | 5050-5053 | 4 | Fija mes visualizado, re-renderiza registro. | Baja | No | No | Gastos (M9) |
| `renderPresupuesto` | 5056-5114 | 59 | Renderiza gastado vs. presupuesto y desglose editable por categoría. | Alta | No | Sí | Gastos (M9) |
| `renderRendicion` | 5117-5200 | 84 | Construye resumen de rendición de cuentas, tarjetas de aprobación. | Alta | No | Sí | Gastos (M9) |
| `selCat` | 5204-5214 | 11 | Fija categoría de gasto seleccionada, actualiza estilo. | Baja | No | Sí | Gastos (M9) |
| `abrirSheetGasto` | 5216-5228 | 13 | Abre sheet "registrar gasto" con defaults. | Baja | No | Sí | Gastos (M9) |
| `editarGasto` | 5230-5246 | 17 | Precarga datos de gasto existente para edición. | Media | No | Sí | Gastos (M9) |
| `guardarGasto` | 5248-5274 | 27 | Crea/actualiza gasto (incluida boleta fotográfica). | Media | No | Sí | Gastos (M9) |
| `eliminarGasto` | 5276-5282 | 7 | Elimina un gasto por id tras confirmación. | Baja | No | No | Gastos (M9) |
| `eliminarGastoActual` | 5284-5288 | 5 | Cierra sheet y delega en `eliminarGasto`. | Baja | No | No | Gastos (M9) |
| `aprobarGasto` | 5291-5298 | 8 | Marca un gasto como aprobado/rechazado. | Baja | No | No | Gastos (M9) |
| `abrirEditarPresupuesto` | 5301-5305 | 5 | Abre sheet de edición de presupuesto total. | Baja | No | Sí | Gastos (M9) |
| `guardarPresupuesto` | 5306-5315 | 10 | Guarda nuevo presupuesto mensual total. | Baja | No | Sí | Gastos (M9) |
| `guardarPresupuestoCat` | 5316-5321 | 6 | Guarda presupuesto asignado a una categoría específica. | Baja | No | No | Gastos (M9) |
| `enviarRendicionWA` | 5324 | 1 | Abre WhatsApp con el texto de rendición prellenado. | Baja | No | No | Gastos (M9) |
| `copiarRendicion` | 5325-5335 | 11 | Copia texto de rendición al portapapeles (lee `window._resumenRendicion`). | Baja | No | Sí | Gastos (M9) |

### 2.17 Informe Mensual IA — Módulo 10 (líneas 5346-5812)

| Nombre | Línea | Líneas | Responsabilidad | Complejidad | Firebase | DOM | Módulo |
|---|---|---|---|---|---|---|---|
| `mesActual` | 5363 | 1 | Devuelve mes actual como "YYYY-MM". | Baja | No | No | Informe IA (M10) |
| `renderHub` | 5370-5436 | 67 | Renderiza hub de informes: hero con estadísticas, listado previo. | Alta | No | Sí | Informe IA (M10) |
| `iniciarGeneracion` | 5439-5472 | 34 | Simula animación de generación (`setTimeout` con duraciones fijas, sin red), invoca `generarInformeIA`. | Media | No | Sí | Informe IA (M10) |
| `generarInformeIA` | 5475-5551 | 77 | Calcula métricas del mes (adherencia, presión, gastos, ánimo) 100% local y arma el objeto informe. **No llama a ninguna API de IA externa — ver nota en Sección 12.** | Alta | No | No | Informe IA (M10) |
| `generarResumenFamiliar` | 5553-5571 | 19 | Arma texto markdown resumiendo el mes para la familia (plantilla con condicionales fijos). | Media | No | No | Informe IA (M10) |
| `generarResumenClinico` | 5573-5615 | 43 | Arma texto tipo informe clínico (plantilla). | Media | No | No | Informe IA (M10) |
| `generarSugerencias` | 5617-5625 | 9 | Genera recomendaciones basadas en reglas fijas (presión>140, etc.). | Baja | No | No | Informe IA (M10) |
| `_fmt` | 5627 | 1 | Formatea número como moneda CLP. | Baja | No | No | Informe IA (M10) |
| `mostrarInforme` | 5630-5650 | 21 | Pinta header del detalle de informe, activa tab familiar. | Media | No | Sí | Informe IA (M10) |
| `verInforme` | 5652-5656 | 5 | Busca informe por id, lo pasa a `mostrarInforme`. | Baja | No | No | Informe IA (M10) |
| `selVersion` | 5658-5663 | 6 | Cambia versión activa (familiar/clínico). | Baja | No | Sí | Informe IA (M10) |
| `renderContenidoInforme` | 5665-5743 | 79 | Renderiza cuerpo del informe (secciones markdown, métricas, sugerencias). | Alta | No | Sí | Informe IA (M10) |
| `seccionIco` | 5745-5748 | 4 | Devuelve emoji según título de sección. | Baja | No | No | Informe IA (M10) |
| `compartirInformeWA` | 5751-5759 | 9 | Abre WhatsApp con resumen familiar, marca informe enviado. | Baja | No | No | Informe IA (M10) |
| `copiarInforme` | 5761-5775 | 15 | Copia texto del informe activo al portapapeles. | Media | No | Sí | Informe IA (M10) |
| `archivarInforme` | 5777-5786 | 10 | Marca informe como archivado tras confirmación. | Baja | No | No | Informe IA (M10) |
| `marcarInformeEnviado` | 5788-5792 | 5 | Marca informe como enviado por id. | Baja | No | No | Informe IA (M10) |
| `eliminarInforme` | 5794-5802 | 9 | Elimina un informe tras confirmación. | Baja | No | No | Informe IA (M10) |

### 2.18 Invitaciones y Accesos (líneas 5813-6131) — incluye helpers de medicamentos mal ubicados físicamente

| Nombre | Línea | Líneas | Responsabilidad | Complejidad | Firebase | DOM | Módulo |
|---|---|---|---|---|---|---|---|
| `generarCodigo6` | 5822-5824 | 3 | Genera código numérico aleatorio de 6 dígitos. | Baja | No | No | Invitaciones |
| `abrirSheetInvitacion` | 5827-5855 | 29 | Valida rol admin, resetea formulario, abre sheet de invitación. | Media | No | Sí | Invitaciones |
| `crearInvitacion` | 5858-5909 | 52 | Genera código único, guarda invitación local y en Firestore (`_fsSet('codigos_inv/...')`). No revalida rol admin dentro de la función (ver Sección 13). | Alta | Sí | Sí | Invitaciones |
| `copiarCodigoInv` | 5912-5918 | 7 | Copia mensaje de invitación con el código al portapapeles. | Baja | No | No | Invitaciones |
| `compartirCodigoInv` | 5921-5929 | 9 | Abre WhatsApp con mensaje de invitación. | Baja | No | No | Invitaciones |
| `renderInvitaciones` | 5932-6030 | 99 | Renderiza accesos activos e invitaciones pendientes con acciones según rol. | Alta | No | Sí | Invitaciones |
| `revocarAcceso` | 6033-6049 | 17 | Marca usuario como revocado tras confirmación. No revalida rol admin dentro de la función. | Media | No | No | Invitaciones |
| `cancelarInvitacion` | 6052-6065 | 14 | Cambia invitación pendiente a estado "cancelada". | Baja | No | No | Invitaciones |
| `reenviarInvitacion` | 6068-6076 | 9 | Reabre WhatsApp con el mismo código de invitación. | Baja | No | No | Invitaciones |
| `calcularHorarios` | 6083-6100 | 18 | Convierte hora inicio + frecuencia en arreglo de horarios de toma. (Semánticamente pertenece a Medicamentos, no a Invitaciones — desalineación física/lógica de este bloque del archivo). | Media | No | No | Medicamentos (ubicado aquí) |
| `proximaToma` | 6102-6113 | 12 | Determina próxima hora de toma relativa a la hora actual. | Baja | No | No | Medicamentos (ubicado aquí) |
| `tomasPendientesHoy` | 6115-6120 | 6 | Filtra horarios de un medicamento sin confirmación hoy. **Sin ningún punto de invocación — ver Sección 12.** | Baja | No | No | Medicamentos (ubicado aquí) |
| `stockCalculado` | 6122-6130 | 9 | Calcula stock actual de un medicamento (retrocompat. con campo `stock` antiguo). **Sin ningún punto de invocación; además contiene una variable interna `consumidas` que se calcula pero nunca se usa — ver Sección 12.** | Baja | No | No | Medicamentos (ubicado aquí) |

### 2.19 Gastos — Boleta fotográfica / Utilidades finales (líneas 6132-6277)

| Nombre | Línea | Líneas | Responsabilidad | Complejidad | Firebase | DOM | Módulo |
|---|---|---|---|---|---|---|---|
| `previewBoleta` | 6135-6168 | 34 | Redimensiona/comprime imagen de boleta en `<canvas>` (máx. 900px, JPEG 0.75) y muestra preview. | Media | No | Sí | Gastos (M9) — Boleta |
| `limpiarBoleta` | 6170-6182 | 13 | Resetea estado y elementos DOM de la boleta. | Baja | No | Sí | Gastos (M9) — Boleta |
| `cargarBoletaExistente` | 6184-6195 | 12 | Carga boleta ya guardada (dataURL) en la vista previa. | Baja | No | Sí | Gastos (M9) — Boleta |
| `abrirLightbox` | 6199-6206 | 8 | Muestra imagen en pantalla completa (lightbox). **Sin ningún punto de invocación en la UI — el cierre (`cerrarLightbox`) sí está conectado en `index.html`, pero nada llama a `abrirLightbox` — ver Sección 12.** | Baja | No | Sí | Utilidades/Lightbox |
| `cerrarLightbox` | 6208-6214 | 7 | Cierra el lightbox, restaura scroll. Conectado en `index.html` (líneas 1909 y 1912). | Baja | No | Sí | Utilidades/Lightbox |
| `recargarDesdeFB` | 6218-6244 | 27 | Recarga manualmente datos de usuario/cuidado desde Firestore, navega a home u onboarding. | Media | Sí | No | Utilidades/Sincronización |
| `resetearDatosDemo` | 6246-6257 | 12 | Borra todas las claves `raiz_*` de `localStorage` tras confirmación. **Sin ningún punto de invocación en la UI — ver Sección 12.** | Baja | No | No | Utilidades/Sincronización |
| `fabActionEquip` | 6259-6265 | 7 | Abre sheet correspondiente (cuidadora/especialista) con chequeo de rol. Conectado como `onclick` del FAB de Equipo. | Baja | No | No | Utilidades/Sincronización |
| `fabActionHogar` | 6266-6272 | 7 | Abre sheet correspondiente (insumo/proveedor) con chequeo de rol. Conectado como `onclick` del FAB de Hogar. | Baja | No | No | Utilidades/Sincronización |
| `fabActionGastos` | 6273-6277 | 5 | Abre sheet de nuevo gasto si el rol está permitido. **Definida pero el FAB de Gastos en `index.html` (línea 684) llama directamente a `abrirSheetGasto()`, sin pasar por esta función — ver Sección 12/13.** | Baja | No | No | Utilidades/Sincronización |

---

## SECCIÓN 3 — FUNCIONES CRÍTICAS

Estas son las funciones cuya falla detendría o corrompería el funcionamiento central de la aplicación, por ser puntos únicos de paso (sin redundancia) para flujos que atraviesan todos los módulos:

- **`navTo` (274-325):** único enrutador de pantallas de toda la SPA. Todo cambio de vista pasa por aquí, incluyendo los hooks `setTimeout` que inicializan cada módulo al entrar a su pantalla. Un fallo aquí rompe la navegación completa de la app.
- **`DB` (objeto, 95-232), en particular `getSesion`/`setSesion`/`getCompartido`/`saveCompartido`/`getCuidado`/`saveCuidado`:** es la única capa de acceso a datos de toda la aplicación. Cada módulo (M3-M9) lee/escribe exclusivamente a través de estos métodos; son el punto de paso obligado entre la UI y la persistencia (caché + `localStorage` + Firestore).
- **`ST` (objeto de estado, 1296-1332):** estado mutable compartido leído/escrito 180 veces en todo el archivo; sostiene el estado transitorio de formularios y navegación de 7 de los 10 módulos.
- **`_fsSet`/`_fsGet`/`_cargarDatosFirestore` (20-93):** único puente entre la capa `DB` y Firebase; toda persistencia remota pasa por estas tres funciones.
- **`window._raizOnAuth` (1243-1270, en `js/firebase-config.js` se invoca desde `onAuthStateChanged`):** callback que reconstruye la sesión local cada vez que Firebase detecta un usuario autenticado (recarga de página, nuevo dispositivo); si falla, el usuario queda con sesión de Firebase pero sin datos locales.
- **`hacerLogin` / `registrarAdmin` / `registrarInvitado` (434-474, 480-534, 596-639):** únicos puntos de entrada de autenticación; cualquiera de los tres es crítico para que un usuario pueda empezar a usar la app.
- **`confirmar` / `cerrarSheet` / `cerrarConfirm` (1216-1220):** infraestructura de UI compartida por absolutamente todos los flujos de eliminación y por la mayoría de los formularios (sheets) de los 10 módulos.
- **`renderSidebar` / `renderHome` (1041-1082, 812-1038):** puntos de entrada visual principales tras el login; `renderHome` es además la función más grande del archivo (227 líneas) y concentra la lógica de bifurcación por rol.
- **`toast` / `$` (254, 255-258):** micro-helpers usados en prácticamente el 100% de las funciones de UI del archivo; una falla aquí se propagaría a toda la aplicación.

---

## SECCIÓN 4 — FUNCIONES DEMASIADO GRANDES

**Más de 300 líneas:** ninguna función supera este umbral.

**Más de 200 líneas:**
| Función | Tamaño | Responsabilidad |
|---|---|---|
| `renderHome` | 227 líneas (812-1038) | Renderiza el Home completo bifurcando por 4 roles distintos (admin/familiar/observador/cuidadora), con tarjetas de estado, semáforos de vitales y acciones rápidas por rol. |

**Más de 100 líneas** (incluye la anterior):
| Función | Tamaño | Responsabilidad |
|---|---|---|
| `renderHome` | 227 líneas (812-1038) | Ver arriba. |
| `renderMeds` | 130 líneas (2055-2184) | Renderiza lista de medicamentos agrupada por turno/horario, con alertas de stock y progreso de adherencia diaria. |
| `renderDiario` | 113 líneas (3241-3353) | Renderiza el registro diario de alimentación (porciones e hidratación) del día. |
| `renderLista` | 105 líneas (1412-1516) | Renderiza el historial de bitácoras filtrado y agrupado por fecha, con permisos por rol. |
| `verDetalle` | 101 líneas (1519-1619) | Construye y muestra el detalle completo de un registro de bitácora. |

---

## SECCIÓN 5 — VARIABLES GLOBALES

Todas las declaraciones `const`/`let` a nivel de módulo (fuera de cualquier función), en orden de aparición:

| Variable | Línea | Tipo | Responsabilidad | Riesgo |
|---|---|---|---|---|
| `_cache` | 16 | Object (const) | Caché en memoria síncrono que respalda todos los getters/setters de `DB`. | Alto — es el único estado "fuente de verdad" en tiempo de ejecución; se puede desincronizar de `localStorage`/Firestore si una escritura falla silenciosamente. |
| `_pending` | 17 | Object (const) | Declarada para "escrituras pendientes". | Confirmado sin uso en ningún otro punto del archivo — código muerto. |
| `DB` | 95 | Object (const, 28 métodos) | Namespace/capa de datos completa. | Alto — punto único de fallo para toda persistencia (ver Sección 3). |
| `ROL_COLOR` | 235 | Object (const) | Mapa rol → color hexadecimal. | Bajo. |
| `ROL_LABEL` | 236 | Object (const) | Mapa rol → etiqueta legible. | Bajo. |
| `ROL_EMOJI` | 237 | Object (const) | Mapa rol → emoji. | Bajo. |
| `ROL_DESC` | 238-243 | Object (const) | Mapa rol → descripción larga. | Bajo. |
| `$` | 254 | Function (const, arrow) | Alias de `document.getElementById`. | Bajo — pero es una dependencia implícita de casi toda función con DOM. |
| `SCREENS_AUTH` | 269-272 | Array (const) | Lista de pantallas que requieren sesión activa. | Medio — es la única lista de control de acceso a pantallas; un id de pantalla nuevo que se olvide agregar aquí quedaría sin protección. |
| `_tipoReg` | 419 | String (let) | Tipo de registro seleccionado (`'admin'` por defecto). | Bajo. |
| `_codigoActual` | 537 | String (let) | Código de invitación ingresado actualmente. | Bajo. |
| `_invActual` | 537 | Object/null (let) | Invitación validada actualmente. | Medio — si dos flujos de validación se solapan (async), podría pisarse. |
| `_onbCuidadoras` | 674 | Array (let) | Nombres de cuidadoras en el formulario de onboarding. | Bajo. |
| `_cb` | 1217 | Function/null (let) | Callback pendiente del diálogo de confirmación genérico. | Medio — es un único slot global; si dos confirmaciones se disparan antes de resolver la primera, la segunda sobrescribe el callback de la primera. |
| `ST` | 1296-1332 | Object (const, 24 propiedades) | Estado mutable compartido de los módulos M3-M9. | Alto — ver documentación completa en Sección 6. |
| `DIAS` | 2907 | Array (const) | 7 días de la semana en minúsculas (claves de datos). | Bajo (ya unificado en RSP-004). |
| `DIA_LABEL` / `DIA_ICO` | 2908-2909 | Object (const) | Etiqueta/emoji por día. | Bajo. |
| `MOMENTO_LABEL` / `MOMENTO_ICO` | 2910-2911 | Object (const) | Etiqueta/emoji por momento de comida. | Bajo. |
| `CAT_ICO` / `CAT_LABEL` | 2912-2913 | Object (const) | Emoji/etiqueta por categoría de producto de compras. | Bajo. |
| `_catCompraActual` | 3509 | String (let) | Categoría seleccionada en sheet de nueva compra. | Bajo. |
| `_navOrig` | 2877 | Function (const) | Referencia a la función `navTo` original antes de ser envuelta. | Medio — patrón de monkey-patching sobre una función crítica (ver Sección 11). |
| `DIAS_FULL` | 3630 | Array (const) | Días con mayúscula inicial (para Agenda). | Bajo — pero es la 2ª de 3 constantes de "nombre de día" con formato distinto (ver Sección 11). |
| `TIPO_ICO` / `TIPO_LABEL` | 3632-3641 | Object (const) | Emoji/etiqueta por tipo de profesional del equipo de cuidado. | Bajo. |
| `FREQ_LABEL` | 3642 | Object (const) | Etiquetas de frecuencia (semanal/quincenal/mensual/según necesidad). | Bajo. |
| `PALETA` | 3645-3651 | Array (const) | Esquemas de color para diferenciar cuidadoras en el calendario. | Bajo. |
| `TIPOS` | 4103-4110 | Object (const) | Catálogo de tipos de evento de Agenda. | Bajo. |
| `MESES` / `MESES_CORTO` | 4119-4120 | Array (const) | Nombres de mes completos/abreviados. | Bajo. |
| `DIAS_SEMANA` | 4121 | Array (const) | Días abreviados `['Lu','Ma',...]` para cabecera del calendario. | Bajo — pero es la 3ª constante de "nombre de día" con formato distinto (ver Sección 11). |
| `CAT_INSUMO` | 4518-4527 | Object (const) | Catálogo de categorías de insumos del hogar. | Bajo. |
| `CAT_PROV` | 4528-4538 | Object (const) | Catálogo de tipos de proveedor. | Bajo. |
| `_catInsumoActual` | 4669 | String (let) | Categoría seleccionada en sheet de insumo. | Bajo. |
| `_catProvActual` | 4794 | String (let) | Categoría seleccionada en sheet de proveedor. | Bajo. |
| `CATS` | 4882-4891 | Object (const) | Catálogo de categorías de gasto. | Bajo. |
| `_catActual` | 5203 | String (let) | Categoría seleccionada en sheet de gasto. | Bajo. |
| `MESES_CAP` | 5357 | Array (const) | Nombres de mes capitalizados (uso en Informe IA). | Bajo. |
| `_invCodigoActual` | 5819 | String/null (let) | Código de invitación generado actualmente en el sheet. | Bajo. |
| `_boletaDataUrl` | 6133 | String/null (let) | Base64 de la imagen de boleta actualmente cargada. | Bajo. |

**Variables globales implícitas (asignadas a `window` sin `const`/`let`, fuera del listado anterior):**
| Variable | Línea | Descripción | Riesgo |
|---|---|---|---|
| `window._raizOnAuth` | 1243 | Callback invocado por Firebase Auth al detectar sesión. | Alto — ver Sección 3. |
| `window.navTo` | 2878 | Sobrescribe `navTo` para además llamar `prellenarFicha()` al entrar a `s-ficha-editar`. | Medio — monkey-patching de una función crítica; el `navTo` original queda accesible solo vía `_navOrig`. |
| `window.RAIZ` | 1288 | Expone `{DB,navTo,irAlHome,renderHome,renderSidebar,ROL_COLOR,ROL_LABEL,initials,hoy,fmt}` — API pública/depuración. | Bajo/Medio — superficie de acceso directo a la capa de datos desde la consola del navegador. |
| `window._resumenRendicion` | 5197 | Guarda el texto de rendición para que `copiarRendicion` lo lea después. | Medio — variable global implícita (sin `var`/`let`/`const`) usada como canal de paso de datos entre dos funciones; mismo patrón de riesgo que `_cb`. |

---

## SECCIÓN 6 — ESTADO GLOBAL (`ST`)

**Ubicación:** líneas 1296-1332. **Estructura:** objeto literal único, no tipado, con 24 propiedades agrupadas por comentarios de módulo (M3 a M9 + un bloque "OCR Receta"):

```
ST = {
  // M3 Bitácora
  bitaCuidadoId, filtro, bitacoraActual, form: { quien, presion, temp, sato,
    desayuno, almuerzo, cena, bano, hidra, activ, visita, animo },
  // M4 Salud
  tabActivo, medEditando,
  // M5 Alimentación
  tab, porciones, vasitos,
  // M9 Gastos
  mesVista, gastoEditandoId,
  // M6 Equipo
  tabEquip, diasSeleccionados (Set), editDiasSeleccionados (Set),
  // M8 Hogar
  tabHogar,
  // M7 Agenda
  anioActual, mesActual, diaSeleccionado, eventoEditandoId, tipoActual, eventoCuidadoId,
  // OCR Receta
  ocrMeds (Array),
}
```

**Quién escribe en `ST`:** virtualmente toda función que abre un sheet, cambia un tab, o registra un valor de formulario. Ejemplos por módulo: `setFiltro`/`selQuien`/`selPorcion`/`togChk`/`selAnimo`/`guardarBitacora` (M3); `setTab`/`editarMed` (M4); `setTabAlim`/`selPorcionAlim`/`togVaso` (M5); `selMes`/`abrirSheetGasto`/`editarGasto` (M9); `abrirSheetCuidadora`/`toggleDiaEquip`/`setTabEquip` (M6); `setTabHogar` (M8); `cambiarMes`/`selDia`/`abrirSheetEvento`/`editarEvento`/`selTipo` (M7); `mostrarResultadoOCR`/`toggleOcrMed`/`agregarMedsOCR`/`resetOCR` (OCR).

**Quién lee `ST`:** las funciones `render*` correspondientes a cada módulo (`renderLista`, `renderTab`, `renderTabAlim`, `renderTabGastos`, `renderTabEquip`, `renderTabHogar`, `renderCalendarioAgenda`, `renderDiaSeleccionado`, `mostrarResultadoOCR`), que consultan el valor actual de tab/filtro/selección para decidir qué pintar. En total se contaron **180 referencias a `ST.`** distribuidas en todo el archivo.

**Riesgos identificados:**
- `ST` es un único objeto compartido por 7 módulos sin ningún namespacing real más allá de los comentarios — nada impide que una función de un módulo lea/escriba por error una propiedad de otro módulo (no hay evidencia de que esto ocurra actualmente, pero la estructura no lo previene).
- No existe ningún mecanismo de invalidación/reset centralizado: cada módulo resetea manualmente sus propias propiedades de `ST` al abrir sus sheets (p. ej. `ST.diasSeleccionados=new Set([...])` en `abrirSheetCuidadora`), lo que ya produjo al menos un bug de datos corregido en RSP-004 (formatos de día inconsistentes).
- Las propiedades `Set` (`diasSeleccionados`, `editDiasSeleccionados`) son mutables por referencia; cualquier función que capture una referencia a ellas antes de que se reasignen podría operar sobre un Set obsoleto.
- No hay separación entre "estado de UI" (qué tab está activo) y "estado de formulario en edición" (`gastoEditandoId`, `medEditando`, `eventoEditandoId`) — ambos viven en el mismo objeto plano.

---

## SECCIÓN 7 — DEPENDENCIAS FIREBASE

**Superficie expuesta por `js/firebase-config.js` vía `window._fb`:** `auth`, `db`, `createUserWithEmailAndPassword`, `signInWithEmailAndPassword`, `signOut`, `onAuthStateChanged`, `doc`, `getDoc`, `setDoc`, `collection`, `getDocs`, `query`, `where`, `onSnapshot`, `deleteDoc`.

**Uso real dentro de `app.js`** (búsqueda exhaustiva por patrón):

| API | Sitios de llamada en `app.js` | Quién la usa |
|---|---|---|
| `window._fb` (acceso genérico) | 8 ocurrencias | `_fsSet`, `_fsGet`, `_cargarDatosFirestore`, `hacerLogin`, `registrarAdmin`, `registrarInvitado`, `validarCodigo`, `cerrarSesion` |
| `getDoc(` | Líneas 37, 59, 75 | `_fsGet` (37); `_cargarDatosFirestore` (59, 75) |
| `getDocs(` | Líneas 52, 66, 81, 562 | `_cargarDatosFirestore` (52, 66, 81); `validarCodigo` (562) |
| `setDoc(` | Línea 25 | `_fsSet` (única función que escribe en Firestore; todo el resto de `DB.save*` pasa por acá) |
| `collection(` / `query(` | Líneas 53-54, 67-68, 82-83, 563 | `_cargarDatosFirestore` (usuarios/cuidados/invitaciones por `adminId`); `validarCodigo` (invitaciones_hogar) |
| `where(` | Líneas 54, 68, 83 | `_cargarDatosFirestore` (filtro por `adminId`) |
| `onAuthStateChanged` | Definido en `js/firebase-config.js` (línea 31) | Dispara `window._raizOnAuth` en cada cambio de estado de sesión de Firebase |
| `createUserWithEmailAndPassword` | Líneas 496, 610 | `registrarAdmin` (496); `registrarInvitado` (610) |
| `signInWithEmailAndPassword` | Línea 450 | `hacerLogin` |
| `signOut` | Línea 661 | `cerrarSesion` |
| **`onSnapshot`** | **0 ocurrencias en `app.js`** | **Importado y expuesto pero nunca usado — sin listeners en tiempo real; toda lectura es "una sola vez" (`getDoc`/`getDocs`).** |
| **`deleteDoc`** | **0 ocurrencias en `app.js`** | **Importado y expuesto pero nunca usado — ninguna función "eliminar" del archivo borra un documento de Firestore; todas modelan el borrado como sobrescritura (`setDoc` vía `DB.save*`) de un arreglo más pequeño dentro de un documento padre.** |

**Patrón de escritura:** `_fsSet` siempre llama `setDoc(ref, data, {merge:false})` — es decir, **cada escritura reemplaza el documento completo**, nunca hace un merge parcial. Esto es consistente con el modelo de datos (pocos documentos grandes: `usuarios/{id}`, `cuidados/{id}`, `compartido/{adminId}`, `invitaciones_hogar/{adminId}`, `codigos_inv/{codigo}`) pero significa que dos escrituras casi simultáneas desde dispositivos distintos sobre el mismo documento (`compartido/{adminId}`, que es compartido por todo el hogar) pueden pisarse entre sí sin ningún control de concurrencia (no hay transacciones ni control de versión).

**Colecciones de Firestore referenciadas en el código:** `usuarios`, `cuidados`, `compartido`, `invitaciones_hogar`, `invitaciones` (línea 82, distinta de `invitaciones_hogar`), `codigos_inv` (usada en `crearInvitacion` y `validarCodigo` como colección alternativa a `invitaciones_hogar`) — se observan **al menos dos nombres de colección distintos para el concepto de "invitación"** (`invitaciones`, `invitaciones_hogar`, `codigos_inv`), evidencia de inconsistencia en el modelo de datos (ver también Sección 11).

---

## SECCIÓN 8 — EVENTOS

| Tipo | Cantidad | Detalle |
|---|---|---|
| `addEventListener` | 1 | Línea 1221: `document.addEventListener('keydown', e=>{ if(e.key==='Escape'){ cerrarSheet('ov-switcher'); cerrarConfirm(); }})` — único listener de teclado de toda la app. |
| Asignación directa `.onclick=` (a nivel de módulo) | 9 (idénticas) + 1 (`cb-ok` inicial) | `$('cb-ok').onclick=...` repetido en líneas 1219, 1966, 2885, 3608, 4085, 4503, 4867, 5339, 5806 (ver Sección 11). |
| `onclick="..."` en HTML generado dinámicamente (template strings) | 121 | Repartidos en todos los módulos de render; es el mecanismo dominante de interacción de toda la app (delegación inversa: el HTML se regenera completo en cada render en vez de usar `addEventListener` con delegación de eventos). |
| `oninput="..."` | 1 | Línea 684: `oninput="_onbCuidadoras[${i}]=this.value"` (onboarding de cuidadoras). |
| `onchange="..."` | 1 | Línea 5105: `onchange="guardarPresupuestoCat('${cat}',this.value)"` (input de presupuesto por categoría). |
| `setTimeout` | 34 | Usos principales: (a) hooks de inicialización por pantalla dentro de `navTo` (líneas 296-319, 13 casos); (b) enfoque diferido de inputs tras abrir un sheet (patrón `setTimeout(()=>$('...').focus(),300)`, ~13 casos repetidos en distintos módulos); (c) simulación de latencia/progreso (`guardarBitacora` línea 1780, `agregarMedsOCR` línea 2559, `iniciarGeneracion` líneas 5456-5471 con animación de pasos encadenados). |
| `setInterval` | 0 | No se encontró ningún uso en todo el archivo. |
| `MutationObserver` | 0 | No se encontró ningún uso. |
| `IntersectionObserver` | 0 | No se encontró ningún uso. |

---

## SECCIÓN 9 — RENDERIZADO

Todas las funciones cuyo nombre inicia con `render` o `mostrar`, o cuya responsabilidad principal (Sección 2) es pintar una pantalla/sección, manipulan el DOM asignando HTML generado dinámicamente vía template strings a `.innerHTML` de un contenedor (patrón uniforme en las 89 ocurrencias de `.innerHTML` del archivo). Listado por pantalla/elemento objetivo:

| Función | Pantalla / contenedor DOM objetivo | Genera HTML dinámico |
|---|---|---|
| `renderHome` | Home (contenedor según rol) | Sí |
| `renderSidebar` | `.sb-nav` (menú lateral) | Sí |
| `renderPerfil` | Pantalla de perfil | Sí |
| `renderLista` | Lista de bitácoras (`#bita-lista` o similar) | Sí |
| `verDetalle` | Detalle de bitácora | Sí |
| `mostrarResumenIA` | Pantalla `s-resumen-ia` | Parcial (rellena campos existentes + tabla) |
| `renderTab` | `#salud-content` (dispatcher M4) | Delegado |
| `renderMeds` | `#salud-content` (tab medicamentos) | Sí |
| `renderFicha` | `#salud-content` (tab ficha clínica) | Sí |
| `renderDocs` | `#salud-content` (tab documentos) | Sí |
| `renderHistorial` | `#salud-content` (tab historial) | Sí |
| `mostrarResultadoOCR` | Resultado de OCR de receta | Sí |
| `renderTabAlim` | Dispatcher M5 | Delegado |
| `renderPlanSemanal` | Plan semanal de comidas | Sí |
| `renderRestricciones` | Restricciones alimentarias | Sí |
| `renderDiario` | Registro diario de alimentación | Sí |
| `renderCompras` | Lista de compras | Sí |
| `renderTabEquip` | Dispatcher M6 | Delegado |
| `renderCuidadoras` | Tarjetas de cuidadoras | Sí |
| `renderEspecialistas` | Tarjetas de especialistas | Sí |
| `renderCalendario` | Calendario de turnos del equipo | Sí |
| `renderDiasBtns` | Botones de selección de día (sheet) | Sí |
| `renderAgenda` | Dispatcher M7 | Delegado |
| `renderCalendarioAgenda` | Grilla del calendario mensual | Sí |
| `renderDiaSeleccionado` | Panel de eventos del día | Sí |
| `renderEventoCard` | Tarjeta individual de evento | Sí (retorna string HTML) |
| `renderAlertas` | Banners de alertas de citas próximas | Sí |
| `renderChipsCuidadoEvento` | Chips de selección de destinatario | Sí |
| `renderTabHogar` | Dispatcher M8 | Delegado |
| `renderInsumos` | Lista de insumos del hogar | Sí |
| `renderProveedores` | Lista de proveedores | Sí |
| `renderTabGastos` | Dispatcher M9 | Delegado |
| `renderRegistro` | Registro de gastos del mes | Sí |
| `renderPresupuesto` | Desglose de presupuesto | Sí |
| `renderRendicion` | Rendición de cuentas | Sí |
| `renderHub` | Hub de informes mensuales (M10) | Sí |
| `mostrarInforme` | Header del detalle de informe | Parcial |
| `renderContenidoInforme` | Cuerpo del informe (familiar/clínico) | Sí |
| `renderInvitaciones` | Lista de accesos e invitaciones | Sí |

**Patrón dominante:** cada "hub" de módulo (`renderTab`, `renderTabAlim`, `renderTabEquip`, `renderTabHogar`, `renderTabGastos`, `renderAgenda`) actúa como dispatcher que decide, según `ST.tabX`, cuál de las funciones `render*` de detalle invocar — mismo patrón repetido 6 veces con nombres distintos (ver también Sección 11).

---

## SECCIÓN 10 — DEPENDENCIAS ENTRE FUNCIONES

Mapa de los flujos principales, construido a partir de las llamadas verificadas en el código (no incluye rutas hipotéticas):

**Flujo de autenticación (login):**
```
hacerLogin()
 └─ fb.signInWithEmailAndPassword()
     └─ _fsGet('usuarios/'+uid)              [carga datos del usuario]
     └─ _cargarDatosFirestore()              [carga usuarios/cuidados/compartido/invitaciones]
     └─ DB.setSesion()
     └─ setTimeout(800ms) → mostrarBienvenida()
         └─ navTo('s-bienvenida')
```

**Flujo de restauración de sesión (recarga de página / nuevo dispositivo):**
```
onAuthStateChanged() [js/firebase-config.js]
 └─ window._raizOnAuth(firebaseUser)
     └─ _fsGet('usuarios/'+uid)
     └─ _cargarDatosFirestore()
     └─ DB.setSesion()
     └─ si no hay cuidados → navTo('s-onb-am')   [onboarding]
     └─ si hay cuidados    → mostrarBienvenida()
```

**Flujo de registro (admin / invitado):**
```
registrarAdmin() / registrarInvitado()
 └─ fb.createUserWithEmailAndPassword()
 └─ _fsSet('usuarios/'+uid, userData)
 └─ DB.setSesion()
 └─ navTo(...)
```

**Flujo de navegación central (patrón repetido para cada módulo M3-M10):**
```
navTo(id)
 └─ activa pantalla (clases .active)
 └─ renderSidebar()                          [si aplica]
 └─ setTimeout(0) → hook de inicialización específico de la pantalla:
      's-bita-list'    → renderLista()
      's-bita-new'     → initSelectorCuidado()   [initFormulario NO se invoca — ver Sección 12]
      's-salud-hub'    → renderTab('meds')
      's-alim-hub'     → renderTabAlim(ST.tab)
      's-equipo-hub'   → renderTabEquip('cuidadoras')
      's-hogar-hub'    → renderTabHogar('insumos')
      's-gastos'       → renderTabGastos('registro')
      's-informe-hub'  → renderHub()
      's-agenda'       → renderAgenda()
      's-ficha-editar' → prellenarFicha()          [vía window.navTo, línea 2878]
      's-ocr-receta'   → resetOCR()
      's-invitaciones' → renderInvitaciones()
```

**Patrón CRUD repetido (idéntico en estructura para Bitácora, Medicamentos, Ficha, Documentos, Alimentación×4, Equipo×2, Agenda, Hogar×2, Gastos, Informes, Invitaciones):**
```
abrirSheetX() → resetea campos + ST.xEditandoId=null → classList.add('open') → setTimeout(focus,300)
       ↓ (usuario llena formulario y confirma)
guardarX() → valida campo(s) → DB.getX() → push/actualiza objeto → DB.saveX() → cerrarSheet() → toast() → renderTabX()/renderX()
       ↓ (o bien)
eliminarX() → confirmar(...) → DB.getX() → filter(id) → DB.saveX() → renderTabX()/renderX()
```

**Flujo de informe mensual IA:**
```
renderHub()
 └─ onclick → iniciarGeneracion()
     └─ animación local (setTimeout encadenados, sin red)
     └─ generarInformeIA()          [100% local — ver Sección 12]
         ├─ generarResumenFamiliar()
         ├─ generarResumenClinico()
         └─ generarSugerencias()
     └─ mostrarInforme(informe)
         └─ renderContenidoInforme()
```

**Flujo de OCR de receta (roto — ver Sección 12/13):**
```
navTo('s-ocr-receta') → resetOCR()
 └─ (usuario sube archivo) → procesarRecetaOCR()
     └─ fetch('https://api.anthropic.com/v1/messages')   [sin autenticación — fallaría]
         └─ catch → fallback manual (toast de error + campos manuales)
     └─ (si tuviera éxito) → mostrarResultadoOCR()
         └─ agregarMedsOCR() → DB.saveCuidado()
```

---

## SECCIÓN 11 — CÓDIGO DUPLICADO

**Bloques ejecutables idénticos repetidos:**
- `$('cb-ok').onclick=()=>{ $('confirm-ov').classList.remove('open'); if(_cb)_cb(); };` — **9 repeticiones exactas** (líneas 1219, 1966, 2885, 3608, 4085, 4503, 4867, 5339, 5806), una al final de cada bloque de módulo.
- Helper local `deskBtn=(label,fn)=>...` (mismo template de botón, mismos estilos inline) — **redefinido 3 veces** dentro de `renderTabEquip` (3695), `renderTabHogar` (4574) y `renderTabGastos` (4937), en vez de extraerse una sola vez a nivel de módulo.
- Bloques de comentarios de sección vacíos repetidos al final de cada módulo: `/* SHEETS / CONFIRM */`, `/* QA AUTOMÁTICO */` / `/* QA */`, `/* INICIALIZACIÓN */` / `/* INIT */` — aparecen sin contenido real debajo en múltiples puntos (p. ej. 1969-1994, 2883-2891, 3606-3617, 4083-4090, 4501-4508, 4865-4871, 5337-5343, 5804-5810).

**Patrones estructurales (misma forma, distintos nombres de campo/arreglo) repetidos ≥3 veces:**
- **CRUD Alimentación** (4 sub-módulos: Plan Semanal, Restricciones, Registro Diario, Lista de Compras): `renderX`/`abrirSheetX`/`guardarX`/`eliminarX` con la misma secuencia de pasos en las 4 variantes (líneas 2991-3604).
- **CRUD Equipo de Cuidado**: `renderCuidadoras`/`renderEspecialistas` (3721-3854) y `guardarCuidadora`/`guardarEspecialista`/`actualizarCuidadora` (3990-4071) comparten esqueleto casi línea por línea.
- **CRUD Hogar**: `renderInsumos`/`renderProveedores`, `abrirSheetInsumo`/`abrirSheetProveedor`, `editarInsumo`/`editarProveedor`, `guardarInsumo`/`guardarProveedor`, `eliminarInsumoActual`/`eliminarProvActual` (4590-4863) — 5 pares de funciones prácticamente idénticas salvo el nombre del arreglo destino.
- **Autenticación**: `registrarAdmin` (480-534) y `registrarInvitado` (596-639) repiten el mismo flujo `createUserWithEmailAndPassword → construir userData → _fsSet('usuarios/...') → DB.setSesion`.
- **Dispatcher de tabs**: `renderTab`, `renderTabAlim`, `renderTabEquip`, `renderTabHogar`, `renderTabGastos`, `renderAgenda` implementan el mismo patrón "según `ST.tabX`, invocar la función `render*` correspondiente" 6 veces.
- **Foco diferido tras abrir sheet**: patrón `setTimeout(()=>$('campo').focus(),300)` repetido en al menos 13 funciones `abrirSheetX` distintas.

**Duplicación de datos/nombres:**
- Tres constantes distintas para "nombre de día de la semana", cada una con formato propio: `DIAS` (línea 2907, minúsculas: `lunes`…), `DIAS_FULL` (línea 3630, capitalizado: `Lunes`…), `DIAS_SEMANA` (línea 4121, abreviado: `Lu`…) — usadas en contextos distintos (datos vs. etiquetas de Agenda vs. cabecera de calendario), sin una única fuente de verdad.
- Campos duplicados en `guardarInsumo` (4708-4717): el objeto guarda simultáneamente `stock`/`cantidad` (mismo valor) y `minimo`/`stockMin` (mismo valor) — indicio de una migración de nombre de campo incompleta.
- Al menos 3 nombres de colección de Firestore para el concepto de "invitación": `invitaciones` (82), `invitaciones_hogar` (124, 563), `codigos_inv` (usada por `crearInvitacion`/`validarCodigo`).

**Lógica de UI repetida:**
- Cálculo de "badge" de porción (`'Todo'?'b-ok':'Nada'?'b-err':'b-warn'` o variante) repetido en al menos 4 sitios entre `renderDiario` y `selPorcionAlim`.
- Markup de "vasos de agua" (`Array.from({length:8},...)`) reconstruido de forma independiente en `renderDiario` (render completo) y en `togVaso` (actualización parcial del DOM).

---

## SECCIÓN 12 — DEUDA TÉCNICA

**Funciones demasiado largas:** ver Sección 4 (1 función >200 líneas, 5 funciones >100 líneas).

**Variables globales excesivas:** 38 bindings a nivel de módulo (`const`/`let`) más 4 asignaciones implícitas a `window` (Sección 5) — sin ningún mecanismo de encapsulamiento (todos son visibles y mutables desde cualquier función del archivo).

**Código muerto confirmado** (verificado por ausencia de cualquier punto de invocación en `app.js` **e** `index.html`):
| Elemento | Línea | Evidencia |
|---|---|---|
| `_pending` (variable) | 17 | Declarada, jamás leída ni escrita en ningún otro punto. |
| `initDemo()` | 334-414 | Ninguna llamada; todo el sembrado de datos demo (incluidos 4 usuarios con contraseña hardcodeada `'123456'` y un código de invitación fijo `'847291'`) es inalcanzable en el flujo actual de la app. |
| `qaAutoTest()` | 1224-1239 | Ninguna llamada; función de auto-test de QA sin botón ni disparador visible. |
| `initFormulario()` | 1637-1690 | Ninguna llamada; al navegar a `s-bita-new`, `navTo` solo dispara `initSelectorCuidado()` (línea 296), no `initFormulario()`. |
| `guardarStock()` | 2321-2324 | Alias de retrocompatibilidad hacia `guardarReposicion()`; sin ningún llamador. |
| `diaHoyIdx()` | 3657 | Sin ningún llamador (existe una función equivalente usada, `diaHoy()`, línea 2917, con otra implementación). |
| `fechaLegible()` | 4124-4128 | Sin ningún llamador. |
| `tomasPendientesHoy()` | 6115-6120 | Sin ningún llamador; `renderMeds` calcula el progreso de adherencia de forma inline en vez de usar este helper. |
| `stockCalculado()` | 6122-6130 | Sin ningún llamador. Contiene además una variable interna `consumidas` que se calcula pero nunca se usa en el `return` de la propia función (deuda técnica anidada). |
| `abrirLightbox()` | 6199-6206 | Sin ningún llamador; `cerrarLightbox()` sí está conectado en `index.html` (líneas 1909, 1912) — el lightbox nunca puede abrirse desde la UI actual. |
| `resetearDatosDemo()` | 6246-6257 | Sin ningún llamador ni botón en `index.html`. |
| `fabActionGastos()` | 6273-6277 | El FAB de Gastos en `index.html` (línea 684) llama directamente a `abrirSheetGasto()`, sin pasar por esta función — la validación de rol que contiene nunca se ejecuta desde la UI. |

**Comentarios obsoletos / huérfanos:** múltiples encabezados de sección (`/* ── CAPA DE DATOS ── */`, `/* ── ESTADO LOCAL ── */`, `/* ── HELPERS ── */`, `/* ── NAVEGACIÓN ── */`, `/* ── SIDEBAR ── */`, `/* SHEETS/CONFIRM */`, `/* QA */`, `/* INIT */`) aparecen repetidos sin contenido real debajo (ver Sección 11), vestigios de una plantilla de módulo copiada y pegada sin limpiar entre bloques M3-M10.

**`TODO`/`FIXME`:** no se encontró ningún comentario `TODO` ni `FIXME` en las 6277 líneas del archivo (búsqueda exhaustiva, cero resultados).

**Responsabilidades mezcladas:**
- Las funciones `calcularHorarios`, `proximaToma`, `tomasPendientesHoy`, `stockCalculado` (líneas 6083-6130), semánticamente del dominio "Medicamentos", están ubicadas físicamente dentro del rango de líneas del bloque "Invitaciones y Accesos" (5813-6131) — desalineación entre organización física del archivo y agrupación lógica.
- `_navOrig`/`window.navTo` (2877-2881): la función central de navegación (`navTo`) es sobrescrita a mitad de archivo mediante un patrón de monkey-patching para inyectar una llamada a `prellenarFicha()`, en vez de agregar ese caso directamente dentro de la función original.
- Atributos `style` malformados detectados en al menos 2 puntos: línea 4298 (`style="cursor:pointer:''}"`, dentro de `renderEventoCard`) y línea 5034 (`style="cursor:pointer:''}"`, dentro de `renderRegistro`) — restos de una expresión ternaria de JS editada incorrectamente, dejando texto literal inválido en el atributo CSS.

---

## SECCIÓN 13 — RIESGOS TÉCNICOS

**CRÍTICO:**
- **Función de OCR de receta médica inoperante y sin autenticación (`procesarRecetaOCR`, 2428-2508):** llama a `fetch('https://api.anthropic.com/v1/messages')` sin ningún header `x-api-key`/`Authorization`. Por qué es crítico: es una función que procesa datos de salud (recetas médicas) y su "camino feliz" no puede completarse nunca tal como está escrito — la API respondería con error de autenticación (o la petición sería bloqueada por política CORS del navegador antes de eso). El único camino funcional real es el fallback manual del propio `catch`.
- **Ausencia de control de concurrencia en escrituras compartidas:** `_fsSet` siempre usa `setDoc(ref, data, {merge:false})`, reemplazando el documento completo. El documento `compartido/{adminId}` es escrito por múltiples roles (admin, familiar, cuidadora) potencialmente desde dispositivos distintos y simultáneos, sin transacciones, sin `onSnapshot` (no hay sincronización en tiempo real) y sin ningún control de versión — dos escrituras casi simultáneas pueden pisarse silenciosamente y perder datos del otro usuario. Por qué es crítico: puede producir pérdida silenciosa de datos de cuidado real (bitácoras, medicamentos, gastos) sin ningún aviso al usuario.

**ALTO:**
- **`onSnapshot` importado pero nunca usado:** ningún dato se actualiza en tiempo real entre dispositivos; un familiar y una cuidadora viendo la misma pantalla en dispositivos distintos no verán los cambios del otro hasta que recarguen manualmente (`recargarDesdeFB`, que tampoco está automatizada por ningún timer).
- **`deleteDoc` importado pero nunca usado:** no existe ningún borrado real de documento de Firestore; todo "eliminar" es una sobrescritura de un arreglo más chico dentro de un documento padre — si ese documento padre crece indefinidamente (nunca se podan sub-documentos huérfanos), no hay mecanismo de limpieza a nivel de Firestore.
- **Validación de rol solo del lado del cliente y, en algunos casos, ausente incluso ahí:** `crearInvitacion` (5858-5909), que sí escribe en Firestore, no revalida `rol==='admin'` dentro de la función (solo `abrirSheetInvitacion` lo valida antes de abrir el sheet); lo mismo ocurre en `revocarAcceso` (6033-6049) y `cancelarInvitacion` (6052-6065). Cualquier función definida a nivel de módulo es accesible desde la consola del navegador (`fabActionGastos()`, `revocarAcceso('algúnId')`, etc.) sin que exista ninguna verificación de permisos del lado del servidor (reglas de Firestore no auditadas en este documento, ya que el alcance de RSP-006 es únicamente `app.js`).
- **`initDemo` inerte pero presente en el bundle público:** el archivo `app.js` se sirve tal cual a cualquier visitante (GitHub Pages, sin build step ni minificación), por lo que las credenciales demo hardcodeadas (`admin@raiz.app`/`123456`, etc., línea 338-341) y el código de invitación fijo (`'847291'`, línea 412) son legibles por cualquiera que inspeccione el código fuente, aunque la función nunca se ejecute.

**MEDIO:**
- **`hashPass` (246-251):** hash djb2 no criptográfico (determinístico, sin salt, reversible por fuerza bruta/tabla arcoíris), usado únicamente por el código muerto de `initDemo` — riesgo latente si en el futuro se reutilizara para autenticación real fuera del contexto demo.
- **Inconsistencia de confirmación antes de eliminar:** `eliminarCompra` (3551-3557) borra sin pedir confirmación, a diferencia de prácticamente todas las demás funciones `eliminar*` del archivo, que sí usan `confirmar(...)`.
- **FAB de Gastos sin gate de rol activo:** ver hallazgo de Sección 12 (`fabActionGastos` nunca se invoca desde la UI real).
- **Estado global mutable sin namespacing (`ST`) y variables de "slot único" (`_cb`, `window._resumenRendicion`):** en escenarios de interacción rápida/solapada (doble clic, dos confirmaciones abiertas casi a la vez) podrían producir comportamiento incorrecto silencioso — no se encontró evidencia de que esto ocurra hoy, pero la estructura no lo previene.
- **Tres nombres de colección de Firestore distintos para "invitación"** (`invitaciones`, `invitaciones_hogar`, `codigos_inv`) — riesgo de que una consulta futura a la colección equivocada no encuentre datos que sí existen en otra.

**BAJO:**
- Código muerto general (Sección 12) — no afecta el comportamiento actual pero aumenta el costo de lectura/mantenimiento y el riesgo de confusión para quien edite el archivo sin saber que esas funciones son inalcanzables.
- Comentarios de sección huérfanos/duplicados — puramente cosmético, sin impacto funcional.
- Atributos `style` malformados (líneas 4298, 5034) — CSS inválido ignorado por el navegador, sin impacto visual observado, pero indicativo de refactors incompletos sin revisión posterior.

---

## SECCIÓN 14 — ESTADÍSTICAS

| Métrica | Valor |
|---|---|
| Líneas totales del archivo | 6277 |
| Tamaño del archivo | ~272 KB (272.334 bytes) |
| Cantidad total de funciones (top-level + métodos DB + asignaciones a `window`) | 274 (244 top-level + 28 métodos de `DB` + 2 asignadas a `window`) |
| Cantidad de variables globales (`const`/`let` a nivel de módulo) | 38 |
| Cantidad de variables/objetos asignados implícitamente a `window` | 4 (`window._raizOnAuth`, `window.navTo`, `window.RAIZ`, `window._resumenRendicion`) |
| Cantidad de funciones renderizadoras (`render*`/`mostrar*` que pintan pantalla) | ~38 (ver listado completo en Sección 9) |
| Cantidad de listeners (`addEventListener`) | 1 |
| Cantidad de asignaciones directas `.onclick=` a nivel de módulo | 9 (todas idénticas, ver Sección 11) |
| Cantidad de `onclick="..."` en HTML generado dinámicamente | 121 |
| Cantidad de `oninput="..."` / `onchange="..."` en HTML generado | 1 / 1 |
| Cantidad de consultas/llamadas Firebase (Auth + Firestore combinadas) | 8 referencias a `window._fb` + 3 `getDoc(` + 4 `getDocs(` + 1 `setDoc(` + 2 `createUserWithEmailAndPassword` + 1 `signInWithEmailAndPassword` + 1 `signOut` + 1 `onAuthStateChanged` (en `firebase-config.js`) = **21 puntos de contacto directo con Firebase** |
| Cantidad de consultas Firestore específicas (`query`+`where`+`collection`) | 4 consultas compuestas (líneas 52-54, 66-68, 81-83, 562-563) |
| Cantidad de timers (`setTimeout`) | 34 |
| Cantidad de timers recurrentes (`setInterval`) | 0 |
| Cantidad de `MutationObserver` / `IntersectionObserver` | 0 / 0 |
| Cantidad de módulos funcionales identificados | 11 (Auth/M1, Onboarding+Home/M2, Bitácora/M3, Salud/M4, Alimentación/M5, Equipo de Cuidado/M6, Agenda/M7, Hogar e Insumos/M8, Gastos y Finanzas/M9, Informe Mensual IA/M10, Invitaciones y Accesos) + Capa de Datos y Helpers compartidos como infraestructura transversal |
| Funciones sin ningún punto de invocación detectado (código muerto confirmado) | 11 |
| Funciones >100 líneas / >200 líneas / >300 líneas | 5 / 1 / 0 |
| Repeticiones exactas del handler `$('cb-ok').onclick=...` | 9 |

---

## SECCIÓN 15 — CONCLUSIÓN

`js/app.js` es un archivo funcionalmente amplio (274 funciones, 11 módulos) pero **estructuralmente simple en superficie**: casi todas las funciones son cortas (solo 5 superan 100 líneas, ninguna supera 300) y siguen un puñado reducido de patrones repetidos —hub de tabs, CRUD de 4 pasos, sheet con foco diferido— aplicados una y otra vez a lo largo de 10 módulos de dominio. Esto hace que el código sea, en principio, fácil de seguir función por función, pero al costo de una duplicación estructural considerable: el mismo esqueleto CRUD aparece copiado y ligeramente adaptado al menos 8 veces, el mismo handler de confirmación se reasigna 9 veces de forma idéntica, y hay evidencia clara (comentarios de sección huérfanos, helpers redefinidos 3 veces) de que el archivo es el resultado de fusionar 10 módulos desarrollados por separado sin un paso de consolidación posterior.

**Fortalezas:**
- Separación consistente entre capa de datos (`DB`), estado transitorio de UI (`ST`) y funciones de presentación — aunque ambas capas globales carecen de encapsulamiento, la convención se respeta en la enorme mayoría de las 274 funciones auditadas.
- Los flujos de autenticación y persistencia (login, registro, restauración de sesión, guardado) están concentrados en un número pequeño de funciones bien identificables (Sección 3), lo que facilita ubicar el punto de entrada de cualquier bug relacionado con sesión o datos.
- No se encontró ningún `TODO`/`FIXME` pendiente ni ninguna función de más de 300 líneas — la deuda técnica más severa (ver abajo) es de tipo estructural/arquitectónico, no de "funciones gigantes ilegibles".

**Debilidades principales:**
- Duplicación sistemática de patrones CRUD y de boilerplate de inicialización de módulo, que multiplica por 5-9 el punto de mantenimiento de cualquier cambio transversal (p. ej. cambiar el comportamiento del diálogo de confirmación requeriría tocar 9 líneas idénticas).
- Código muerto no trivial: 11 funciones sin ningún punto de invocación, incluyendo una función de inicialización de formulario (`initFormulario`) cuya ausencia de invocación es indistinguible, sin más contexto, de un bug funcional real, y una función de apertura de lightbox (`abrirLightbox`) cuyo cierre sí está conectado mientras la apertura no lo está.
- Una función crítica desde el punto de vista de datos de salud (`procesarRecetaOCR`, OCR de receta médica vía IA) está actualmente rota por diseño (sin autenticación de API), y la función de "informe mensual con IA" (`generarInformeIA`) no involucra ningún modelo de IA real pese a su nombre — ambos hechos no son evidentes para quien lea solo los nombres de las funciones ni la UI resultante.
- Dependencia total en escritura-por-reemplazo de documentos de Firestore sin control de concurrencia ni sincronización en tiempo real (`onSnapshot`/`deleteDoc` importados pero jamás usados), lo cual es un riesgo arquitectónico de fondo para una aplicación multiusuario/multi-dispositivo como RAÍZ.

Este documento no propone soluciones ni prioriza un plan de acción; su propósito es servir como mapa de evidencia verificado para que futuras decisiones de refactorización (fuera del alcance de este Sprint) se tomen sobre hechos confirmados en el código y no sobre suposiciones.
