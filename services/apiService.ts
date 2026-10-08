
import { Conversation, Message } from '../types';
const LEGACY_API_ERROR =
  'Legacy local conversation persistence is deprecated. Use Atlantean session + snapshot APIs from services/atlanteanService.ts.';

/** @deprecated Use Atlantean session/snapshot APIs instead. */
export const loadConversation = async (_id?: string): Promise<Conversation> => {
  throw new Error(LEGACY_API_ERROR);
};

/** @deprecated Use Atlantean session/snapshot APIs instead. */
export const saveConversation = async (_conversation: Conversation): Promise<void> => {
  throw new Error(LEGACY_API_ERROR);
};

/** @deprecated Use Atlantean snapshot delete APIs instead. */
export const deleteConversation = async (_id: string): Promise<void> => {
  throw new Error(LEGACY_API_ERROR);
};

/** @deprecated Use Atlantean listSnapshots instead. */
export const listConversations = async (): Promise<Conversation[]> => {
  throw new Error(LEGACY_API_ERROR);
};

/** @deprecated Use Atlantean export/import flows instead. */
export const shareConversation = async (_conversation: Conversation): Promise<{ shareUrl: string }> => {
  throw new Error(LEGACY_API_ERROR);
};

export const getSummary = async (messages: Message[]): Promise<string> => {
    // Phase 1 hardening: summaries are generated server-side (/api/summarize)
    // so the browser never touches an API key.
    try {
        const res = await fetch('/api/summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages }),
        });
        if (!res.ok) return "Could not generate a summary at this time.";
        const data = await res.json();
        return data.summary || "Could not generate a summary at this time.";
    } catch {
        return "Could not generate a summary at this time.";
    }
};
