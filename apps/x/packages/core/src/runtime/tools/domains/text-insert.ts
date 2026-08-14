// Builtin tools: ghostwriter domain — paste text at the user's cursor in
// whatever app they're looking at.

import { z } from "zod";
import { BuiltinToolsSchema } from "../types.js";
import type { ITextInsertService } from "../../../application/text-insert/service.js";

async function resolveService(): Promise<ITextInsertService | null> {
    try {
        const { lazyResolve } = await import("../../../di/lazy-resolve.js");
        return await lazyResolve<ITextInsertService>("textInsertService");
    } catch {
        return null;
    }
}

export const textInsertTools: z.infer<typeof BuiltinToolsSchema> = {
    "paste-at-cursor": {
        // Writing into another app is a real-world act — always gated. The
        // auto-permission judge keeps voice flow smooth; manual mode gets
        // the card.
        permission: "prompt",
        description:
            "Type text at the user's cursor in the app they are looking at (their email compose box, a doc, a chat field). Use ONLY when the user asked you to write/insert/paste something into what's on their screen. The `text` you pass is EXACTLY what gets typed — the user's words, ready to send under their name: no narration, no preamble like 'Here's your email', no markdown fences, no sign-offs they didn't ask for. When the user is DICTATING (their utterance is the content itself, not an instruction), preserve their wording — fix punctuation and drop filler words, change nothing else. Say any commentary in your reply instead — and after a successful paste, almost none is needed: the user WATCHES the text land, so confirm in a word or two ("Done.") and never describe or repeat what you pasted. This pastes and STOPS — it never presses Enter, never clicks Send; submitting stays the user's act. ON FAILURE the text is left on the user's clipboard: relay the error's guidance in one line, then include the EXACT text in your reply inside a fenced code block so the user can also copy it manually — never just apologize with the words lost.",
        inputSchema: z.object({
            text: z.string().min(1).describe("The exact text to type at the cursor — the payload only, nothing else."),
        }),
        execute: async ({ text }: { text: string }) => {
            const service = await resolveService();
            if (!service || !service.isSupported()) {
                return { success: false, error: "Typing into other apps isn't available on this platform." };
            }
            const result = await service.insert(text);
            return result.ok
                ? { success: true, app: result.app, pastedChars: text.length }
                : {
                      success: false,
                      error: result.error,
                      // The payload survives every failure: it's on the
                      // clipboard, and echoing it here lets the model show
                      // it as copyable text in its reply.
                      textOnClipboard: true,
                      text,
                  };
        },
        isAvailable: async () => {
            const service = await resolveService();
            return !!service && service.isSupported();
        },
    },
};
