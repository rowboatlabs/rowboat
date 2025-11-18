import * as fs from "fs/promises";
import * as path from "path";
import { CopilotDataDir } from "../../config/config.js";
import { buildTodoReminder, readTodoState } from "../../lib/todo-store.js";

const REMINDERS_FILE = path.join(CopilotDataDir, "reminders.json");

type ReminderState = {
    lastSent: Record<string, string>;
    lastTodoToolUse?: string;
};

const defaultState: ReminderState = {
    lastSent: {},
};

const TODO_TOOL_NAMES = new Set(["todoList", "todoWrite", "todoUpdate"]);

const ReminderCooldownMs: Record<string, number> = {
    "todo-empty": 15 * 60 * 1000,
    "todo-review": 10 * 60 * 1000,
};

const TodoEngagementThresholdMs = 10 * 60 * 1000; // remind if todo tools unused for 10+ minutes while todos exist

async function loadState(): Promise<ReminderState> {
    try {
        const raw = await fs.readFile(REMINDERS_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        return {
            lastSent: typeof parsed.lastSent === "object" && parsed.lastSent !== null ? parsed.lastSent : {},
            lastTodoToolUse: typeof parsed.lastTodoToolUse === "string" ? parsed.lastTodoToolUse : undefined,
        };
    } catch {
        return { ...defaultState };
    }
}

async function saveState(state: ReminderState) {
    await fs.mkdir(path.dirname(REMINDERS_FILE), { recursive: true });
    await fs.writeFile(REMINDERS_FILE, JSON.stringify(state, null, 2), "utf-8");
}

function shouldSend(state: ReminderState, key: string): boolean {
    const cooldown = ReminderCooldownMs[key] ?? 5 * 60 * 1000;
    const lastSent = state.lastSent[key];
    if (!lastSent) return true;
    const elapsed = Date.now() - new Date(lastSent).getTime();
    return elapsed >= cooldown;
}

export type ReminderContext = {
    source: "tool-result" | "message";
    toolName?: string;
};

export async function collectSystemReminders(context: ReminderContext): Promise<string[]> {
    const state = await loadState();
    let hasStateChanges = false;
    const reminders: string[] = [];
    const now = new Date().toISOString();

    if (context.toolName && TODO_TOOL_NAMES.has(context.toolName)) {
        if (state.lastTodoToolUse !== now) {
            state.lastTodoToolUse = now;
            hasStateChanges = true;
        }
    } else {
        reminders.push(...await maybeAddTodoReminders(state, context));
        if (reminders.length > 0) {
            // maybeAddTodoReminders updates state timestamps internally
            hasStateChanges = true;
        }
    }

    if (hasStateChanges) {
        await saveState(state);
    }

    return reminders;
}

async function maybeAddTodoReminders(state: ReminderState, context: ReminderContext): Promise<string[]> {
    const reminders: string[] = [];
    const todoState = await readTodoState();
    const nowIso = new Date().toISOString();

    if (todoState.todos.length === 0) {
        if (shouldSend(state, "todo-empty")) {
            reminders.push(buildTodoReminder(todoState.todos, "This is a private reminder: your todo list is empty. If the current work benefits from tracking progress, use the TodoWrite tool to outline the plan."));
            state.lastSent["todo-empty"] = nowIso;
        }
        return reminders;
    }

    const lastUseTs = state.lastTodoToolUse ? new Date(state.lastTodoToolUse).getTime() : 0;
    const todoStale = Date.now() - lastUseTs >= TodoEngagementThresholdMs;
    if (todoStale && shouldSend(state, "todo-review")) {
        reminders.push(buildTodoReminder(todoState.todos, "Private reminder: review and update your todo list as you make progress. Keep this reminder internal and reflect updates via the todo tools."));
        state.lastSent["todo-review"] = nowIso;
    }

    return reminders;
}
