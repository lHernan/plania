/**
 * Per-country emergency information: emergency numbers, medical phrases,
 * and connectivity tips. Static data — no API required.
 */

export type EmergencyPhrase = {
  /** What the traveler needs to say */
  intent: string;
  /** The phrase in the local language */
  local: string;
  /** Pronunciation hint (simplified) */
  pronunciation: string;
};

export type CountryEmergencyInfo = {
  country: string;
  countryCode: string;
  /** Primary emergency number (police/fire/ambulance) */
  emergencyNumber: string;
  /** Police-specific number if different */
  policeNumber?: string;
  /** Ambulance-specific number if different */
  ambulanceNumber?: string;
  /** Brief notes about calling emergency services */
  emergencyNotes: string;
  /** Primary language(s) */
  languages: string[];
  /** Essential medical/emergency phrases in the local language */
  phrases: EmergencyPhrase[];
  /** SIM / connectivity tips */
  connectivityTips: string;
};

// ── Data ────────────────────────────────────────────────────────────────────

export const EMERGENCY_DATA: readonly CountryEmergencyInfo[] = [
  {
    country: "Spain",
    countryCode: "ES",
    emergencyNumber: "112",
    policeNumber: "091",
    ambulanceNumber: "061",
    emergencyNotes: "112 works from any phone, even without a SIM. Operators speak English and Spanish.",
    languages: ["Spanish"],
    phrases: [
      { intent: "I need a doctor", local: "Necesito un médico", pronunciation: "neh-seh-SEE-toh oon MEH-dee-koh" },
      { intent: "I need help", local: "Necesito ayuda", pronunciation: "neh-seh-SEE-toh ah-YOO-dah" },
      { intent: "Where is the hospital?", local: "¿Dónde está el hospital?", pronunciation: "DOHN-deh ehs-TAH el ohs-pee-TAHL" },
      { intent: "I'm allergic to…", local: "Soy alérgico/a a…", pronunciation: "soy ah-LEHR-hee-koh ah" },
      { intent: "Call the police", local: "Llame a la policía", pronunciation: "YAH-meh ah lah poh-lee-SEE-ah" },
    ],
    connectivityTips: "EU roaming rules apply — most EU SIMs work without extra charges. Prepaid tourist SIMs available at airports and phone shops. Free Wi-Fi common in cafés and hotels.",
  },
  {
    country: "France",
    countryCode: "FR",
    emergencyNumber: "112",
    policeNumber: "17",
    ambulanceNumber: "15",
    emergencyNotes: "112 works EU-wide. SAMU (15) is specifically for medical emergencies. Operators may speak limited English — speak slowly.",
    languages: ["French"],
    phrases: [
      { intent: "I need a doctor", local: "J'ai besoin d'un médecin", pronunciation: "zhay beh-ZWAN duhn mehd-SAN" },
      { intent: "I need help", local: "J'ai besoin d'aide", pronunciation: "zhay beh-ZWAN dehd" },
      { intent: "Where is the hospital?", local: "Où est l'hôpital ?", pronunciation: "oo eh loh-pee-TAHL" },
      { intent: "I'm allergic to…", local: "Je suis allergique à…", pronunciation: "zhuh swee ah-lehr-ZHEEK ah" },
      { intent: "Call the police", local: "Appelez la police", pronunciation: "ah-play lah poh-LEES" },
    ],
    connectivityTips: "EU roaming applies. Free Wi-Fi available in most hotels and cafés. Orange and SFR sell prepaid tourist SIMs at airports. Paris Metro has free Wi-Fi at stations.",
  },
  {
    country: "Italy",
    countryCode: "IT",
    emergencyNumber: "112",
    policeNumber: "113",
    ambulanceNumber: "118",
    emergencyNotes: "112 is the unified emergency number. Carabinieri (military police): 112. State police: 113. English-speaking operators available on 112.",
    languages: ["Italian"],
    phrases: [
      { intent: "I need a doctor", local: "Ho bisogno di un medico", pronunciation: "oh bee-ZOHN-yoh dee oon MEH-dee-koh" },
      { intent: "I need help", local: "Ho bisogno di aiuto", pronunciation: "oh bee-ZOHN-yoh dee ah-YOO-toh" },
      { intent: "Where is the hospital?", local: "Dov'è l'ospedale?", pronunciation: "doh-VEH lohs-peh-DAH-leh" },
      { intent: "I'm allergic to…", local: "Sono allergico/a a…", pronunciation: "SOH-noh ah-LEHR-jee-koh ah" },
      { intent: "Call the police", local: "Chiami la polizia", pronunciation: "KYAH-mee lah poh-lee-TSEE-ah" },
    ],
    connectivityTips: "EU roaming applies. TIM and Vodafone sell tourist SIMs at airports. Free Wi-Fi in major train stations and most hotels. Coverage can be spotty in rural areas.",
  },
  {
    country: "Germany",
    countryCode: "DE",
    emergencyNumber: "112",
    policeNumber: "110",
    emergencyNotes: "112 for fire and ambulance, 110 for police. Operators typically speak English. Works without SIM.",
    languages: ["German"],
    phrases: [
      { intent: "I need a doctor", local: "Ich brauche einen Arzt", pronunciation: "ikh BROW-kheh EYE-nen artst" },
      { intent: "I need help", local: "Ich brauche Hilfe", pronunciation: "ikh BROW-kheh HIL-feh" },
      { intent: "Where is the hospital?", local: "Wo ist das Krankenhaus?", pronunciation: "voh ist dahs KRAN-ken-house" },
      { intent: "I'm allergic to…", local: "Ich bin allergisch gegen…", pronunciation: "ikh bin ah-LEHR-gish GAY-gen" },
      { intent: "Call the police", local: "Rufen Sie die Polizei", pronunciation: "ROO-fen zee dee poh-lee-TSAI" },
    ],
    connectivityTips: "EU roaming applies. Aldi Talk and Lebara offer cheap prepaid SIMs at supermarkets. Free Wi-Fi less common than other EU countries — cafés often require a purchase.",
  },
  {
    country: "United Kingdom",
    countryCode: "GB",
    emergencyNumber: "999",
    emergencyNotes: "999 or 112 both work. 111 for non-emergency medical advice. English-speaking operators.",
    languages: ["English"],
    phrases: [],
    connectivityTips: "Post-Brexit: EU SIMs may incur roaming charges — check with your provider. Three, EE, and Vodafone sell prepaid SIMs at airports. Excellent 4G/5G coverage in cities.",
  },
  {
    country: "Japan",
    countryCode: "JP",
    emergencyNumber: "110",
    ambulanceNumber: "119",
    emergencyNotes: "110 for police, 119 for fire and ambulance. English support is limited — speak slowly. From a pay phone, press the red button first.",
    languages: ["Japanese"],
    phrases: [
      { intent: "I need a doctor", local: "医者が必要です", pronunciation: "ee-SHA gah hee-TSOO-yoh dess" },
      { intent: "I need help", local: "助けてください", pronunciation: "tah-soo-KEH-teh koo-dah-SAI" },
      { intent: "Where is the hospital?", local: "病院はどこですか？", pronunciation: "byoh-EEN wah DOH-koh dess kah" },
      { intent: "I'm allergic to…", local: "…にアレルギーがあります", pronunciation: "... nee ah-reh-roo-GEE gah ah-ree-mahss" },
      { intent: "Call the police", local: "警察を呼んでください", pronunciation: "KAY-sah-tsoo oh YOHN-deh koo-dah-SAI" },
    ],
    connectivityTips: "Pocket Wi-Fi rental is the easiest option — reserve online before arrival. Tourist SIMs available at airports (IIJmio, Mobal). Free Wi-Fi limited outside convenience stores and train stations.",
  },
  {
    country: "South Korea",
    countryCode: "KR",
    emergencyNumber: "112",
    ambulanceNumber: "119",
    emergencyNotes: "112 for police, 119 for fire and ambulance. English-speaking operators available on 112. 1330 is the tourism hotline with English support.",
    languages: ["Korean"],
    phrases: [
      { intent: "I need a doctor", local: "의사가 필요해요", pronunciation: "ui-sa-ga pil-yo-HAE-yo" },
      { intent: "I need help", local: "도와주세요", pronunciation: "do-wa-joo-SE-yo" },
      { intent: "Where is the hospital?", local: "병원이 어디예요?", pronunciation: "byeong-won-i eo-di-YE-yo" },
      { intent: "I'm allergic to…", local: "…에 알레르기가 있어요", pronunciation: "...eh al-le-reu-gi-ga ISS-eo-yo" },
      { intent: "Call the police", local: "경찰을 불러주세요", pronunciation: "gyeong-chal-eul bul-leo-joo-SE-yo" },
    ],
    connectivityTips: "Excellent 4G/5G coverage everywhere. Tourist SIMs and pocket Wi-Fi available at Incheon Airport. T-money card works for transit and convenience stores. Free Wi-Fi on metro and buses.",
  },
  {
    country: "Thailand",
    countryCode: "TH",
    emergencyNumber: "191",
    ambulanceNumber: "1669",
    emergencyNotes: "191 for police, 1669 for ambulance. Tourist police: 1155 (English-speaking, highly recommended for travelers).",
    languages: ["Thai"],
    phrases: [
      { intent: "I need a doctor", local: "ต้องการหมอ", pronunciation: "dtong-gaan moh" },
      { intent: "I need help", local: "ช่วยด้วย", pronunciation: "CHUAY duay" },
      { intent: "Where is the hospital?", local: "โรงพยาบาลอยู่ที่ไหน", pronunciation: "rohng-pa-ya-baan yoo tee-NAI" },
      { intent: "I'm allergic to…", local: "แพ้…", pronunciation: "PAE ..." },
      { intent: "Call the police", local: "เรียกตำรวจ", pronunciation: "RIAK dtam-ruat" },
    ],
    connectivityTips: "Tourist SIMs are cheap and easy — get one at the airport (AIS, DTAC, TrueMove). 4G coverage excellent in cities and tourist areas. 7-Eleven sells top-up cards.",
  },
  {
    country: "Portugal",
    countryCode: "PT",
    emergencyNumber: "112",
    emergencyNotes: "112 works EU-wide. Operators speak Portuguese and English. PSP (police) in urban areas, GNR in rural areas.",
    languages: ["Portuguese"],
    phrases: [
      { intent: "I need a doctor", local: "Preciso de um médico", pronunciation: "preh-SEE-zoo deh oom MEH-dee-koo" },
      { intent: "I need help", local: "Preciso de ajuda", pronunciation: "preh-SEE-zoo deh ah-ZHOO-dah" },
      { intent: "Where is the hospital?", local: "Onde fica o hospital?", pronunciation: "OHN-deh FEE-kah oo ohsh-pee-TAHL" },
      { intent: "I'm allergic to…", local: "Sou alérgico/a a…", pronunciation: "soh ah-LEHR-zhee-koo ah" },
      { intent: "Call the police", local: "Chame a polícia", pronunciation: "SHAH-meh ah poo-LEE-see-ah" },
    ],
    connectivityTips: "EU roaming applies. MEO and NOS sell tourist SIMs at airports and shops. Free Wi-Fi common in Lisbon and Porto. Coverage good along the coast, weaker inland.",
  },
  {
    country: "Netherlands",
    countryCode: "NL",
    emergencyNumber: "112",
    emergencyNotes: "112 for all emergencies. Operators speak Dutch and English fluently.",
    languages: ["Dutch"],
    phrases: [
      { intent: "I need a doctor", local: "Ik heb een dokter nodig", pronunciation: "ik hep uhn DOK-ter NOH-dikh" },
      { intent: "I need help", local: "Ik heb hulp nodig", pronunciation: "ik hep hulp NOH-dikh" },
      { intent: "Where is the hospital?", local: "Waar is het ziekenhuis?", pronunciation: "vahr is het ZEE-ken-house" },
      { intent: "I'm allergic to…", local: "Ik ben allergisch voor…", pronunciation: "ik ben ah-LEHR-khees vohr" },
      { intent: "Call the police", local: "Bel de politie", pronunciation: "bel deh poh-LEET-see" },
    ],
    connectivityTips: "EU roaming applies. Excellent coverage and free Wi-Fi everywhere. Lebara and Lyca sell cheap prepaid SIMs at supermarkets.",
  },
  {
    country: "Turkey",
    countryCode: "TR",
    emergencyNumber: "112",
    policeNumber: "155",
    ambulanceNumber: "112",
    emergencyNotes: "112 is the unified number. 155 for police, 156 for gendarmerie. English support is limited outside Istanbul.",
    languages: ["Turkish"],
    phrases: [
      { intent: "I need a doctor", local: "Bir doktora ihtiyacım var", pronunciation: "beer dok-TOH-rah eeh-tee-yah-JUHM vahr" },
      { intent: "I need help", local: "Yardım edin", pronunciation: "yahr-DUHM eh-DEEN" },
      { intent: "Where is the hospital?", local: "Hastane nerede?", pronunciation: "hahs-tah-NEH neh-reh-DEH" },
      { intent: "I'm allergic to…", local: "…'e alerjim var", pronunciation: "...eh ah-lehr-ZHEEM vahr" },
      { intent: "Call the police", local: "Polisi arayın", pronunciation: "poh-lee-SEE ah-rah-YUHN" },
    ],
    connectivityTips: "Foreign phones may be blocked after 120 days. Tourist SIMs (Turkcell, Vodafone) at the airport are the safest option. Register your device IMEI if staying long. Free Wi-Fi in hotels and malls.",
  },
  {
    country: "Mexico",
    countryCode: "MX",
    emergencyNumber: "911",
    emergencyNotes: "911 is the unified emergency number since 2017. Some operators speak English, but Spanish is strongly preferred.",
    languages: ["Spanish"],
    phrases: [
      { intent: "I need a doctor", local: "Necesito un doctor", pronunciation: "neh-seh-SEE-toh oon dok-TOR" },
      { intent: "I need help", local: "Necesito ayuda", pronunciation: "neh-seh-SEE-toh ah-YOO-dah" },
      { intent: "Where is the hospital?", local: "¿Dónde está el hospital?", pronunciation: "DOHN-deh ehs-TAH el ohs-pee-TAHL" },
      { intent: "I'm allergic to…", local: "Soy alérgico/a a…", pronunciation: "soy ah-LEHR-hee-koh ah" },
      { intent: "Call the police", local: "Llame a la policía", pronunciation: "YAH-meh ah lah poh-lee-SEE-ah" },
    ],
    connectivityTips: "Telcel has the best coverage. Prepaid SIMs at OXXO convenience stores and airports. 911 works from any phone. Free Wi-Fi in Starbucks, airports, and many restaurants.",
  },
  {
    country: "United States",
    countryCode: "US",
    emergencyNumber: "911",
    emergencyNotes: "911 for all emergencies. Works from any phone, even without a SIM. Text-to-911 available in most areas.",
    languages: ["English"],
    phrases: [],
    connectivityTips: "T-Mobile and Mint Mobile offer cheap prepaid SIMs. Excellent coverage in cities, patchy in national parks and rural areas. Most cafés, libraries, and hotels have free Wi-Fi.",
  },
  {
    country: "Argentina",
    countryCode: "AR",
    emergencyNumber: "911",
    policeNumber: "101",
    ambulanceNumber: "107",
    emergencyNotes: "911 works nationwide. 107 for SAME ambulance service. English support is very limited — use Spanish.",
    languages: ["Spanish"],
    phrases: [
      { intent: "I need a doctor", local: "Necesito un médico", pronunciation: "neh-seh-SEE-toh oon MEH-dee-koh" },
      { intent: "I need help", local: "Necesito ayuda", pronunciation: "neh-seh-SEE-toh ah-YOO-dah" },
      { intent: "Where is the hospital?", local: "¿Dónde queda el hospital?", pronunciation: "DOHN-deh KEH-dah el ohs-pee-TAHL" },
      { intent: "I'm allergic to…", local: "Soy alérgico/a a…", pronunciation: "soy ah-LEHR-hee-koh ah" },
      { intent: "Call the police", local: "Llame a la policía", pronunciation: "YAH-meh ah lah poh-lee-SEE-ah" },
    ],
    connectivityTips: "Personal, Claro, and Movistar sell prepaid SIMs. Coverage good in Buenos Aires, limited in Patagonia. Free Wi-Fi in BA subway stations and many cafés.",
  },
  {
    country: "Brazil",
    countryCode: "BR",
    emergencyNumber: "190",
    ambulanceNumber: "192",
    emergencyNotes: "190 for police, 192 for SAMU ambulance, 193 for fire. English support is very limited.",
    languages: ["Portuguese"],
    phrases: [
      { intent: "I need a doctor", local: "Preciso de um médico", pronunciation: "preh-SEE-zoo djee oom MEH-djee-koo" },
      { intent: "I need help", local: "Preciso de ajuda", pronunciation: "preh-SEE-zoo djee ah-ZHOO-dah" },
      { intent: "Where is the hospital?", local: "Onde fica o hospital?", pronunciation: "OHN-djee FEE-kah oo ohsh-pee-TAU" },
      { intent: "I'm allergic to…", local: "Sou alérgico/a a…", pronunciation: "soh ah-LEHR-zhee-koo ah" },
      { intent: "Call the police", local: "Chame a polícia", pronunciation: "SHAH-mee ah poo-LEE-see-ah" },
    ],
    connectivityTips: "Claro, Vivo, and TIM sell prepaid SIMs. CPF (tax number) sometimes required — airport shops often waive this for tourists. 4G coverage good in cities.",
  },
];

// ── City → country resolution ───────────────────────────────────────────────

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const CITY_COUNTRY: Record<string, string> = {
  // Spain
  madrid: "ES", barcelona: "ES", seville: "ES", sevilla: "ES",
  valencia: "ES", malaga: "ES", bilbao: "ES", "san sebastian": "ES",
  granada: "ES", tenerife: "ES", "las palmas": "ES", ibiza: "ES",
  // France
  paris: "FR", lyon: "FR", nice: "FR", marseille: "FR",
  bordeaux: "FR", strasbourg: "FR",
  // Italy
  rome: "IT", roma: "IT", milan: "IT", milano: "IT",
  florence: "IT", firenze: "IT", venice: "IT", venezia: "IT",
  naples: "IT", napoli: "IT", amalfi: "IT",
  // Germany
  berlin: "DE", munich: "DE", munchen: "DE", hamburg: "DE",
  frankfurt: "DE", cologne: "DE", koln: "DE",
  // UK
  london: "GB", edinburgh: "GB", manchester: "GB",
  // Japan
  tokyo: "JP", osaka: "JP", kyoto: "JP",
  // South Korea
  seoul: "KR", busan: "KR",
  // Thailand
  bangkok: "TH", "chiang mai": "TH", phuket: "TH",
  // Portugal
  lisbon: "PT", lisboa: "PT", porto: "PT",
  // Netherlands
  amsterdam: "NL",
  // Turkey
  istanbul: "TR",
  // Mexico
  "mexico city": "MX", "ciudad de mexico": "MX", cancun: "MX", tulum: "MX",
  // USA
  "new york": "US", "los angeles": "US", miami: "US",
  "san francisco": "US", chicago: "US", "las vegas": "US",
  // Argentina
  "buenos aires": "AR",
  // Brazil
  "sao paulo": "BR", rio: "BR", "rio de janeiro": "BR",
};

/**
 * Find emergency info for a city name.
 * Tries exact match, then before comma/dash, then first/last word.
 */
export function findEmergencyInfo(city: string | undefined): CountryEmergencyInfo | undefined {
  if (!city?.trim()) return undefined;

  const norm = normalize(city);
  const candidates = [
    norm,
    norm.split(/[,\-–—]/)[0].trim(),
    ...norm.split(/\s+/),
  ];

  for (const candidate of candidates) {
    const countryCode = CITY_COUNTRY[candidate];
    if (countryCode) {
      return EMERGENCY_DATA.find((e) => e.countryCode === countryCode);
    }
  }

  return undefined;
}
