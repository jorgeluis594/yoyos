/** The library gives neither push name nor phone in v1, so a chat is shown by an abbreviated LID. */
export function abbreviateLid(chatId: string): string {
  const digits = chatId.split("@")[0] ?? chatId;
  return digits.length <= 4 ? digits : `…${digits.slice(-4)}`;
}
