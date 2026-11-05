# 08 · Decisiones y preguntas abiertas

**Estado (2026-11-04):** todas las preguntas que bloqueaban la Fase 1 están resueltas. Solo queda abierta la navegación en tablet (se valida con prototipo) y un TODO técnico (redirección en servidor).

## Decisiones tomadas

| # | Tema | Decisión | Impacto en el plan |
|---|------|----------|--------------------|
| Q1 | Nombre | **Tachao**. | UI, docs y títulos. Las claves internas `plania_*` solo se renombran si se migran las preferencias guardadas. |
| Q2 | Sección de reservas + documentos | **Cartera**. | S9. |
| Q3 | Navegación por viaje | **Rutas anidadas** `/trips/[tripId]/{map,wallet,overview}`. | Fase 1. |
| Q4 | Guardado sin cuenta | **Borrador que exige login para guardar** (como las plantillas hoy). Se extiende a "Crear desde cero", que hoy guarda en la sesión anónima. | F1, S2, Fase 3. |
| Q5 | Mapa para invitados | **Visible en solo lectura**, para que el invitado vea las funcionalidades. Mismo criterio para todas las secciones. Los borradores sin cuenta siguen editables (Q4). | S8, Fase 1. |
| Q6 | Fotografía | **Set curado y licenciado** para landing, plantillas y portadas por defecto; **fotos subidas por el usuario** en sus propios viajes. | S1, S10, Fases 3-4. |
| Q7 | Recuerdos | **Entidad nueva** (no extender `activity_files`). | S12, Fase 5. |
| Q8 | Maleta | **La elige el usuario:** personal o compartida con las personas del viaje. | S10, Fase 4. |
| Q9 | Nombre de la IA | **Tachi**, mascota de IA de Tachao: "¡Pregúntale a Tachi!". Day Genius pasa a ser la acción "Reorganizar el día" y el agente de viaje, la conversación con Tachi. | S11, Fase 3 (avatar e ilustraciones). |
| Q11 | Moneda | **Moneda única por viaje, elegida por el usuario** (p. ej. Budapest en EUR; un usuario de UK puede elegir GBP). | Fase 4 (campo nuevo). |
| Q12 | Viajes sin fechas | **Planificar con nº de días** ("Día 1…N") y fijar inicio y fin después, para activar calendario y seguimiento en vivo. Grupo "En planificación" en Mis viajes. | S5, S10, Fase 4 (cambio de modelo: hoy `trip_days.date` es obligatorio). |
| Q14 | IA para visitantes | **No: IA solo para usuarios registrados.** El visitante ve a Tachi y el botón lleva al registro. | S2, S11, Fase 3. Hoy solo `api/day-genius` y `api/shopping-assistant` rechazan anónimos en servidor. |
| Q16 | Moneda por defecto | **La del perfil del usuario**, editable en cada viaje. | S13 (preferencia de moneda), Fase 4. |

## Abiertas

| # | Pregunta | Cómo se resuelve | Bloquea |
|---|----------|------------------|---------|
| Q10 | ¿Navegación en tablet (`md`–`lg`): bottom nav o tabs en cabecera? | Validar con prototipo. | Diseño de la Fase 1 |
| Q13 | ¿Mover la redirección inicial al servidor (`proxy.ts`)? | **TODO:** evaluar después de la Fase 2 (requiere sesión en cookies). Registrado en `07-IMPLEMENTATION_ROADMAP.md`. | — |
| Q15 | En la maleta compartida, ¿cada viajero puede tener además ítems privados? | Decidir al diseñar la Fase 4. | Fase 4 |

---

## Recomendación ejecutiva

**Arquitectura óptima para Tachao:**

- **Global:** selector de viaje en la cabecera (→ Mis viajes) y avatar (→ Perfil). Nada más.
- **Dentro del viaje, cuatro secciones** con rutas anidadas: **Itinerario** (por defecto, con modos Planificando / Hoy / Recuerdo) · **Mapa** · **Cartera** (reservas + documentos) · **Viaje** (resumen, preparación, maleta, compras, herramientas).
- **Móvil:** bottom nav de 4 ítems, hojas inferiores para todo lo contextual (actividad, documento, Tachi), "+" solo en Itinerario.
- **Tachi:** la mascota y única cara de la IA. Un botón persistente que abre con el contexto de la pantalla y siempre propone antes de aplicar. Absorbe el chat, la reorganización del día y las importaciones. Solo para usuarios registrados.
- **Sin cuenta:** se explora y se prepara un borrador; guardar y Tachi piden registro.
- **Recuerdos:** no es una pestaña; es el modo final del viaje (Fase 5, entidad nueva).

**Primeras tres fases:**

1. **Shell y secciones del viaje:** URL por viaje, bottom nav, Cartera y Viaje armadas con los componentes actuales, todo visible en solo lectura para invitados. Sin migraciones.
2. **Varios viajes, global y modos:** Mis viajes, Perfil, modo Hoy con "Ahora/Siguiente", estado de preparación.
3. **Tachi unificado y entrada pública:** una sola IA contextual con mascota, landing con fotografía curada, planificador con borrador sin cuenta y generación con Tachi tras el registro.
