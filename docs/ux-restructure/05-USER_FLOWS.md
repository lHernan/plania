# 05 · Flujos de usuario

**Regla común a todos los flujos:** el visitante puede explorar y preparar un borrador antes de que se le pida cuenta; guardar y usar a Tachi (IA) requieren registro; y una vez dentro de un viaje llega a cualquier dato en ≤ 2 toques desde el Itinerario.

---

## F1 · Usuario nuevo → primer viaje (borrador, guardado con cuenta)

```mermaid
flowchart TD
    A[Visita /] --> B{¿Cómo empieza?}
    B -->|"Escribe destino y fechas o nº de días"| C[/plan Planificador/]
    B -->|"Elige plantilla"| D[Plantilla cargada como borrador]
    B -->|"Crear desde cero"| E[Nombre + fechas o nº de días]
    C -->|"Generar con Tachi"| AU[Hoja de acceso]
    AU --> F[Tachi genera la vista previa por días]
    F -->|Aceptar| SV[Viaje guardado en la cuenta]
    D --> G[Borrador: visible y editable, no guardado]
    E --> G
    G -->|"Guardar"| AU2[Hoja de acceso]
    AU2 --> SV
    SV --> H[Itinerario /trips/:id en modo Planificando]
```

Notas:

- **Decidido:** se mantiene el modelo de borrador que exige login para guardarse (como las plantillas hoy, `activeTripIsDraft`) y se extiende a "Crear desde cero", que hoy guarda directamente en la sesión anónima.
- **Decidido:** la IA solo está disponible con cuenta; "Generar con Tachi" lleva al registro y conserva lo rellenado.

## F2 · Registro

```mermaid
flowchart LR
    T{Disparador} -->|"Guardar borrador"| S[Hoja de acceso]
    T -->|"Pregúntale a Tachi"| S
    T -->|"Compartir viaje"| S
    T -->|"Abrir en otro dispositivo"| S
    T -->|"Invitación por email"| S
    S --> R[Registro email + contraseña]
    R --> X[El borrador se guarda en la cuenta]
    X --> CL[claimPendingInvitations]
    CL --> V[Vuelve exactamente a donde estaba]
```

Requisito: tras registrarse, **volver a la misma pantalla** (hoy `AuthInitializer` puede redirigir a `/trips`). El copy de la hoja explica el motivo del disparador.

## F3 · Creación de viaje (autenticado)

```mermaid
flowchart TD
    A[Selector de viaje o Mis viajes] --> B[+ Nuevo viaje]
    B --> C{Modo}
    C -->|Con Tachi| D[/plan/]
    C -->|Importar reservas| E[BookingImportModal sobre viaje nuevo]
    C -->|Manual| F[Nombre + fechas o nº de días]
    D --> G[Itinerario del viaje nuevo]
    E --> G
    F --> G
```

## F4 · Planificación con IA dentro del viaje

```mermaid
sequenceDiagram
    actor U as Usuario
    participant I as Itinerario
    participant DG as Tachi
    participant S as Store
    U->>I: Toca ✦ en un día vacío
    I->>DG: Abre con contexto {viaje, día, ciudad}
    DG-->>U: Acciones: Rellenar día · Importar notas · Importar PDF
    U->>DG: Rellenar día
    DG->>DG: Propuesta (clima, distancias, reservas fijas)
    DG-->>U: Vista previa de cambios
    U->>DG: Aplicar
    DG->>S: applyDayPlan / add_activity
    S-->>I: Día actualizado (origin = suggested)
```

## F5 · Gestión de varios viajes

```mermaid
flowchart TD
    L[Login] --> SEL[trip-selection: en curso → favorito → próximo → último pasado]
    SEL --> IT[Itinerario del viaje elegido]
    IT -->|"Toca el título del viaje"| SW[TripSwitcher: recientes + Ver todos]
    SW -->|"Elige otro"| IT2[Itinerario de ese viaje, URL /trips/:otroId]
    SW -->|"Ver todos"| MT[Mis viajes agrupados por estado]
    MT -->|"Favorito ★"| FAV[Pasa a ser el viaje inicial]
```

## F6 · Preparación del viaje

```mermaid
flowchart TD
    A[Banner de preparación en Itinerario] --> B[Viaje › Resumen › Estado de preparación]
    B --> C{Pendiente}
    C -->|"2 por reservar"| D[Cartera › Por reservar → marcar reservada]
    C -->|"3 documentos sin offline"| E[Cartera › Documentos → guardar offline]
    C -->|"Maleta sin generar"| F[Viaje › Maleta → Tachi genera]
    C -->|"Día 4 vacío"| G[Itinerario día 4 → Tachi rellenar]
    D & E & F & G --> H[Checklist al 100 %: ¡Listo para el viaje!]
```

## F7 · Uso durante el viaje (modo Hoy)

```mermaid
flowchart TD
    O[Abre la app] --> H[Itinerario, día de hoy, tarjeta Ahora/Siguiente]
    H -->|"1 toque"| DOC[Documento de la actividad → Mostrar código]
    H -->|"1 toque"| MAP[Mapa del día con la actividad seleccionada]
    H -->|"1 toque"| BK[Hoja de actividad › Reserva]
    H -->|"Se me ha hecho tarde"| DG[✦ Tachi → Reorganizar resto del día]
    DG --> PV[Vista previa] --> AP[Aplicar]
    H -->|"Marcar hecho"| T[¡Tachao!]
    T -->|"Última del día"| DT[¡Día tachao! → siguiente día]
```

Objetivo medible: tarjeta de embarque en ≤ 2 toques desde la apertura (Cartera › Hoy › documento, o tarjeta Ahora › documento).

## F8 · Finalización y recuerdos

```mermaid
flowchart TD
    E[Última actividad del viaje completada] --> VT[¡Viaje tachao! existente]
    VT --> RM[Itinerario pasa a modo Recuerdo]
    RM --> R[Recuerdos: mapa de lo tachado + fotos + notas]
    R -->|"Tachi"| SUM[Resumen del viaje]
    R --> SH[Compartir historia]
    R --> NEXT[Planificar el siguiente viaje]
```

F8 depende de la Fase 5 (modelo de recuerdos). Hasta entonces, el modo Recuerdo muestra solo completadas y mapa.
