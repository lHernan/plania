# 02 · Visión de producto

**Tachao acompaña un viaje de principio a fin, y el itinerario es el lugar desde el que se vive.** Todo lo demás (reservas, documentos, mapa, maleta, recuerdos) se alcanza desde el viaje sin salir de él más de un toque.

> «Destino Tachao, recuerdos que quedan.»

---

## 1. Para quién

| Perfil | Momento | Qué necesita de Tachao |
|--------|---------|------------------------|
| Planificador/a | Semanas antes | Convertir ideas, PDFs y notas en un plan realista sin teclear todo. |
| Viajero/a en ruta | Durante el viaje, móvil en una mano | Saber qué toca ahora, llegar, enseñar el billete, adaptar el día. |
| Acompañante invitado | Antes y durante | Ver el plan y los documentos que le afectan, comentar. |
| Quien vuelve a casa | Después | Revivir y compartir lo hecho. |

---

## 2. Ciclo de vida y protagonista de cada fase

| Fase | Pantalla protagonista | Papel de la IA |
|------|----------------------|----------------|
| Inspiración | Landing / Descubrir | Proponer un primer itinerario a partir de destino + fechas (requiere cuenta). |
| Planificación | Itinerario | Importar PDFs y notas, rellenar huecos, sugerir. |
| Organización | Cartera (reservas + documentos) | Extraer datos, detectar duplicados, avisar de lo que falta reservar. |
| Preparación | Viaje (resumen, maleta) | Generar maleta con clima y equipaje; estado de preparación. |
| Durante | Itinerario en modo **Hoy** + Mapa | Tachi reorganiza el día con hora, distancias y clima. |
| Después | Recuerdos | Resumir el viaje a partir de lo «tachado». |

El itinerario cambia de **modo** según la fase, en vez de que el usuario cambie de pantalla:

- **Planificando** (viaje futuro): foco en huecos, reservas pendientes, importar.
- **Hoy** (viaje en curso): foco en la próxima actividad, su reserva y su documento.
- **Recuerdo** (viaje terminado): las actividades completadas se presentan como historia.

---

## 3. Principios de diseño

1. **El itinerario es el corazón.** Es la pantalla inicial con viaje activo y la pestaña por defecto del viaje.
2. **Contexto antes que navegación.** Si una acción se refiere a una actividad (ver reserva, abrir PDF, ver en mapa, pedir a Tachi), se hace desde la actividad, en una hoja inferior, sin abandonar el día.
3. **Un viaje, cuatro lugares.** Dentro de un viaje solo hay cuatro secciones de primer nivel. Lo demás se agrupa.
4. **Una sola IA con un solo nombre.** Tachi es la cara de toda la IA; el chat, la optimización y las importaciones son *capacidades* de Tachi, no productos separados.
5. **La IA propone, el usuario decide.** Se mantiene el patrón ya implementado en importación y Tachi: vista previa → confirmar → aplicar.
6. **La IA es para usuarios registrados.** El visitante explora, prepara un borrador y ve lo que Tachi haría; generar y guardar piden cuenta.
7. **Móvil durante el viaje primero.** La información crítica (próxima actividad, billete, dirección) a ≤ 2 toques desde la apertura de la app.
8. **Global y viaje no se mezclan.** Cuenta, idioma, tema y lista de viajes son globales; todo lo demás pertenece a un viaje.
9. **La fotografía cuenta el viaje.** Set curado y licenciado para landing, plantillas y portadas por defecto; en sus propios viajes, las fotos que suba el usuario. Nada de decoración sin información.
10. **Reutilizar antes que construir.** Cada pantalla nueva se compone primero con componentes existentes.
11. **Honestidad de datos.** Se mantiene la distinción ya existente entre extraído / estimado / por confirmar.

---

## 4. Qué NO es Tachao

- No es un dashboard: no hay pantalla de KPIs ni gráficas de progreso.
- No es un gestor de tareas genérico: el «¡Tachao!» celebra experiencias, no tickets.
- No es un chatbot: la conversación existe, pero siempre ligada a acciones sobre el viaje.
- No es una agencia: no vende ni reserva; organiza lo que el usuario ya ha reservado.

---

## 5. Objetivos medibles de la reestructuración

| Objetivo | Indicador | Hoy (estimado por inspección) | Meta |
|----------|-----------|-------------------------------|------|
| Encontrar un documento durante el viaje | Toques desde abrir la app hasta ver la tarjeta de embarque | 4-6 (día → actividad → editar → adjunto) | ≤ 2 |
| Descubrir reservas pendientes en móvil | Visible sin scroll largo | Al fondo del sidebar apilado | Pestaña Cartera con contador |
| Claridad de IA | Puntos de entrada con nombre distinto | 5 | 1 nombre, entradas contextuales |
| Conversión de visitante | Visitante que prepara un borrador y se registra para guardarlo o generarlo con IA | Solo "Crear desde cero" o plantilla | Borrador sin cuenta + Tachi tras registro |
| Enlazabilidad | Viaje y sección con URL propia | No | Sí |
