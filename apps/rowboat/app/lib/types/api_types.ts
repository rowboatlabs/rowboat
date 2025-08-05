import { Message } from "./types";
import { Turn } from "@/src/entities/models/turn";
import { z } from "zod";

export const ApiRequest = z.object({
    messages: z.array(Message),
    conversationId: z.string().nullable().optional(),
    mockTools: z.record(z.string(), z.string()).nullable().optional(),
    stream: z.boolean().optional().nullable().default(false),
});export const ApiResponse = z.object({
    turn: Turn,
    conversationId: z.string().optional(),
});

