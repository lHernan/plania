# 06 · Recomendaciones de sistema de diseño

**Se mantiene la identidad "light editorial" (marfil, verde bosque, DM Serif + Inter).** Lo que cambia es la estructura: un shell de app, unas pocas primitivas compartidas y la fotografía como protagonista. No se introducen dependencias.

---

## 1. Identidad

| Elemento | Mantener | Ajustar |
|----------|----------|---------|
| Paleta | Tokens actuales de `globals.css` (`--color-primary #246B57`, `--color-accent-ai #A779C5`, `--color-celebration #F2C66D`) | Eliminar colores hardcodeados (p. ej. `bg-[#246B57]` en la tira de días) a favor de tokens. |
| Tipografía | DM Serif Display para títulos de viaje/día; Inter para UI | Suelo mínimo **12 px** para texto legible; reservar 10-11 px solo para etiquetas no esenciales. Reducir el uso de MAYÚSCULAS con tracking amplio: hoy es casi todo el microcopy. |
| Color IA | Lila `accent-ai` = Tachi | Usarlo **solo** para Tachi, en todas sus entradas, para que la IA sea reconocible. Tachi es una mascota: definir avatar/ilustración propia (sustituye al icono genérico ✦ cuando exista). |
| Celebración | «¡Tachao!» en `celebration` | Sin cambios. |
| Fotografía | — | **Decidido:** set curado y licenciado para landing, plantillas y portadas por defecto; en sus propios viajes, las fotos que suba el usuario (portada y recuerdos). |

## 2. Layouts

| Layout | Uso | Estructura |
|--------|-----|------------|
| `PublicLayout` | `/`, `/plan`, `/share` | Sin bottom nav; cabecera mínima con acceso. |
| `AppShell` (route group `(app)`) | `/trips/**`, `/me` | Cabecera (selector de viaje + avatar), slot de contenido, bottom nav móvil / tabs desktop, botón Tachi. |
| `TripSectionLayout` | `/trips/[tripId]/*` | Carga el viaje por `tripId`, provee contexto (rol, modo Planificando/Hoy/Recuerdo). |

## 3. Componentes reutilizables a extraer

Prioridad según cuántas veces se repite hoy el patrón inline.

| Componente | Sustituye a | Notas |
|------------|-------------|-------|
| `BottomSheet` | Modales `motion.div` repetidos (añadir actividad, editar, Tachi, compartir, comentarios) | Arrastre para cerrar, foco atrapado, `Esc`, `aria-modal`. Desktop: variante panel lateral. |
| `TripBottomNav` / `TripTabs` | — (nuevo) | 4 ítems, icono + texto siempre visible, ítem activo con `aria-current="page"`. |
| `SegmentedTabs` | — (nuevo) | Cartera y Viaje. |
| `AppHeader` | Cabecera de `TripView` | Solo selector de viaje, avatar y (desktop) tabs. |
| `DayStrip` | Tira de días inline | Compartido por Itinerario y Mapa. |
| `Toast` | Toasts duplicados en `page.tsx` y `TripView` | Un único proveedor. |
| `EmptyState` | Mensajes vacíos dispersos | Ilustración/foto opcional + 1-2 acciones. |
| `Skeleton` | Spinners a pantalla completa | |
| `TachiButton` / `TachiChip` | Botones Tachi, "AI quick actions", `ChatFab` | Un estilo, un icono (✦ `Sparkles`), un nombre. |
| `BookingSummary` | Lectura de `BookingDetails` | Para hoja de actividad y Cartera. |
| `TripCover` | Emoji de plantillas | Foto + degradado + nombre + fechas. |

## 4. Navegación — reglas

- Máximo **4 ítems** en la bottom nav; etiquetas siempre visibles.
- Altura táctil mínima **44 × 44 px** (hoy hay botones de 28 px en la cabecera).
- Bottom nav oculta solo en visor de documento y en mapa en pantalla completa con tarjeta abierta.
- Tachi flota encima de la bottom nav a la derecha; el "+" del Itinerario queda a su izquierda (ya existe el grupo `FloatingActions`).
- `safe-area-inset-bottom` en la bottom nav (PWA en iOS).

## 5. Responsive

| Breakpoint | Comportamiento |
|------------|----------------|
| < `md` | Bottom nav, hojas inferiores, una columna. |
| `md`–`lg` | Bottom nav o tabs en cabecera (decidir en prototipo), hojas a 70 % de ancho. |
| ≥ `lg` | Tabs en cabecera; Itinerario a dos columnas con panel derecho contextual (mapa o detalle); Tachi como panel lateral. |

## 6. Accesibilidad (mínimos)

- `aria-label` en todos los botones solo-icono (hoy faltan en logout y tema).
- Contraste AA en textos `text-muted` sobre `surface-subtle` (verificar `#92968F` sobre `#F0EEE8`).
- Sustituir `alert()` de la landing por validación inline.
- `prefers-reduced-motion` ya existe (`use-reduced-motion`): respetarlo en transiciones de sección y hojas.
- Orden de foco: cabecera → tira de días → contenido → bottom nav.

## 7. Evitar

- Rejillas de tarjetas de estadísticas en Resumen: el estado de preparación es una **checklist**, no KPIs.
- Más de un nivel de tabs dentro de una sección.
- Duplicar la misma información en dos secciones (p. ej. reservas en Itinerario *y* Cartera como listas completas): el Itinerario muestra **indicadores** que llevan a Cartera, no la lista.
