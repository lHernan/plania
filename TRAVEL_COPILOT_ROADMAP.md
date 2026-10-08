# Travel Copilot - Auditoria y Roadmap

Fecha de auditoria: 2026-10-08  
Repositorio: `D:\Dev\repos\plania`  
Estado: Fase 1 (Trip Context Engine) en curso

## 1. Objetivo y alcance

Evolucionar Plania desde planificador de itinerarios hacia un copiloto que ayude a tomar decisiones antes y durante el viaje, explicando por que recomienda una opcion y diferenciando datos confirmados, datos de fuente, estimaciones y razonamiento de IA.

El primer objetivo es un piloto util para el viaje que comienza el 15 de noviembre de 2026. El tiempo disponible hace inviable implementar literalmente todas las funcionalidades P0 originales; este documento recorta el alcance para privilegiar una decision real y fiable sobre cantidad de funcionalidades.

## 2. Arquitectura actual observada

### Cliente

- Next.js 16.2.3 App Router, React 19.2.4, TypeScript 5 y Tailwind CSS 4 (`package.json`).
- UI mobile-first; vistas principales en `src/app/page.tsx`, `src/app/trips/page.tsx` y `src/components/TripView.tsx`.
- Zustand concentra estado de viaje, autenticacion, chat y conectividad en `src/store/`.

### Servidor y persistencia

- Route Handlers Next.js en `src/app/api/`.
- Supabase Auth/Postgres/Storage; el cliente de servidor de `src/lib/supabase-server.ts` acepta bearer token y ofrece un helper administrativo de service role.
- RLS se usa en migraciones de comparticion, archivos y chat. Los SQL incluidos son migraciones incrementales: el repositorio no contiene un esquema base suficiente para reproducir todo el entorno.
- Hay proveedor externo de IA y Geoapify para lugares cercanos. No se observo proveedor Google Maps conectado para routing/transporte, vuelos o clima; se agregaron Maps URLs directas para los tres modos Arrival.

### Modelo de dominio existente

`src/lib/types.ts` define `TripPlan`, `TripDay`, `Activity`, `CriticalReservation`, compras, archivos, `TravelContext` y `ArrivalOption`. Las opciones Arrival se guardan dentro del JSONB de contexto para el MVP; no hay modelos normalizados para `Flight`, `Hotel`, `TransportLeg`, `Ticket`, `Budget` o guias de pago.

### Capacidades existentes a reutilizar

- Crear/seleccionar viajes, gestionar dias, actividades, estados, orden y reservas criticas.
- Importar texto de itinerario con parser/IA (`src/lib/import/parse-itinerary.ts`, `src/app/api/import/route.ts`).
- Day Genius y optimizador heuristico para solapamientos/ventanas ajustadas (`src/lib/services/day-genius.ts`, `src/lib/ai/optimizer.ts`).
- Asistente de compras y busqueda opcional de lugares (`src/lib/shopping-assistant.ts`, `/api/places/nearby`).
- Auth y viajes compartidos (`src/store/use-auth-store.ts`, rutas `/api/trips/*`).
- Documentos/imagenes por actividad, vista previa y deteccion de QR (`WalletPreviewModal.tsx`).
- Cache de viaje/cola local y descarga offline de documentos (`offline-state.ts`, `offline-documents.ts`, `public/sw.js`).
- Trabajo local no confirmado de proveedor IA compartido, contexto acotado y chat persistido (`src/lib/ai/*`, `/api/chat`, `ChatPanel.tsx`, `use-chat-store.ts`). En esta sesion el chat se dejo deliberadamente en modo solo lectura hasta soportar confirmacion segura.

## 3. Estado del repositorio y evidencia

En la inspeccion, `main` estaba alineado con `origin/main`, pero el working tree contenia cambios sin commit. Modificados: `package.json`, `package-lock.json`, `src/__tests__/trip-shares.test.ts`, `src/app/api/import/route.ts`, `src/components/TripView.tsx`, traducciones EN/ES, `gemini-service.ts`, `types.ts` y `use-itinerary-store.ts`. Nuevos: suite AI, ruta chat, componentes chat, `src/lib/ai/*`, migracion chat, store chat y configuracion Vitest.

Estos cambios forman parte del estado local que debe preservarse. No deben tratarse como desplegados, aplicados a Supabase o probados hasta verificarlo.

### Hallazgos que condicionan la siguiente fase

- El `TripContext` de IA ya recibe el perfil versionado solo con opt-in; no incluye procedencia de hechos dinamicos ni integraciones de rutas/precios.
- `/api/chat` autentica y comprueba acceso al viaje. En el estado inicial el cliente aplicaba acciones inmediatamente; esta sesion lo puso en modo solo lectura hasta disenar aceptacion explicita.
- La hora del chat usa zona destino solo con opt-in; sin opt-in se serializa el fallback UTC y no la zona privada.
- `dayGeniusService.optimizeDay` normaliza/fusiona y reconstruye actividades; el store reemplaza el dia optimizado. No usar para escrituras automaticas en un itinerario real hasta tener preview, preservacion de campos y pruebas.
- `/api/optimize-day`, `/api/import`, `/api/detect-codes` y `/api/places/nearby` deben revisarse para autenticacion/abuso/tamano antes de aumentar uso de servicios con coste.
- `chat_migration.sql` declara columnas de contexto futuro y tabla de mensajes, pero el estado remoto y el orden de migraciones no se verificaron.
- `activity_files_setup.sql` configura bucket privado/politicas por propietario mientras codigo cercano usa URLs publicas; acceso compartido y offline real requieren prueba.
- La cola offline para crear viaje y dias debe probarse; el service worker no cachea el shell de la aplicacion.
- El historial ahora pide 50 mensajes descendentes y los revierte a cronologico. La migracion local revoca a clientes inserts/updates/deletes y deja mensajes server-authored; define RPC de 12 mensajes por usuario/viaje cada 5 minutos antes de cargar el itinerario. El RPC falla cerrado en la ruta si falta.
- Las suites visibles son limitadas a comparticion y utilidades de IA; no cubren extremo a extremo chat, RLS, Day Genius, offline o Storage.

No se accedio a Supabase remoto ni se leyo `.env.local`. Por ello no se hacen afirmaciones sobre migraciones aplicadas, secretos/configuracion, despliegue o datos reales del viaje.

## 4. Decisiones de arquitectura para el producto

1. **Agenda canonica:** conservar `TripPlan`/`TripDay`/`Activity`/`CriticalReservation` como agenda; evitar una segunda agenda paralela.
2. **Contexto incremental:** introducir solo campos necesarios para el primer caso: viajeros/cantidad, equipaje, llegada (lugar, fecha/hora local y zona), hotel (ubicacion/check-in/out) y preferencias. Edad detallada y entidades independientes de cada pasajero esperan un caso real.
3. **Persistencia:** perfil `travel_context` JSONB versionado para el MVP, con migracion aditiva. Verificar esquema, ownership y RLS reales; normalizar entidades solo cuando haya consultas/integraciones que lo justifiquen.
4. **Fuentes vs razonamiento:** APIs/proveedores son fuente de hechos vivos; base de datos conserva contexto del viaje; reglas deterministas calculan precios de grupo/ventanas; LLM resume y explica, no memoriza tarifas, horarios ni politicas.
5. **Procedencia:** cada dato variable debe llevar tipo (confirmado, fuente, estimado), fuente y consulta/actualizacion. Si falta fuente, mostrar limitacion explicita.
6. **Mutaciones:** herramientas de IA producen propuesta tipada; UI muestra antes/despues y pide aceptar. No alterar reservas confirmadas ni borrar datos existentes automaticamente.
7. **Integraciones:** para el viaje piloto permitir opciones de transporte introducidas/verificadas manualmente. Integrar routing en vivo solo despues de elegir proveedor, cobertura, coste, atribucion y comportamiento ante fallos.
8. **Privacidad del contexto:** sigue las politicas de lectura de viajes compartidos (invitados pueden leer; propietario edita), con aviso en UI. `shareWithAI` es opt-in y falso por defecto; sin consentimiento, el payload enviado al proveedor excluye el perfil.

## 5. Nuevos modelos, interfaces y APIs candidatos

### Datos

- `TripContextV1`: datos de grupo, preferencias, llegada y alojamiento minimos para el viaje piloto.
- `TransportOption`: modo, coste (por persona o grupo), moneda, duracion/rango, transbordos/caminata si se conocen, requisitos de pago/ticket, comodidad y datos de equipaje/grupo.
- `FactProvenance`: clasificacion, fuente, consultado/actualizado en y caducidad opcional. Aplicar inicialmente solo a guia de pagos y opciones de traslado; no redisenar toda la base.
- `Recommendation`: tipo, opcion elegida, razon verificable, alternativas, coste individual/total, tiempos, procedencia y limitaciones.

No crear ahora una base global de `Country/City/TransportSystem` ni todos los modelos del objetivo a largo plazo. Para el piloto, una guia versionada de la ciudad real puede ser contenido controlado con sus fuentes.

### Endpoints / limites

- La ruta chat local existente `/api/chat` es reutilizable tras confirmar su seguridad, consentimiento y limites.
- Si el cliente no puede actualizar directamente el contexto respetando RLS, considerar `GET/PATCH /api/trips/[tripId]/context`; no crear rutas espejo sin necesidad.
- El calculador de grupo/check-in debe ser logica pura probada, no necesariamente un endpoint. Solo una integracion de datos externos requiere una ruta de servidor dedicada.
- Mantener autorizacion de propietario/compartido en server side y RLS; limitar tamano, frecuencia y coste de endpoints IA/proveedor.

## 6. Roadmap incremental

### Fase 0 - Auditoria de arquitectura (COMPLETADA)

**Trabajo:** documentar sistema existente; preservar diff local de IA/chat; ejecutar baseline y dejar riesgos/gates identificados. La inspeccion remota de Supabase queda fuera de la auditoria local.

**Baseline inicial ejecutado el 2026-10-08:** `npm test` PASS (11 tests/2 archivos); `npx tsc --noEmit --incremental false` PASS; `npm run build` PASS; `npm run lint` FAIL (33 errores/1644 warnings). No se hizo comparacion con `HEAD`, asi que no se atribuyen los errores a los cambios locales.

**Criterio de salida:** arquitectura y capacidades actuales documentadas, MVP recortado, baseline local conocido y riesgos priorizados. Resultado: completado; la deuda de lint y la falta de acceso al esquema remoto se mantienen como gates concretos para las fases que los necesiten.

### Fase 1 - Trip Context Engine minimo (P0, COMPLETADA PARA OWNER-PATH)

**Trabajo:** modelo/contexto versionado y validado para cantidad de viajeros, equipaje, llegada, alojamiento, timezone y preferencias esenciales; integrarlo con contexto AI y UI compacta.

**Dependencias:** Fase 0; confirmar esquema/RLS/migracion.

**Implementado en el primer corte:** `TravelContext` v1, parser de runtime, editor bilingue, persistencia propietaria en `trips.travel_context`, cache de viaje y serializacion opcional en contexto de chat; `src/lib/travel_context_migration.sql` es aditiva y nullable. Tests validan limites, fechas/horas/timezone, fallback UTC y consentimiento IA. Si no hay opt-in, no se serializa perfil ni zona destino. El formulario permite vaciar campos; el reloj usa zona autorizada o fallback UTC explicito.

**Validacion reportada:** el usuario informa que ejecuto la migracion de Trip Context y probo guardado/lectura como propietario; reporta que funciona en teoria. No se verifico de manera independiente el entorno remoto ni se confirmo que la migracion del chat tambien este aplicada.

**Pendiente antes del piloto:** validar permisos de invitado y lectura offline; revisar cache sensible en logout. Se acepta el recorrido del propietario como suficiente para iniciar la fase siguiente.

**Criterio de salida:** crear/editar/recargar contexto, aislamiento entre viajes/usuarios, fechas locales correctas y pruebas de datos incompletos/migracion.

### Fase 2 - Arrival Assistant + Group Transport + Check-in (P0, IMPLEMENTADO LOCALMENTE; VALIDACION MANUAL PENDIENTE)

**Implementado:** Arrival Assistant filtra check-ins de hotel al dia seleccionado y vuelve a calcular al cambiar de dia; si ese dia no tiene check-in, no muestra rutas de otros dias. Cada check-in tiene enlaces Google Maps para caminar, transporte publico y driving/Ride. El origen se deriva de la ultima actividad con ubicacion del mismo dia, hotel previo o llegada inicial; si falta, se puede elegir geolocalizacion tras un gesto o escribir una ubicacion temporal que no se persiste. El hotel se identifica con actividad o perfil. Cotizaciones opcionales para comparar dentro de Plania se guardan en el JSONB existente; no se crea otra tabla/migracion.

El comparador calcula coste por persona y total; precio por vehiculo usa capacidad de plazas/equipaje para calcular cantidad de coches. Pondera coste/duracion y, si todas las alternativas incluyen esos datos, comfort/caminata/transbordos; las preferencias de viaje cambian pesos. Muestra criterios y trade-off. Rechaza recomendaciones en moneda mixta o con datos esenciales ausentes.

El estimador de check-in convierte la llegada local a un instante usando timezone IANA; estima llegada tras duracion e incluye cruce de medianoche. Reutiliza primero una actividad `hotel` titulada explicitamente como check-in en la fecha de llegada, y usa `travel_context.hotel.checkIn` como fallback. No interpreta titulos combinados como `Traslado + Check-in` como politica de check-in y no produce resultado para hora DST invalida/ambigua.

**Validacion automatizada:** tests para grupos de 1/2/5/6, equipaje/capacidad, divisas mezcladas y precision fraccionaria, pesos/preferencias, datos faltantes, check-in/destino desde actividad, origen por hotel previo, filtro estricto por dia seleccionado, llegada antes/despues, cruce de medianoche, DST y links Google Maps. 60 tests, typecheck y build pasan; lint focalizado sin errores (1 warning no relacionado en el store).

**Pendiente antes de cerrar el minimo:** probar los tres enlaces en navegador movil con origen/destino del viaje y verificar disponibilidad local de Ride. Guardar/recargar cotizaciones y probar permisos es necesario solo si se usara el comparador/recomendador dentro de Plania.

Los Maps URLs llevan origen, destino y modo y delegan la ruta a Google Maps; los resultados no se ingieren de vuelta a Plania. Para Ride se abre driving y el viajero selecciona Ride en Google Maps; la app puede listar taxi/ride providers y precios solo en regiones compatibles. La Routes API documenta rutas WALK/TRANSIT y transitFare cuando hay tarifa para todos los pasos, pero no ofrece tarifa Uber/Cabify. No hay API key consumida por el codigo actual ni se leyo `.env.local`.

### Fase 3 - Guia de pagos de una ciudad (P0 acotado)

**Trabajo:** cubrir unicamente los modos de transporte que realmente usara el viajero. Cada instruccion con fuente y fecha de verificacion; mantener lenguaje claro para incertidumbre.

**Dependencias:** ciudad y opciones reales del piloto conocidas.

**Criterio de salida:** preguntas frecuentes respondidas desde contenido documentado, sin claims inventados por el modelo.

### Fase 4 - Day Genius contextual + chat (P0)

**Trabajo:** respuesta a "que hago ahora" considerando hora local, proxima actividad/reserva, tiempo disponible y preferencias; chat usa contexto y herramientas especializadas ya disponibles; propuestas de cambios en preview con aceptar/descartar.

**Dependencias:** Fase 0/1; integrar solo tras corregir riesgo de escritura automatica y verificar persistencia/RLS.

**Criterio de salida:** responde usando datos del viaje; declara informacion ausente; ninguna mutacion sin consentimiento; pruebas de propietarios, compartidos, errores del proveedor y sesion expirada.

### Fase 5 - Preparacion y piloto (antes del 15-11-2026)

**Trabajo:** test manual movil y desktop, perdida/recuperacion de red, cache de viaje/documentos, datos reales, fuentes, zona horaria, regresion. Congelar features objetivo 08-11-2026 y reservar la semana previa a arreglos.

**Criterio de salida:** el usuario puede contestar con Plania las decisiones objetivo: opciones de llegada para el grupo, coste total, hora de check-in, pago segun fuente, siguiente actividad y solicitud de cambio revisable.

## 7. Posterior al piloto

- P1: comparacion de vuelos con coste total de viaje, replanificacion con diff/aceptacion y briefing determinista.
- P2: guardian solo con fuentes de retrasos fiables; offline avanzado y presupuesto basado en costes reales.
- Posponer monetizacion hasta medir utilidad y repeticion. No bloquear documentos, itinerario ni otras funciones basicas criticas.

Fuera del alcance previo al viaje: datos vivos de vuelos/transporte/clima, recomendaciones multi-pais, alertas automatizadas, replanificacion completa, presupuesto predictivo, analytics sofisticados y paywall.

Referencias oficiales de Google: [Maps URLs](https://developers.google.com/maps/documentation/urls/get-started), [Routes API transit routes](https://developers.google.com/maps/documentation/routes/transit-route), [Google Maps ride/taxi directions](https://support.google.com/maps/answer/144339?hl=en).

## 8. Riesgos y mitigaciones

| Riesgo | Mitigacion / gate |
|---|---|
| Cambios de chat locales no probados | Ejecutar suite/typecheck/lint y revisar diff; no asumir despliegue. |
| Cambios del chat sin confirmacion | Mitigado temporalmente: assistant es read-only y cliente no ejecuta acciones; implementar propuesta/aceptacion antes de reactivar. |
| Invitado puede inyectar mensajes con rol assistant | SQL local ahora restringe inserts cliente a `role='user'` y el server escribe assistant con service role; aplicar y verificar migracion/RLS. |
| Solicitudes autenticadas repetidas generan gasto de IA | RPC local limita 12 mensajes por usuario/viaje cada 5 minutos; aplicar/probar y complementar con cuotas/alertas del proveedor. |
| Datos de hotel/llegada salen al proveedor o quedan en cache local | Opt-in AI (implementado), avisar alcance de compartir; revisar cache IndexedDB al logout antes del piloto. |
| Contexto/hora equivocados por falta de timezone | Guardar zona del destino y probar limites de fecha/DST; usar hora local en respuestas. |
| Esquema remoto diverge de SQL local | Verificar esquema y migraciones con acceso autorizado antes de disenar escrituras. |
| Modelo inventa precios/horarios o politica | Solo hechos de fuentes; marcar estimaciones y permitir "no lo se". |
| Recomendacion de grupo optimiza solo por precio | Score local pondera coste/tiempo y atributos introducidos; plazas/equipaje cuentan para el precio por vehiculo; exponer razon/trade-off. |
| Precio, politica o horario manual se queda obsoleto | Exponer fuente y fecha consultada; confirmar/estimate es una declaracion del usuario, no validacion automatica; actualizar antes de decidir. |
| Rutas IA/proveedor se abusan o exponen contexto | Auth/ownership, validacion, limites de payload/rate/coste y privacidad declarada. |
| Offline percibido como completo cuando no lo es | Mostrar disponibilidad real; probar cache de datos/documentos; no prometer chat offline. |
| TripView concentra UI | Mantener cambios pequeños; extraer componente solo al crear secciones nuevas reutilizables. |
| Plazo corto | Limitar a una ciudad/un viaje; freeze de funcionalidades una semana antes. |

## 9. Validacion y medicion del piloto

Antes del viaje: unit tests para calculos de grupo/check-in y provenance; pruebas de API/RLS/chat; regresion en dispositivos; prueba offline de viaje y documentos; caso de red ausente/datos incompletos.

Durante el primer piloto, medir minimamente decisiones iniciadas, recomendaciones aceptadas/rechazadas, consultas de pago y uso de Day Genius/chat. No enviar documentos, ubicaciones precisas ni texto completo del chat a analytics sin una decision de privacidad explicita.

## 10. Situacion al crear este roadmap

La auditoria del esquema fue local; no se consulto Supabase en esta sesion. El usuario reporta que el owner-path de Trip Context guarda/lee correctamente. Tras Arrival Assistant/Maps links/multiple check-ins: 60 tests, typecheck y build pasan; lint focalizado no tiene errores y lint completo reporta 33 errores. La apertura de links en el dispositivo real y la persistencia manual de cotizaciones/permisos de invitado aun requieren prueba manual.
