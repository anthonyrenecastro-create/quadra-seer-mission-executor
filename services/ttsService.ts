// NOTE (Phase 1 hardening): the browser must never hold an API key.
// TTS is proxied through the backend (/api/tts/gemini), which uses the
// server-side key. The previous direct-to-Gemini call (VITE_GEMINI_API_KEY)
// has been removed.

export const GEMINI_TTS_VOICES = [
    'Zephyr',
    'Puck',
    'Charon',
    'Kore',
    'Fenrir',
] as const;

export type TtsVoice = typeof GEMINI_TTS_VOICES[number];

export const DEFAULT_TTS_VOICE: TtsVoice = 'Zephyr';

export const prepareSpeechText = (text: string): string => {
    if (!text) return '';

    const normalized = text
        .replace(/\r\n/g, '\n')
        .replace(/[•·◦▪︎]/g, '\n')
        .replace(/\u00a0/g, ' ');

    const expandUrls = normalized
        .replace(/https?:\/\/[^\s)]+/gi, (url) => {
            const spoken = url
                .replace(/^https?:\/\//i, '')
                .replace(/\/+/g, ' slash ')
                .replace(/\./g, ' dot ')
                .replace(/-/g, ' dash ')
                .replace(/_/g, ' underscore ')
                .replace(/\?/g, ' question mark ')
                .replace(/&/g, ' and ')
                .replace(/=/g, ' equals ')
                .replace(/#/g, ' number sign ')
                .replace(/%20/gi, ' space ')
                .replace(/\s+/g, ' ')
                .trim();
            return `link ${spoken}`;
        })
        .replace(/\bwww\.[^\s)]+/gi, (url) => {
            const spoken = url
                .replace(/^www\./i, 'double u double u double u dot ')
                .replace(/\/+/g, ' slash ')
                .replace(/\./g, ' dot ')
                .replace(/-/g, ' dash ')
                .replace(/_/g, ' underscore ')
                .replace(/\?/g, ' question mark ')
                .replace(/&/g, ' and ')
                .replace(/=/g, ' equals ')
                .replace(/#/g, ' number sign ')
                .replace(/\s+/g, ' ')
                .trim();
            return `link ${spoken}`;
        });

    const withoutCodeFences = expandUrls
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, '$1');

    const withoutMarkdown = withoutCodeFences
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')
        .replace(/^\s{0,3}[-*+]\s+/gm, '')
        .replace(/^\s{0,3}>\s+/gm, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/__(.*?)__/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/_(.*?)_/g, '$1')
        .replace(/~~(.*?)~~/g, '$1');

    const spacedSymbols = withoutMarkdown
        .replace(/([A-Za-z0-9])\/([A-Za-z0-9])/g, '$1 $2')
        .replace(/([A-Za-z0-9])-([A-Za-z0-9])/g, '$1 $2')
        .replace(/([A-Za-z])#([A-Za-z0-9])/g, '$1 $2')
        .replace(/([A-Za-z0-9])\.([A-Za-z0-9])/g, '$1 $2');

    const strippedSymbols = spacedSymbols
        .replace(/[\/#*\-_]|\.{3,}|[\[\]{}()<>|~^=+]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const explicitAcronyms: Record<string, string> = {
        API: 'A P I',
        AI: 'A I',
        URL: 'you are el',
        URLs: 'you are el s',
        HTTP: 'H T T P',
        HTTPS: 'H T T P S',
        JSON: 'J S O N',
        XML: 'X M L',
        CSV: 'C S V',
        GPU: 'G P U',
        CPU: 'C P U',
        TTS: 'T T S',
        LLM: 'L L M',
        ML: 'M L',
        UX: 'U X',
        UI: 'U I',
        FAQ: 'F A Q',
        SDK: 'S D K',
        CLI: 'C L I',
        DB: 'D B',
        SQL: 'S Q L',
        ID: 'I D',
        PDF: 'P D F',
        TSX: 'T S X',
        JSX: 'J S X',
    };

    const expandedAcronyms = strippedSymbols
        .replace(/\b(API|AI|URL|URLs|HTTP|HTTPS|JSON|XML|CSV|GPU|CPU|TTS|LLM|ML|UX|UI|FAQ|SDK|CLI|DB|SQL|ID|PDF|TSX|JSX)\b/g, (match) => {
            return explicitAcronyms[match] || match.split('').join(' ');
        })
        .replace(/\b([A-Z]{2,})s\b/g, (_, letters: string) => `${letters.split('').join(' ')} s`)
        .replace(/\b([A-Z]{2,})\b/g, (match) => match.split('').join(' '));

    return expandedAcronyms;
};

/**
 * Fetches audio data for the given text using Gemini native TTS.
 * @param text The text to convert to speech.
 * @param voiceName Optional voice override for Gemini native TTS.
 * @returns Base64 string of PCM audio data.
 */
export const textToSpeechStream = async (
    text: string,
    voiceName: TtsVoice = DEFAULT_TTS_VOICE,
): Promise<string | null> => {
    try {
        const speechText = prepareSpeechText(text);
        if (!speechText) return null;

        const res = await fetch('/api/tts/gemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: speechText, voiceName }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.audio || null;

    } catch (error) {
        console.error("[TTS Service] Error:", error);
        return null;
    }
};