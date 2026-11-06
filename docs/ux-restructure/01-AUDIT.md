# 01 · Auditoría del estado actual

> Fecha: 2026-11-04 · Rama observada: `feat/schedule-notes-collapsed` (`58d073f`) · Alcance: solo lectura del repositorio.

**Conclusión en una línea:** Tachao ya tiene un producto rico en funcionalidades, pero casi todo vive dentro de una sola pantalla (`TripView`, 2357 líneas) sin rutas por viaje ni navegación por secciones. El problema no es lo que falta: es dónde está lo que ya existe.

---

## 1. Tecnología verificada

| Área | Tecnología | Evidencia |
|------|-----------|-----------|
| Framework | Next.js 16.2.3 (App Router), React 19.2.4, TypeScript 5 | `package.json` |
| Estilos | Tailwind CSS 4 + tokens CSS en `:root` / `.dark` | `src/app/globals.css` |
| Tipografía | DM Serif Display (títulos) + Inter (cuerpo) | `src/app/layout.tsx` |
| Estado | Zustand (itinerario, auth, chat, offline) con persistencia local | `src/store/*` |
| Animación | Framer Motion | componentes varios |
| Drag & drop | dnd-kit | `TripView`, `SortableActivityCard` |
| Mapas | Leaflet + react-leaflet + teselas OSM; geocodificación Geoapify | `DayMapView.tsx`, `api/geocode` |
| PDF / códigos | pdfjs-dist, @zxing/library (QR y códigos de barras en el dispositivo) | `lib/pdf`, `lib/documents` |
| Backend | Route Handlers en `src/app/api/*` | 23 rutas |
| Persistencia | Supabase Auth + Postgres + Storage (`activity-files`) | `lib/supabase*.ts`, `lib/*.sql` |
| IA | Proveedor compatible OpenAI configurable con fallback y modelo rápido (`AI_API_URL`, `AI_FALLBACK_*`) | `lib/ai/provider.ts` |
| Clima / divisas | Open-Meteo (`api/weather`), `api/currency` | rutas API |
| Email | Supabase Edge Function `notify-trip-share` | `supabase/functions` |
| PWA / offline | `manifest.webmanifest`, `sw.js`, caché de documentos offline, cola de mutaciones pendientes | `public/`, `lib/offline-*.ts` |
| i18n | Español / inglés con diccionarios JSON propios | `src/i18n/locales` |
| Tests | Vitest + Testing Library (68 ficheros en `src/__tests__`) | `vitest.config.ts` |

> **Nota de naming:** el código, el README y `localStorage` usan **Plania** (`plania_theme`); la interfaz y los metadatos usan **Tachao**. Ver `08-OPEN_QUESTIONS.md`.

---

## 2. Rutas y layouts

```text
src/app/
  layout.tsx            Root layout: I18nProvider, PlatformTheme, AuthInitializer, OfflineStatus, PwaRegister
  page.tsx              "/"        Landing + creación rápida + plantillas
  trips/page.tsx        "/trips"   Renderiza <TripView/> (el viaje ACTIVO del store)
  share/[token]/page    "/share/x" Vista pública de solo lectura de un viaje compartido
  api/...               23 Route Handlers
```

Hallazgos estructurales:

| # | Hallazgo | Consecuencia |
|---|----------|--------------|
| R1 | **No hay id de viaje en la URL.** `/trips` muestra `activeTrip` del store. | No se puede enlazar, recargar ni abrir dos viajes en pestañas; el botón "Atrás" no navega entre viajes. |
| R2 | **Un solo layout** (root). No hay layout de aplicación ni route groups. | Cabecera, navegación y overlays se reimplementan dentro de `TripView`. |
| R3 | La redirección es **cliente**: `AuthInitializer` empuja `/ → /trips` si hay viaje activo y `/trips → /` si no hay. | Parpadeo de carga; la decisión de "pantalla inicial" está acoplada a un efecto de React. No existe `proxy.ts`. |
| R4 | Sin pantallas para: Mis viajes, Perfil, Documentos, Reservas, Recuerdos. | Todo se resuelve con modales o paneles laterales. |

---

## 3. Inventario de funcionalidades

Estado: ✅ terminada · 🟡 parcial · 💭 concepto (no existe código)

| Funcionalidad | Estado | Dónde vive hoy | Observaciones |
|---------------|--------|----------------|---------------|
| Itinerario por días (tira de días, timeline, reordenar, duplicar, mover) | ✅ | `TripView`, `SortableActivityCard` | Corazón del producto. Funciona bien. |
| Estados de actividad (pendiente, completada, saltada, retrasada) | ✅ | store `updateActivityState` | |
| «¡Tachao!» y celebraciones (actividad, día, viaje) | ✅ | `CelebrationOverlay`, `lib/trip-progress.ts` | Tres niveles; tour también celebra. |
| Day Genius (reorganizar el día con hora actual, distancias, clima) | ✅ | `DayGeniusModal`, `api/day-genius`, `lib/day-genius/*` | Se abre desde 2 sitios (barra del día y sidebar). |
| Agente de viaje (chat que aplica acciones al itinerario) | ✅ | `ChatFab`, `ChatPanel`, `api/chat`, tabla `trip_messages` | Acciones: añadir/editar/reordenar actividades, añadir reserva. Es **otra** IA distinta de Day Genius. |
| Sugerencias de horario heurísticas | ✅ | `lib/ai/optimizer.ts`, `ScheduleSuggestions` | Sin LLM. |
| Importar texto libre al timeline (y dictado por voz) | ✅ | sidebar "AI quick actions", `api/import`, `use-voice-dictation` | |
| Importar reservas desde PDF (revisión, duplicados, agrupación de pasajeros) | ✅ | `BookingImportModal`, `lib/bookings/*`, `api/bookings/extract` | Crea actividades `origin: "booking"` con `booking` JSONB. |
| Documentos/adjuntos por actividad (visor multipágina, zoom, "mostrar código", offline) | ✅ | `ActivityFilesSection`, `DocumentViewer`, tabla `activity_files` | Solo accesibles **desde la actividad**. No hay vista de documentos del viaje. |
| Reservas críticas ("reservar antes de") con urgencia | ✅ | `CriticalReservationsPanel`, tabla `critical_reservations` | Concepto distinto de las reservas importadas (ver P6). |
| Mapa del día (marcadores, completadas, filtros, ruta, tarjeta contextual) | ✅ | `DayMapView` | Mapa **por día**; no existe mapa del viaje completo. Desktop: sustituye al sidebar. Móvil: overlay a pantalla completa. |
| Lugares cercanos / búsqueda de tiendas | ✅ | `api/places/nearby`, `lib/shopping/*` | Usado por la lista de compras. |
| Lista de compras con sugerencias por ciudad | ✅ | `ShoppingListPanel`, tabla `shopping_items` | Sincroniza entre viajeros. |
| Maleta (lista de equipaje generada por IA + clima) | 🟡 | `PackingListCard`, `api/packing-list` | Se guarda **solo en `localStorage`**: no se comparte ni sobrevive a otro dispositivo. |
| Contexto del viaje (viajeros, equipaje, llegada, hotel, preferencias) | ✅ | `TravelContextEditor`, `trips.travel_context` JSONB | Alimenta IA y Arrival. |
| Asistente de llegada (comparar traslados) | ✅ | `ArrivalAssistant`, `HotelCheckInRouteOptions` | |
| Herramientas de viaje (pagos por ciudad, conversor, emergencias) | ✅ | colapsable "Travel tools" en sidebar | Datos verificados para un número limitado de ciudades. |
| Presupuesto | 🟡 | tarjeta "Budget" en sidebar | Solo suma `expectedCost`; existe columna `actual_cost` sin UI. Moneda única. |
| Compartir viaje (email, enlace, roles viewer/editor, comentarios por actividad) | ✅ | `ShareTripModal`, `ActivityCommentsModal`, `/share/[token]` | |
| Varios viajes (cambiar, favorito, borrar, crear, compartidos conmigo) | ✅ | `TripSwitcher` (desplegable) | Selección automática del viaje: favorito → en curso → próximo → último pasado (`lib/trip-selection.ts`). |
| Plantillas de ejemplo | ✅ | `lib/trip-templates.ts`, landing | Portada con **emoji**, sin fotografía. |
| Usuario anónimo | ✅ | `signInAnonymously` en `use-auth-store`; `transfer_anon_data.sql` | Un visitante ya tiene sesión anónima y puede crear viajes; el borrador de plantilla exige registro para guardarse. |
| Tour guiado | ✅ | `ProductTour`, `lib/tour/steps.ts` | 12 pasos anclados a `data-tour`. |
| Offline | ✅ | `OfflineStatus`, `use-offline-store`, caché de documentos | |
| Modo oscuro / idioma | ✅ | botones en cabecera de `TripView` | Preferencias de app mezcladas con controles del viaje. |
| Planificador IA "desde cero" (destino + fechas → itinerario) | 🟡 | `api/import` con `planning-prompt` | Existe el motor de planificación de viaje completo, pero **no hay una entrada de usuario dedicada** en la landing. |
| Resumen del viaje / estado de preparación | 💭 | — | Los datos existen dispersos (fechas, viajeros, presupuesto, reservas pendientes, maleta). |
| Recuerdos (fotos, diario, historia del viaje) | 💭 | — | Solo existe el "rastro" de actividades completadas en el mapa. `docs/ROADMAP.md` lo lista como "Trip Timeline / Journal — Planned". |
| Perfil y configuración | 💭 | — | Solo logout, tema e idioma en la cabecera. |
| Notificaciones push | 💭 | — | En roadmap. |

---

## 4. Modelo de datos relevante (verificado)

```text
trips (id, name, start_date, end_date, is_favorite, travel_context JSONB, user_id, created_at)
 ├─ trip_days (id, date, city, label)
 │   └─ activities (title, time, duration, category, priority, state, location, lat/lon,
 │                  origin manual|booking|suggested, booking JSONB, expected_cost, actual_cost)
 │       ├─ activity_files (file_url, file_path, file_type, focus_area JSONB)  → bucket activity-files
 │       └─ activity_comments
 ├─ critical_reservations (title, booking_deadline, reservation_date, status, price)
 ├─ shopping_items
 ├─ trip_messages (+ trip_chat_rate_limits)
 ├─ trip_shares (user, role)
 └─ trip_share_links (token, role, email, expires/revoked/accepted)
```

Implicaciones para la reestructuración:

- **Reservas** = actividades con `origin = "booking"` (agrupadas por `booking.groupId`) **+** `critical_reservations`. Se puede construir una vista de reservas **sin tocar el modelo**.
- **Documentos** = `activity_files` de todas las actividades del viaje. Una vista de documentos del viaje es **derivable en cliente** desde `activeTrip.days[].activities[].files`.
- **Lugares** no son entidad: son `location`/`lat`/`lon` de una actividad. No existen "lugares guardados".
- **Destinos** no son entidad: son `trip_days.city`.
- **Recuerdos** no tienen soporte de datos: requerirán tabla y almacenamiento nuevos (cambio técnico explícito, fuera de esta fase).

---

## 5. Sistema visual

- Paleta "light editorial": fondo marfil `#F5F3EE`, superficie blanca, primario verde bosque `#246B57`, acento IA lila `#A779C5`, celebración `#F2C66D`. Dark mode por clase.
- Primitivas mínimas: `ui/button.tsx`, `ui/card.tsx`. El resto son clases Tailwind inline repetidas (botones píldora, modales con `motion.div`, toasts) en cada componente.
- Tipografía de microcopys muy pequeña: abundan `text-[7px]`, `text-[8px]`, `text-[9px]`, `text-[10px]` en mayúsculas con tracking amplio.
- Sin fotografía en ningún punto de la app. Plantillas con emoji; landing con "blobs" difuminados.

---

## 6. Evaluación UX/UI — problemas reales

Ordenados por impacto en el uso durante el viaje (criterio 5 del brief).

| # | Problema | Evidencia | Impacto |
|---|----------|-----------|---------|
| P1 | **En móvil todo lo que no es timeline queda al fondo del scroll.** El `<aside>` (IA, reservas críticas, compras, presupuesto, herramientas) se apila debajo de la lista de actividades en una sola columna. | `TripView` grid `grid-cols-1 lg:grid-cols-[1fr_340px]` | Alto. Reservas y herramientas son casi indescubribles en el uso real (móvil). |
| P2 | **Cabecera sobrecargada y mezclada.** Selector de viaje, ayuda, tema, idioma, compartir, avatar y logout comparten 56 px. Preferencias globales (tema, idioma, sesión) conviven con acciones del viaje. | `TripView` L1318-1424 | Medio-alto. Ruido visual; en móvil compartir se oculta (`hidden sm:flex`). |
| P3 | **IA fragmentada en 5 puntos de entrada con nombres distintos:** Day Genius (barra del día), "AI quick actions" (sidebar), agente de viaje (FAB de chat), importar reservas, importar notas/voz. | `TripView`, `FloatingActions`, `ChatFab` | Alto. El usuario no sabe a qué "IA" pedirle qué. El chat es un asistente aislado, justo lo que el brief quiere evitar. |
| P4 | **No hay URL por viaje ni por sección** (R1). | `app/trips/page.tsx` | Alto para escalar: imposible enlazar un documento o una reserva, y "Atrás" en móvil sale de la app. |
| P5 | **Documentos solo accesibles desde su actividad.** Para enseñar la tarjeta de embarque hay que recordar en qué día está el vuelo, ir a ese día, abrir la actividad. | `ActivityFilesSection` dentro de `ActivityEditModal` | Alto en el aeropuerto/hotel. |
| P6 | **Dos conceptos de "reserva" sin relación visible:** reservas importadas (actividades `booking`) y "reservas críticas" (pendientes de reservar). | `CriticalReservationsPanel` vs `OriginBadge` | Medio. Confusión de vocabulario. |
| P7 | **El mapa es solo del día** y en móvil es un overlay modal. No existe vista geográfica del viaje. | `DayMapView` | Medio. |
| P8 | **Invitados no pueden abrir el mapa.** El botón de mapa está dentro del bloque `!isInvitee`. | `TripView` L1525-1550 | Medio. Probable bug de permisos de UI (ver Open Questions). |
| P9 | **La landing no comunica la propuesta de valor ni ofrece el planificador IA.** Solo "Crear desde cero" (nombre + fechas) y plantillas con emoji. Copy genérico ("precisión de IA"). | `app/page.tsx`, `es.json` `landing_*` | Alto para conversión. |
| P10 | **Sin "Mis viajes" como pantalla:** gestionar varios viajes depende de un desplegable. No se diferencia en planificación / próximo / en curso / pasado, aunque `trip-selection.ts` ya calcula `active | upcoming | past`. | `TripSwitcher` | Medio. |
| P11 | **Maleta no persistida en servidor.** | `PackingListCard` (`localStorage`) | Medio: se pierde al cambiar de dispositivo, no se comparte. |
| P12 | **Accesibilidad:** textos de 7-10 px, botones de 28 px (`size-7`) en la cabecera por debajo de 44 px, iconos sin `aria-label` (logout, tema), `alert()` en la landing, "días" hardcodeado en tarjetas de plantilla. | `TripView`, `page.tsx` | Medio. |
| P13 | **`TripView` monolítico** (≈2400 líneas, ~50 `useState`). | `TripView.tsx` | Alto como riesgo técnico: cualquier cambio de navegación lo atraviesa. |

Lo que **funciona y debe conservarse**:

- Aterrizar directo en el itinerario del viaje relevante (selección automática ya resuelta en `trip-selection.ts`).
- Tira de días + timeline con drag & drop + «¡Tachao!».
- Barra de resumen del día con acciones contextuales (Añadir, Day Genius, Mapa).
- Tarjeta contextual en el mapa sincronizada con la lista.
- Visor de documentos con "mostrar código" y caché offline.
- Revisión antes de crear actividades desde PDF (la IA propone, el usuario confirma).
