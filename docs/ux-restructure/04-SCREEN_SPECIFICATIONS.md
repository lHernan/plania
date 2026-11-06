# 04 · Especificación de pantallas

**Tachao tendrá 10 pantallas y 3 hojas/paneles contextuales (S3, S7, S11).** Cada ficha sigue los 10 puntos del brief. "Reutiliza" indica el código existente que sirve de base; "Nuevo" indica lo que hay que construir.

| # | Pantalla / hoja | Contexto | Prioridad |
|---|-----------------|----------|-----------|
| S1 | Landing | Público | Fase 3 |
| S2 | Planificador | Público (borrador) y privado (IA) | Fase 3 |
| S3 | Hoja de acceso | Público | Fase 3 (existe `AuthModal`) |
| S4 | Viaje compartido | Público | Se mantiene |
| S5 | Mis viajes | Global | Fase 2 |
| S6 | Itinerario | Viaje | Fase 1 |
| S7 | Hoja de actividad | Viaje (contextual) | Fase 1 |
| S8 | Mapa | Viaje | Fase 1 |
| S9 | Cartera | Viaje | Fase 1 |
| S10 | Viaje (resumen y preparación) | Viaje | Fase 1-4 |
| S11 | Tachi | Transversal (hoja/panel) | Fase 3 |
| S12 | Recuerdos | Viaje terminado | Fase 5 |
| S13 | Perfil y ajustes | Global | Fase 2 |

---

## S6 · Itinerario (corazón)

| Punto | Especificación |
|-------|----------------|
| Objetivo | Saber qué toca, en qué orden, y marcarlo como «¡Tachao!». |
| Usuario / contexto | Todos. Uso dominante: móvil, en ruta, con prisa. |
| Información | Tira de días; barra del día (fecha, ciudad, nº actividades, progreso, coste estimado); timeline con hora, título, categoría, ubicación, insignia de origen (reserva/sugerida), indicadores de **reserva** y **documento** en la propia tarjeta; sección de completadas. |
| Componentes | Reutiliza: tira de días, barra de resumen, `SortableActivityCard`, `ScheduleSuggestions`, `CelebrationOverlay`, `FloatingActions` (+). Nuevo: **tarjeta "Ahora / Siguiente"** fija arriba en modo Hoy; chips en la tarjeta: 🎫 reserva, 📄 nº documentos. |
| Acciones | Completar (checkbox/swipe), reordenar, añadir (+), abrir hoja de actividad, Tachi (reorganizar el día), ver día en mapa, cambiar de día. |
| Relaciones | Hoja de actividad (S7), Mapa (S8, conserva día), Cartera (S9 desde chip de reserva), Tachi (S11). |
| Vacíos | Día sin actividades: "Este día está libre" + [Añadir] [Pedir ideas a Tachi] [Importar reservas]. Viaje sin días: crear primer día o planificar con IA. |
| Carga / error | Esqueleto de 3 tarjetas (no spinner a pantalla completa). Offline: banner existente `OfflineStatus`; mutaciones en cola (ya implementado). |
| Responsive | Móvil: una columna, bottom nav, FAB +. Desktop: dos columnas; la derecha es mapa del día o detalle de actividad, **no** un apilado de widgets. |
| IA | Tachi: reorganizar el resto del día, sugerencias de horario, «rellenar huecos» (vía agente con acción `add_activity`). |

**Modos**:

| Modo | Cuándo | Diferencias |
|------|--------|-------------|
| Planificando | Hoy < `startDate` | Banner de preparación (enlaza a Viaje › Resumen). |
| Hoy | Dentro del rango del viaje | Día de hoy preseleccionado, tarjeta "Ahora/Siguiente" con dirección y documento a 1 toque. |
| Recuerdo | Hoy > `endDate` | Timeline de solo lectura por defecto; completadas destacadas; CTA a Recuerdos. |

**Se retira del Itinerario** (se muda, no se elimina): sidebar de "AI quick actions", reservas críticas, compras, presupuesto, travel tools → Cartera / Viaje / Tachi.

---

## S7 · Hoja de actividad (contextual)

| Punto | Especificación |
|-------|----------------|
| Objetivo | Todo lo de una actividad sin salir del día. |
| Usuario / contexto | En ruta (consultar) y planificando (editar). |
| Información | Título, hora, duración, categoría, ubicación con enlace a Maps, notas; bloque **Reserva** (proveedor, localizador, horarios, pasajeros, estado de campos extraído/estimado/por confirmar); bloque **Documentos** (miniaturas, estado offline, "mostrar código"); comentarios. |
| Componentes | Reutiliza: `ActivityEditModal`, `ActivityFilesSection`, `DocumentViewer`, `OriginBadge`, `ActivityCommentsModal`. Nuevo: separar **modo lectura** (por defecto) de **modo edición**; hoy el modal abre directamente en edición. |
| Acciones | Completar, editar, ver en mapa, abrir documento, adjuntar, comentar, duplicar/mover, borrar. |
| Relaciones | Mapa (S8), Cartera (S9), `DocumentViewer`. |
| Vacíos | Sin documentos: "Adjunta tu entrada o confirmación" + [Subir] [Importar PDF]. Sin ubicación: "Añade dirección para verla en el mapa". |
| Carga / error | Subida con progreso por fichero; error de subida recuperable con reintento. |
| Responsive | Móvil: bottom sheet a 90 % de alto con arrastre. Desktop: panel derecho del Itinerario. |
| IA | "Pregúntale a Tachi sobre esta actividad" (abre S11 con la actividad como contexto). |

---

## S8 · Mapa

| Punto | Especificación |
|-------|----------------|
| Objetivo | Ver dónde está cada cosa del día y cómo moverse entre ellas. |
| Usuario / contexto | En ruta, orientándose; planificando, para agrupar por zonas. |
| Información | Marcadores numerados (pendientes) y con check (completadas), ruta estimada, filtros Todas/Pendientes/Tachadas, categorías y búsqueda (ya existen), tarjeta de la actividad seleccionada. |
| Componentes | Reutiliza: `DayMapView` completo (`MapFilters`, `buildRouteLegs`, tarjeta contextual), con `canEdit=false` para invitados viewer (los borradores se editan). Nuevo: selector **Día / Viaje completo** (agrega marcadores de todos los días con color por día). |
| Acciones | Seleccionar marcador, completar, abrir hoja de actividad, abrir en Google Maps, cambiar de día. |
| Relaciones | Itinerario (mismo día), S7. |
| Vacíos | Sin coordenadas: mensaje existente + lista de actividades sin ubicación con [Añadir dirección]. |
| Carga / error | Geocodificación progresiva (ya existe caché); sin `GEOAPIFY` → estado degradado explicado. |
| Responsive | Móvil: pantalla completa dentro de la sección (no overlay modal) con tira de días arriba y tarjeta abajo. Desktop: también disponible como panel del Itinerario. |
| IA | "Optimizar el orden del día" → Tachi (S11) con distancias. |

> **Decidido:** hoy los invitados no ven el botón de mapa (está dentro de `!isInvitee`). El mapa será visible para todos los roles **en solo lectura**, para que el invitado vea las funcionalidades; completar y editar se restringen.

---

## S9 · Cartera (reservas + documentos)

| Punto | Especificación |
|-------|----------------|
| Objetivo | Encontrar en segundos cualquier billete, confirmación o reserva, y ver qué falta por reservar. |
| Usuario / contexto | Aeropuerto, check-in de hotel, puerta de un museo. Una mano, poca cobertura. |
| Información | **Tab Reservas**: "Hoy" arriba (en modo Hoy); agrupadas por tipo (vuelos, alojamiento, transporte, entradas, otros) usando `booking.type` y `booking.groupId`; sección **Por reservar** (= `critical_reservations`, con urgencia). **Tab Documentos**: todos los `activity_files` del viaje, agrupados por día/actividad, con estado offline. |
| Componentes | Reutiliza: `CriticalReservationsPanel`, `BookingReviewCard` (como vista de lectura), `DocumentViewer`, `offline-documents`. Nuevo: selectores derivados `selectTripBookings(trip)` y `selectTripDocuments(trip)` (cliente, sin API nueva). |
| Acciones | Abrir documento / "mostrar código", ir a la actividad, guardar offline, importar reservas (PDF), añadir reserva pendiente, marcar reservada. |
| Relaciones | Itinerario (ir a la actividad), S7, `BookingImportModal`. |
| Vacíos | "Sube tus reservas y Tachao las ordena por ti" + [Importar PDF]. Por reservar vacío: no se muestra la sección. |
| Carga / error | Lista inmediata desde el store; miniaturas perezosas. Documento no disponible offline: aviso por fila (ya existe el estado). |
| Responsive | Móvil: lista a ancho completo. Desktop: lista + visor a la derecha. |
| IA | Importar reservas (extracción), detectar duplicados (ya existe), "¿qué me falta reservar?" vía Tachi. |

**Nombre decidido:** "Cartera". Resuelve P5 y P6 del audit: un solo lugar con dos tabs y vocabulario claro (**Reservas** = confirmadas; **Por reservar** = pendientes).

---

## S10 · Viaje (resumen y preparación)

Una pantalla con tabs segmentadas. Agrupa lo que hoy es el sidebar.

| Tab | Contenido | Reutiliza | Nuevo |
|-----|-----------|-----------|-------|
| **Resumen** | Portada (foto subida por el usuario o, por defecto, del set curado), fechas o "N días, sin fechas" con CTA [Fijar fechas], ciudades (de `trip_days.city`), viajeros, presupuesto estimado en la **moneda del viaje**, **estado de preparación** (checklist calculada: reservas por reservar, días vacíos, documentos sin offline, maleta), personas con acceso | Tarjeta de presupuesto, `TravelContextEditor`, `ShareTripModal` | Checklist de preparación (derivada, sin datos nuevos). Portada del usuario (Fase 4). |
| **Maleta** | Lista por categorías con cantidades y motivo. El usuario elige el modo: **Mi maleta** (personal) o **Compartida** con las personas del viaje (cada ítem con "quién lo lleva" opcional) | `PackingListCard`, `api/packing-list` | Persistencia en servidor y modo personal/compartida (Fase 4, migración aditiva). |
| **Compras** | Lista de deseos y sugerencias por ciudad | `ShoppingListPanel` | — |
| **Herramientas** | Llegada y traslados, pagos por ciudad, conversor, emergencias | `ArrivalAssistant`, `CityPaymentGuideCard`, `CurrencyConverter`, `EmergencyInfoCard` | — |

| Punto | Especificación |
|-------|----------------|
| Objetivo | Preparar el viaje y tener a mano lo transversal. |
| Usuario / contexto | Antes del viaje (sobre todo) y puntualmente durante. |
| Acciones | Editar datos del viaje, compartir, generar maleta, añadir compras, consultar herramientas. |
| Relaciones | Cartera (desde checklist), Itinerario (días vacíos), Recuerdos (viaje terminado). |
| Vacíos | Maleta sin generar: [Generar con Tachi]. Contexto vacío: "Cuéntanos cuántos viajáis y con qué equipaje para afinar las sugerencias". |
| Carga / error | Cada tab carga de forma independiente. |
| Responsive | Móvil: tabs segmentadas con scroll horizontal. Desktop: tabs laterales o dos columnas en Resumen. |
| IA | Maleta con clima, traslados de llegada, sugerencias de compra, resumen del viaje. |

---

## S11 · Tachi (hoja/panel transversal)

> **Tachi** es la mascota de IA de Tachao y el único nombre de la IA ("¡Pregúntale a Tachi!"). El actual Day Genius pasa a ser su acción "Reorganizar el día"; el agente de viaje pasa a ser la conversación con Tachi.

| Punto | Especificación |
|-------|----------------|
| Objetivo | Una sola puerta a la IA, que ya sabe en qué viaje, día y actividad está el usuario. |
| Usuario / contexto | Usuarios registrados. Es el único botón flotante además del "+". Para visitantes el botón se ve y abre la hoja de acceso. |
| Información | Cabecera con el contexto ("Kioto · jueves 14"), **acciones sugeridas según sección**, conversación (agente actual), vista previa de cambios antes de aplicar. |
| Componentes | Reutiliza: `DayGeniusModal` (reorganizar día), `ChatPanel` + `use-chat-store` (conversación con acciones), `BookingImportModal`, importación de texto/voz. Nuevo: contenedor único con **acciones rápidas por contexto**; renombrar el agente a Tachi en la UI. |
| Acciones por contexto | **Itinerario**: reorganizar el día, rellenar huecos, importar notas. **Actividad**: alternativas bajo techo, cómo llegar. **Mapa**: optimizar orden. **Cartera**: importar PDF, qué falta reservar. **Viaje**: generar maleta, revisar preparación. **Recuerdos**: resumir el viaje. |
| Relaciones | Todas las secciones; aplica cambios vía store (`applyDayPlan`, acciones `ChatAction`). |
| Vacíos | Primera vez: 3 acciones sugeridas, sin muro de texto. |
| Carga / error | Estados existentes de `DayGeniusModal` (cargando, sin cambios, conflicto, offline, fallo con reintento). |
| Responsive | Móvil: bottom sheet. Desktop: panel lateral derecho no modal. |
| IA | Es la IA. Mantiene el patrón propuesta → vista previa → aplicar. |

---

## S5 · Mis viajes

| Punto | Especificación |
|-------|----------------|
| Objetivo | Ver y gestionar todos los viajes; elegir cuál abrir. |
| Usuario / contexto | Ocasional; planificadores con varios viajes. |
| Información | Grupos **En curso / Próximos / En planificación (sin fechas) / Compartidos conmigo / Anteriores**, usando `TripTiming` de `trip-selection.ts`. Tarjeta con foto/portada, nombre, fechas, ciudades, nº actividades, favorito. |
| Componentes | Grupo "En planificación" = viajes sin fechas (solo nº de días). Reutiliza: datos de `fetchAllTrips` / `fetchSharedTrips` (`TripSummary`, `SharedTripSummary`), acciones del `TripSwitcher` (favorito, borrar, crear). |
| Acciones | Abrir, crear (manual o con IA), marcar favorito, borrar, duplicar como plantilla (si se aprueba). |
| Relaciones | Itinerario de cada viaje, Planificador (S2). |
| Vacíos | Sin viajes: hero con planificador IA + plantillas (lo que hoy hace la landing para usuarios logueados). |
| Carga / error | Esqueletos de tarjeta; offline: viajes en caché marcados. |
| Responsive | Móvil: lista. Desktop: rejilla de 3 columnas. |
| IA | "Planificar un viaje nuevo" (S2). |

El `TripSwitcher` de la cabecera se mantiene como acceso rápido y añade "Ver todos los viajes".

---

## S1 · Landing

| Punto | Especificación |
|-------|----------------|
| Objetivo | Explicar en 5 segundos qué es Tachao y llevar al visitante a preparar su primer viaje; registro al guardar o al pedir ayuda a Tachi. |
| Información | Hero con fotografía del set curado y licenciado y claim «Destino Tachao, recuerdos que quedan»; campo de planificación ("¿A dónde vas?" + fechas); 3 bloques de valor ilustrados con capturas reales (Planifica con IA · Todo tu viaje en un sitio · Vívelo y táchalo); plantillas con foto; acceso. |
| Componentes | Reutiliza: `TRIP_TEMPLATES`, `AuthModal`. Nuevo: hero, bloques de valor. |
| Acciones | Empezar a planificar (S2), usar plantilla (borrador), iniciar sesión. |
| Vacíos / error | No aplica. Sin conexión: mensaje y acceso a viajes en caché si hay sesión. |
| Responsive | Móvil: hero vertical con campo de destino visible sin scroll. |
| IA | Presenta a Tachi ("¡Pregúntale a Tachi!"); usarlo exige cuenta. |

---

## S2 · Planificador

| Punto | Especificación |
|-------|----------------|
| Objetivo | De "destino + fechas + estilo" a un primer itinerario editable. |
| Usuario / contexto | Visitante (rellena el formulario y crea un borrador manual) o autenticado (genera con Tachi). |
| Información | Paso 1 destino(s) y **fechas o nº de días**; paso 2 estilo (ritmo, presupuesto, intereses: reutiliza `preferences` de `TravelContext`); paso 3 vista previa por días; opcional: "¿Ya tienes reservas? Súbelas". |
| Componentes | Reutiliza: `api/import` con `planning-prompt`, `PlanStep`, `BookingImportModal`. |
| Acciones | Visitante: [Generar con Tachi] abre la hoja de acceso y, tras registrarse, genera con los datos ya rellenados. Autenticado: generar, regenerar un día, aceptar → crea viaje y abre Itinerario. |
| Vacíos / error | Timeout del modelo: mensaje y reintento (ya existe manejo de timeout en `provider.ts`). |
| Responsive | Pasos a pantalla completa en móvil. |
| IA | Núcleo de la pantalla, solo para usuarios registrados. |

Requisitos (decididos):

- **La IA es solo para usuarios registrados.** No hay generación anónima.
- **Sin cuenta, todo es borrador** (como las plantillas hoy, `activeTripIsDraft`): se puede ver y editar, pero **guardar exige login**.
- Tras el registro, el borrador y los datos del formulario se conservan.

---

## S3 · Hoja de acceso · S4 · Viaje compartido · S13 · Perfil

| Pantalla | Contenido | Reutiliza | Cambio |
|----------|-----------|-----------|--------|
| S3 Acceso | Email + contraseña, recuperar contraseña; mensaje de *por qué* se pide según el disparador ("Guarda tu borrador", "Pregúntale a Tachi") | `AuthModal`, `transfer_anon_data.sql` | Copy contextual según el disparador. |
| S4 Compartido | Itinerario de solo lectura, CTA "Abrir en Tachao" | `app/share/[token]` | Reusar componentes de S6 en modo lectura. |
| S13 Perfil | Cuenta (email, cerrar sesión), idioma, tema, moneda preferida (por defecto de los viajes nuevos), repetir tour, viajes compartidos conmigo (enlace a S5) | Controles hoy en la cabecera de `TripView` | Liberar la cabecera. |

---

## S12 · Recuerdos (concepto, Fase 5)

| Punto | Especificación |
|-------|----------------|
| Objetivo | Convertir lo «tachado» en una historia que quede. |
| Información | Por día: actividades completadas, mapa de lo visitado (ya existe la representación de completadas), fotos y notas del usuario, valoración. Portada del viaje. |
| Componentes | Reutiliza: `DayMapView` con filtro "Tachadas", celebraciones. Nuevo: subida de fotos y nota por actividad. |
| Requiere | **Cambio técnico decidido: entidad nueva** de recuerdos (viaje, actividad opcional, fotos, nota, valoración) con su almacenamiento. Fuera de las 3 primeras fases. |
| Acceso | Modo Recuerdo del Itinerario + tab en Viaje cuando el viaje termina. No es pestaña de la bottom nav. |
| IA | "Resume mi viaje", pie de foto sugerido. |
