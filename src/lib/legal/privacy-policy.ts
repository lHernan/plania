/**
 * The privacy policy text, in Spanish and English. Every statement here reflects what the app
 * does; change the text whenever data flows change (new provider, new AI feature, new storage).
 *
 * Inline tokens in paragraphs and list items: {email} renders the privacy contact as a mailto
 * link and {aepd} renders the link to the Spanish data protection authority.
 */

export const PRIVACY_CONTACT_EMAIL = "privacidad@tachao.app";
export const AEPD_URL = "https://www.aepd.es";

export type PolicyLang = "es" | "en";

export type PolicyBlock = { p: string } | { list: string[] };

export type PolicySection = { id: string; title: string; blocks: PolicyBlock[] };

export type PrivacyPolicyText = {
  lang: PolicyLang;
  title: string;
  lastUpdated: string;
  intro: string;
  sections: PolicySection[];
};

const es: PrivacyPolicyText = {
  lang: "es",
  title: "Política de privacidad",
  lastUpdated: "Última actualización: 6 de noviembre de 2026",
  intro:
    "Esta política explica qué datos personales trata Tachao, la aplicación para planificar y vivir viajes, para qué los usa, con qué base legal, con quién los comparte y qué derechos tienes. Se aplica el Reglamento General de Protección de Datos (RGPD) y la Ley Orgánica 3/2018 de Protección de Datos Personales y garantía de los derechos digitales (LOPDGDD).",
  sections: [
    {
      id: "responsable",
      title: "1. Responsable del tratamiento",
      blocks: [
        { p: "El responsable del tratamiento de tus datos es Hernán, persona física con residencia en España, que gestiona Tachao." },
        { p: "Para cualquier cuestión sobre privacidad o para ejercer tus derechos, escribe a {email}." },
      ],
    },
    {
      id: "datos",
      title: "2. Qué datos tratamos, para qué y con qué base legal",
      blocks: [
        { p: "Cuenta e inicio de sesión. Tratamos tu dirección de email y tu contraseña (guardada de forma protegida por el servicio de autenticación, nunca en texto legible). Si eliges entrar con Google o Apple, recibimos de ese proveedor tu email, el identificador de tu cuenta y los datos básicos de perfil que el proveedor comparta. Si usas la app sin registrarte, se crea una sesión anónima con un identificador aleatorio para guardar lo que haces; si después inicias sesión, ese contenido pasa a tu cuenta. Base legal: la ejecución del contrato, es decir, prestarte el servicio que solicitas." },
        { p: "Contenido de tus viajes. Guardamos lo que creas en la app: nombre y fechas del viaje, días y ciudades, actividades (con horarios, ubicaciones, notas y costes), reservas, presupuesto y moneda, listas de equipaje y de compras, el contexto del viaje (número de viajeros, equipaje, llegada, alojamiento y preferencias), los documentos que subes (PDF e imágenes), las portadas, los recuerdos (fotos, notas, valoraciones y con quién los compartes), los comentarios en actividades y los mensajes del chat con Tachi. Base legal: la ejecución del contrato." },
        { p: "Compartir viajes. Si invitas a alguien a un viaje, tratamos su email para darle acceso y enviarle una invitación que incluye el nombre del viaje, tu email y un enlace. Si esa persona aún no tiene cuenta, se crea una asociada a su email para que pueda entrar con el enlace. Antes de invitar a alguien, asegúrate de que le parece bien recibir la invitación. Base legal: la ejecución del contrato contigo y nuestro interés legítimo en que las personas que invitas puedan acceder al viaje." },
        { p: "Enlaces públicos. Si creas un enlace público de un viaje, cualquier persona que lo tenga puede ver el nombre del viaje, la portada, los días y ciudades, las actividades (título, hora, duración, ubicación, categoría y estado) y los recuerdos compartidos con todo el viaje (notas, valoraciones y fotos). No se muestran las notas ni los costes de las actividades, las reservas, los documentos, los emails ni los recuerdos compartidos solo con algunas personas. Puedes revocar el enlace en cualquier momento." },
        { p: "Seguridad y límites de uso. Llevamos un contador diario de uso de las funciones de IA por usuario para evitar abusos y controlar costes, y protegemos el acceso a los datos de cada viaje. Nuestros proveedores de alojamiento pueden registrar datos técnicos como tu dirección IP para operar y proteger el servicio. Base legal: nuestro interés legítimo en mantener el servicio seguro y disponible." },
        { p: "Consentimiento. Compartir el contexto de un viaje con la IA es opcional y solo ocurre si activas esa opción; puedes desactivarla cuando quieras, sin que afecte a lo tratado antes. Base legal: tu consentimiento." },
        { p: "No vendemos tus datos, no los usamos para publicidad y no tomamos decisiones automatizadas que produzcan efectos jurídicos sobre ti." },
      ],
    },
    {
      id: "ia",
      title: "3. Funciones de inteligencia artificial",
      blocks: [
        { p: "Tachi, el asistente de la app, funciona con proveedores externos de servicios de IA. Solo se envía información cuando usas una función, y solo la que esa función necesita:" },
        {
          list: [
            "Chat con Tachi: tu mensaje, los mensajes recientes del chat del viaje y un resumen del viaje (días, ciudades, actividades con sus notas, reservas con su importe y lista de compras). El contexto del viaje solo se incluye si has activado compartirlo con la IA.",
            "Importar un plan desde notas o dictado: el texto que pegas o dictas.",
            "Importar reservas: el texto de los PDF que eliges. Solo cuando una página no tiene texto legible se envía una imagen de esa página.",
            "Detectar códigos QR o de barras en un documento, cuando lo pides: una imagen de la primera página del documento.",
            "Lista de equipaje: las ciudades, un resumen del tiempo previsto, los tipos de actividades, el equipaje, la duración del viaje y el número de viajeros.",
            "Reorganizar un día: las actividades del día, la ciudad, las fechas y la previsión del tiempo.",
            "Resumen del viaje: las notas y valoraciones de los recuerdos que puedes ver, sin fotos, emails ni identificadores de autor.",
            "Sugerir un pie de foto: solo el texto que escribes; la foto nunca se envía.",
            "Lista de compras: el texto que escribes y tu lista actual, o la ciudad del día para sugerencias.",
          ],
        },
        { p: "Las respuestas de la IA pueden contener errores: revisa los cambios antes de aplicarlos." },
      ],
    },
    {
      id: "destinatarios",
      title: "4. Quién recibe tus datos",
      blocks: [
        { p: "Usamos proveedores que tratan datos por nuestra cuenta, solo para prestar el servicio:" },
        {
          list: [
            "Supabase: autenticación, base de datos y almacenamiento de archivos.",
            "Vercel: alojamiento de la aplicación web.",
            "Proveedores de servicios de IA: las funciones de Tachi descritas arriba.",
            "Resend: envío de los emails de invitación a viajes.",
            "Geoapify: ubicar en el mapa los lugares de tus actividades y buscar lugares cercanos (recibe nombres de lugares, la ciudad y coordenadas).",
            "Open-Meteo: previsión del tiempo (recibe el nombre de la ciudad y coordenadas).",
            "Frankfurter: tipos de cambio de moneda (solo recibe códigos de moneda).",
            "OpenStreetMap: los mapas. Tu navegador descarga las imágenes del mapa directamente de sus servidores, que reciben tu dirección IP y la zona del mapa que ves.",
          ],
        },
        { p: "Otros terceros, sujetos a sus propias políticas: Google o Apple, si eliges iniciar sesión con ellos; Google Maps, solo cuando abres un enlace a Google Maps desde la app; y el servicio de reconocimiento de voz de tu navegador cuando usas el dictado, que según el navegador puede procesar el audio en servidores de su fabricante (por ejemplo, Google o Apple)." },
        { p: "Las personas con las que compartes un viaje ven su contenido según el rol que les das. También podemos comunicar datos a autoridades cuando la ley lo exija." },
      ],
    },
    {
      id: "transferencias",
      title: "5. Transferencias internacionales",
      blocks: [
        { p: "Algunos de estos proveedores pueden tratar datos fuera del Espacio Económico Europeo. En ese caso, la transferencia se ampara en las garantías que ofrecen, como una decisión de adecuación de la Comisión Europea o las Cláusulas Contractuales Tipo. Puedes pedir más información en {email}." },
      ],
    },
    {
      id: "conservacion",
      title: "6. Cuánto tiempo conservamos los datos",
      blocks: [
        { p: "Conservamos los datos de tu cuenta y de tus viajes mientras tengas la cuenta. Cuando pides eliminarla, borramos la cuenta y el contenido asociado, incluidos los contadores de uso; pueden quedar durante un tiempo limitado en las copias de seguridad de nuestros proveedores hasta que se sobrescriben, y podemos conservar lo que la ley nos obligue a guardar." },
        { p: "La app aún no tiene un botón para eliminar la cuenta: escribe a {email} desde el email de tu cuenta y la eliminaremos." },
        { p: "Los datos guardados en tu dispositivo se mantienen hasta que cierras sesión o borras los datos del sitio en tu navegador." },
      ],
    },
    {
      id: "derechos",
      title: "7. Tus derechos",
      blocks: [
        { p: "Puedes ejercer en cualquier momento tus derechos de acceso, rectificación, supresión, oposición, limitación del tratamiento y portabilidad, y retirar tu consentimiento, escribiendo a {email}. Podemos pedirte que confirmes tu identidad, y te responderemos en el plazo de un mes." },
        { p: "Si crees que no hemos tratado bien tus datos, puedes presentar una reclamación ante la Agencia Española de Protección de Datos ({aepd})." },
      ],
    },
    {
      id: "dispositivo",
      title: "8. Almacenamiento en tu dispositivo",
      blocks: [
        { p: "La app guarda en tu navegador (almacenamiento local, IndexedDB y la caché del service worker) lo necesario para funcionar: tu sesión, el idioma y otras preferencias, el formulario de planificación en curso y una copia de tus viajes y documentos para usarlos sin conexión. Es almacenamiento técnico necesario para el servicio que pides." },
        { p: "No usamos cookies de analítica ni de publicidad, ni ninguna otra herramienta de analítica o publicidad." },
      ],
    },
    {
      id: "menores",
      title: "9. Menores",
      blocks: [
        { p: "Tachao no está dirigido a menores de 14 años. Si tienes menos de 14 años, no uses la app. Si sabemos que hemos recibido datos de un menor de 14 años, los eliminaremos." },
      ],
    },
    {
      id: "cambios",
      title: "10. Cambios en esta política",
      blocks: [
        { p: "Podemos actualizar esta política cuando cambie la app o la normativa. Publicaremos aquí la versión vigente con su fecha y, si el cambio es importante, te avisaremos en la app." },
      ],
    },
  ],
};

const en: PrivacyPolicyText = {
  lang: "en",
  title: "Privacy policy",
  lastUpdated: "Last updated: 6 November 2026",
  intro:
    "This policy explains what personal data Tachao, the app for planning and living trips, processes, what it is used for, on which legal basis, who receives it and what rights you have. It is governed by the General Data Protection Regulation (GDPR) and the Spanish Organic Law 3/2018 on Personal Data Protection and Guarantee of Digital Rights (LOPDGDD).",
  sections: [
    {
      id: "controller",
      title: "1. Data controller",
      blocks: [
        { p: "The controller of your data is Hernán, an individual based in Spain, who runs Tachao." },
        { p: "For any privacy question or to exercise your rights, write to {email}." },
      ],
    },
    {
      id: "data",
      title: "2. What data we process, why, and on which legal basis",
      blocks: [
        { p: "Account and sign-in. We process your email address and your password (stored in protected form by the authentication service, never in readable text). If you choose to sign in with Google or Apple, we receive from that provider your email, your account identifier and the basic profile data the provider shares. If you use the app without signing up, an anonymous session with a random identifier is created to keep what you do; if you sign in later, that content moves to your account. Legal basis: performance of the contract, that is, providing the service you ask for." },
        { p: "Your trip content. We store what you create in the app: trip name and dates, days and cities, activities (with times, locations, notes and costs), reservations, budget and currency, packing and shopping lists, the trip context (number of travelers, luggage, arrival, accommodation and preferences), the documents you upload (PDFs and images), covers, memories (photos, notes, ratings and who you share them with), activity comments and Tachi chat messages. Legal basis: performance of the contract." },
        { p: "Sharing trips. If you invite someone to a trip, we process their email to give them access and to send them an invitation that includes the trip name, your email and a link. If that person has no account yet, one is created for their email so they can get in with the link. Before inviting someone, make sure they are happy to receive the invitation. Legal basis: performance of the contract with you and our legitimate interest in letting the people you invite access the trip." },
        { p: "Public links. If you create a public link to a trip, anyone who has it can see the trip name, the cover, the days and cities, the activities (title, time, duration, location, category and status) and the memories shared with the whole trip (notes, ratings and photos). Activity notes and costs, reservations, documents, emails and memories shared with only some people are not shown. You can revoke the link at any time." },
        { p: "Security and usage limits. We keep a daily per-user counter of AI feature usage to prevent abuse and control costs, and we protect access to each trip's data. Our hosting providers may log technical data such as your IP address to run and protect the service. Legal basis: our legitimate interest in keeping the service secure and available." },
        { p: "Consent. Sharing a trip's context with the AI is optional and only happens if you turn that option on; you can turn it off at any time, without affecting what was processed before. Legal basis: your consent." },
        { p: "We do not sell your data, we do not use it for advertising, and we do not make automated decisions that produce legal effects on you." },
      ],
    },
    {
      id: "ai",
      title: "3. Artificial intelligence features",
      blocks: [
        { p: "Tachi, the app's assistant, runs on external AI service providers. Information is only sent when you use a feature, and only what that feature needs:" },
        {
          list: [
            "Chat with Tachi: your message, the recent messages of the trip chat and a summary of the trip (days, cities, activities with their notes, reservations with their amount and the shopping list). The trip context is only included if you have turned on sharing it with the AI.",
            "Importing a plan from notes or dictation: the text you paste or dictate.",
            "Importing bookings: the text of the PDFs you choose. Only when a page has no readable text is an image of that page sent.",
            "Detecting QR codes or barcodes in a document, when you ask for it: an image of the document's first page.",
            "Packing list: the cities, a summary of the expected weather, the kinds of activities, the luggage, the trip length and the number of travelers.",
            "Rearranging a day: the day's activities, the city, the dates and the weather forecast.",
            "Trip summary: the notes and ratings of the memories you can see, without photos, emails or author identifiers.",
            "Photo caption suggestions: only the text you write; the photo is never sent.",
            "Shopping list: the text you write and your current list, or the day's city for suggestions.",
          ],
        },
        { p: "AI answers can contain mistakes: review changes before applying them." },
      ],
    },
    {
      id: "recipients",
      title: "4. Who receives your data",
      blocks: [
        { p: "We use providers that process data on our behalf, only to provide the service:" },
        {
          list: [
            "Supabase: authentication, database and file storage.",
            "Vercel: hosting of the web app.",
            "AI service providers: the Tachi features described above.",
            "Resend: sending trip invitation emails.",
            "Geoapify: placing your activities' locations on the map and finding nearby places (receives place names, the city and coordinates).",
            "Open-Meteo: weather forecasts (receives the city name and coordinates).",
            "Frankfurter: currency exchange rates (only receives currency codes).",
            "OpenStreetMap: maps. Your browser downloads the map images directly from its servers, which receive your IP address and the map area you view.",
          ],
        },
        { p: "Other third parties, under their own policies: Google or Apple, if you choose to sign in with them; Google Maps, only when you open a Google Maps link from the app; and your browser's speech recognition service when you use dictation, which depending on the browser may process the audio on its vendor's servers (for example, Google or Apple)." },
        { p: "The people you share a trip with see its content according to the role you give them. We may also disclose data to authorities when the law requires it." },
      ],
    },
    {
      id: "transfers",
      title: "5. International transfers",
      blocks: [
        { p: "Some of these providers may process data outside the European Economic Area. In that case, the transfer relies on the safeguards they offer, such as a European Commission adequacy decision or Standard Contractual Clauses. You can ask for more information at {email}." },
      ],
    },
    {
      id: "retention",
      title: "6. How long we keep data",
      blocks: [
        { p: "We keep your account and trip data for as long as you have the account. When you ask for its deletion, we delete the account and its associated content, including usage counters; they may remain for a limited time in our providers' backups until overwritten, and we may keep what the law requires us to keep." },
        { p: "The app does not have a delete-account button yet: write to {email} from your account's email and we will delete it." },
        { p: "Data stored on your device stays there until you sign out or clear the site's data in your browser." },
      ],
    },
    {
      id: "rights",
      title: "7. Your rights",
      blocks: [
        { p: "You can exercise at any time your rights of access, rectification, erasure, objection, restriction of processing and portability, and withdraw your consent, by writing to {email}. We may ask you to confirm your identity, and we will reply within one month." },
        { p: "If you believe we have not handled your data properly, you can lodge a complaint with the Spanish Data Protection Agency (Agencia Española de Protección de Datos, {aepd})." },
      ],
    },
    {
      id: "device",
      title: "8. Storage on your device",
      blocks: [
        { p: "The app stores in your browser (local storage, IndexedDB and the service worker cache) what it needs to work: your session, the language and other preferences, the planning form in progress, and a copy of your trips and documents so you can use them offline. This is technical storage needed for the service you ask for." },
        { p: "We do not use analytics or advertising cookies, or any other analytics or advertising tools." },
      ],
    },
    {
      id: "minors",
      title: "9. Minors",
      blocks: [
        { p: "Tachao is not intended for children under 14. If you are under 14, do not use the app. If we learn that we have received data from a child under 14, we will delete it." },
      ],
    },
    {
      id: "changes",
      title: "10. Changes to this policy",
      blocks: [
        { p: "We may update this policy when the app or the law changes. We will publish the current version here with its date and, if the change is significant, we will let you know in the app." },
      ],
    },
  ],
};

export const PRIVACY_POLICY: Record<PolicyLang, PrivacyPolicyText> = { es, en };
