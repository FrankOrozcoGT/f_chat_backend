const WHATSAPP_SUFFIX = '@s.whatsapp.net';
const LEGACY_SUFFIX = '@c.us';

/** Extrae el número de teléfono de un JID de WhatsApp (individual, no de grupo). */
export function phoneFromJid(jid: string): string {
  return jid.replace(WHATSAPP_SUFFIX, '').replace(LEGACY_SUFFIX, '');
}

/** Construye el JID de WhatsApp de un número de teléfono individual. */
export function jidFromPhone(phoneNumber: string): string {
  return `${phoneNumber}${WHATSAPP_SUFFIX}`;
}

/** true si el JID corresponde a un contacto individual (no un grupo, broadcast, etc). */
export function isIndividualJid(jid: string | null | undefined): boolean {
  return !!jid && jid.endsWith(WHATSAPP_SUFFIX);
}
