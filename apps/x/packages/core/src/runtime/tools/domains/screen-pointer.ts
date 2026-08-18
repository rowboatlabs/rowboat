// Builtin tools: screen-pointer domain. Lets the assistant point at things
// on the user's SHARED screen during a call — an animated overlay marker on
// the real display, driven by the Electron main process via the DI seam
// (IScreenPointerService). Only works while a screen share is live.

import { z } from "zod";
import container from "../../../di/container.js";
import type { IScreenPointerService } from "../../../application/screen-pointer/service.js";
import { BuiltinToolsSchema } from "../types.js";

export const screenPointerTools: z.infer<typeof BuiltinToolsSchema> = {
    'screen-pointer': {
        permission: "none",
        description: "Point at a spot on the user's SHARED screen during a call: an animated pointer with an optional label appears at that position on their real display. Coordinates are fractions (0-1) of the LATEST screen-share frame — x left→right, y top→bottom. Only works while the user is sharing their screen. Use it ONLY when indicating a location genuinely helps — the user asked where/which, or a spatial reference disambiguates ('this line here'). Most answers need no pointer: never point as emphasis, by habit, or on questions unrelated to what's on screen, and never when unsure of the target's position in the latest frame. action 'hide' dismisses the pointer.",
        inputSchema: z.object({
            action: z.enum(["point", "hide"]).describe("point: show the pointer at x/y. hide: dismiss it."),
            x: z.number().min(0).max(1).optional().describe("Horizontal position as a fraction of the latest screen-share frame: 0 = left edge, 1 = right edge. Required for point."),
            y: z.number().min(0).max(1).optional().describe("Vertical position as a fraction of the latest screen-share frame: 0 = top edge, 1 = bottom edge. Required for point."),
            label: z.string().max(60).optional().describe("Short caption shown next to the pointer (a few words, e.g. 'weekend dip'). Speak the explanation; keep this label tiny."),
            durationMs: z.number().int().min(1000).max(30000).optional().describe("How long the pointer stays visible before auto-hiding (default 8000)."),
        }),
        isAvailable: async () => {
            try {
                container.resolve<IScreenPointerService>('screenPointerService');
                return true;
            } catch {
                return false;
            }
        },
        execute: async (input: { action: "point" | "hide"; x?: number; y?: number; label?: string; durationMs?: number }) => {
            let service: IScreenPointerService;
            try {
                service = container.resolve<IScreenPointerService>('screenPointerService');
            } catch {
                return { success: false, action: input.action, error: 'Screen pointing is unavailable in this environment.' };
            }
            if (input.action === 'hide') {
                await service.hide();
                return { success: true, action: 'hide' };
            }
            if (typeof input.x !== 'number' || typeof input.y !== 'number') {
                return { success: false, action: 'point', error: 'point requires x and y (fractions 0-1 of the latest screen-share frame).' };
            }
            if (!service.isShareActive()) {
                return { success: false, action: 'point', error: 'No screen share is live — pointing only works while the user shares their screen. Ask them to start sharing (or check the share toggle).' };
            }
            const result = await service.point({
                x: input.x,
                y: input.y,
                ...(input.label ? { label: input.label } : {}),
                ...(input.durationMs ? { durationMs: input.durationMs } : {}),
            });
            return { ...result, action: 'point', x: input.x, y: input.y, ...(input.label ? { label: input.label } : {}) };
        },
    },
};
