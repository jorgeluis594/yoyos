import { openWhatsAppDatabase } from '@mobile/features/whatsapp/infrastructure/local-database.web';

test('web rejects WhatsApp database access without opening unencrypted storage', async () => {
  await expect(openWhatsAppDatabase()).rejects.toThrow('WhatsApp database requires a native SQLCipher build');
});
