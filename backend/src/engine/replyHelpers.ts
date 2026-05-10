import { ChatReply, Locale } from '../types/index.js';

export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  tl: 'Filipino (Tagalog)',
  vi: 'Vietnamese',
};

export const GROUNDED_FALLBACKS: Record<Locale, string> = {
  en: 'I cannot verify that from the provided guidance. Call 911 or contact local emergency responders.',
  tl: 'Hindi ko ma-verify iyon mula sa gabay. Tumawag sa 911 o sa lokal na emergency responders.',
  vi: 'Tôi không thể xác minh điều đó từ hướng dẫn được cung cấp. Hãy gọi 911 hoặc lực lượng ứng cứu địa phương.',
};

export const SMS_GROUNDED_FALLBACKS: Record<Locale, string> = {
  en: 'Cannot verify from guidance. Call 911 or local emergency responders.',
  tl: 'Hindi ma-verify sa gabay. Tumawag sa 911 o local responders.',
  vi: 'Không thể xác minh từ hướng dẫn. Gọi 911 hoặc đội ứng cứu địa phương.',
};

export function casualReply(locale: Locale): ChatReply {
  const replies: Record<Locale, string> = {
    en: "I'm here and ready. Ask me about weather, alerts, evacuation, or emergency first aid.",
    tl: 'Nandito ako at handa. Magtanong tungkol sa panahon, alerto, evacuation, o emergency first aid.',
    vi: 'Tôi sẵn sàng. Hãy hỏi về thời tiết, cảnh báo, sơ tán hoặc sơ cứu khẩn cấp.',
  };
  return {
    reply: replies[locale],
    suggestedCommands: ['Check conditions', 'Find evac center'],
  };
}

export function outOfScopeReply(locale: Locale): ChatReply {
  const replies: Record<Locale, string> = {
    en: "I'm built for real-world disaster readiness, local alerts, evacuation, and emergency first aid. I can't help with that here.",
    tl: 'Nakatuon ako sa disaster readiness at emergency guidance, kaya hindi ko ma-verify ang general trivia rito. Magtanong tungkol sa local conditions, evacuation, o first aid.',
    vi: 'Tôi tập trung vào sẵn sàng ứng phó thiên tai và hướng dẫn khẩn cấp, nên không xác minh câu hỏi kiến thức chung ở đây. Hãy hỏi về điều kiện địa phương, sơ tán hoặc sơ cứu.',
  };
  return {
    reply: replies[locale],
    suggestedCommands: ['Check conditions', 'Find evac center'],
  };
}

export function unsupportedEmergencyReply(locale: Locale): ChatReply {
  const replies: Record<Locale, string> = {
    en: "I don't have verified guidance for that injury in this app. If it's severe, worsening, or you're worried, contact local emergency responders or call 911.",
    tl: 'Wala akong verified na gabay para sa injury na iyon sa app na ito. Kung malubha, lumalala, o nag-aalala ka, tumawag sa 911 o local emergency responders.',
    vi: 'Tôi không có hướng dẫn đã xác minh cho chấn thương đó trong ứng dụng này. Nếu nghiêm trọng, nặng hơn hoặc bạn lo lắng, hãy gọi 911 hoặc đội ứng cứu địa phương.',
  };
  return {
    reply: replies[locale],
    suggestedCommands: ['Call 911', 'Check conditions'],
  };
}

export function smsOutOfScopeReply(locale: Locale): string {
  const replies: Record<Locale, string> = {
    en: "MonsoonAI handles real-world alerts, evacuation, and emergency first aid. I can't help with that here.",
    tl: 'Para sa real-world alerts, evacuation, at first aid ang MonsoonAI. Hindi ako makakatulong diyan dito.',
    vi: 'MonsoonAI hỗ trợ cảnh báo thực tế, sơ tán và sơ cứu khẩn cấp. Tôi không thể hỗ trợ việc đó ở đây.',
  };
  return replies[locale];
}

export function smsUnsupportedEmergencyReply(locale: Locale): string {
  const replies: Record<Locale, string> = {
    en: 'No verified guidance for that injury here. If severe or worsening, call 911 or local responders.',
    tl: 'Walang verified guide para diyan. Kung malubha o lumalala, tumawag sa 911 o local responders.',
    vi: 'Không có hướng dẫn xác minh cho chấn thương đó. Nếu nặng hơn, gọi 911 hoặc đội ứng cứu.',
  };
  return replies[locale];
}
