import { z } from "zod";

export const TodoStatusSchema = z.enum(["pending", "in_progress", "done", "blocked"]);

export type TodoStatus = z.infer<typeof TodoStatusSchema>;

export type TodoItem = {
    id: string;
    content: string;
    status: TodoStatus;
};

export type TodoState = {
    todos: TodoItem[];
    updatedAt: string;
};

const defaultTodoState: TodoState = {
    todos: [],
    updatedAt: new Date(0).toISOString(),
};

const todoStateStack: TodoState[] = [{ ...defaultTodoState }];

const currentState = (): TodoState => todoStateStack[todoStateStack.length - 1];

export async function readTodoState(): Promise<TodoState> {
    return currentState();
}

export async function writeTodoState(todos: TodoItem[]): Promise<TodoState> {
    const updated = {
        todos: sanitiseTodos(todos),
        updatedAt: new Date().toISOString(),
    };
    todoStateStack[todoStateStack.length - 1] = updated;
    return updated;
}

export function resetTodoState(): void {
    todoStateStack[todoStateStack.length - 1] = { ...defaultTodoState };
}

export function pushTodoState(initialState?: TodoState): void {
    todoStateStack.push(initialState ? { ...initialState } : { ...defaultTodoState });
}

export function popTodoState(): void {
    if (todoStateStack.length > 1) {
        todoStateStack.pop();
    } else {
        todoStateStack[0] = { ...defaultTodoState };
    }
}

export function sanitiseTodos(todos: TodoItem[]): TodoItem[] {
    const seen = new Set<string>();
    const sanitized: TodoItem[] = [];
    for (const todo of todos) {
        if (!todo) continue;
        const id = typeof todo.id === "string" ? todo.id.trim() : "";
        const content = typeof todo.content === "string" ? todo.content : "";
        const statusResult = TodoStatusSchema.safeParse(todo.status);
        const status = statusResult.success ? statusResult.data : "pending";
        if (!id || !content || seen.has(id)) {
            continue;
        }
        seen.add(id);
        sanitized.push({ id, content, status });
    }
    return sanitized;
}

export function buildTodoReminder(todos: TodoItem[], preface: string) {
    return `<system-reminder>\n${preface}\n\n${JSON.stringify(todos)}\n</system-reminder>`;
}
