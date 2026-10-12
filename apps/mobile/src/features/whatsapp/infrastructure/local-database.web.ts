export async function openWhatsAppDatabase(): Promise<never> {
  throw new Error('WhatsApp database requires a native SQLCipher build');
}
