import { chatRepository, type RecentChatMessage, type RecentChatMessagesQuery } from "@core/src/features/chats/infrastructure/chat-repository";

export type { RecentChatMessage, RecentChatMessagesQuery };

/** The messages of a chat just before a message, for the reader's context; see `chatRepository.findRecentChatMessages`. */
export const findRecentChatMessages = (query: RecentChatMessagesQuery) => chatRepository.findRecentChatMessages(query);
