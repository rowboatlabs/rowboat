import { describe, expect, it } from "vitest";
import { ChatActivity } from "./chat-activity.js";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("ChatActivity", () => {
    it("resolves waiters immediately when idle", async () => {
        const activity = new ChatActivity();
        await activity.waitUntilIdle();
        expect(activity.activeCount).toBe(0);
    });

    it("blocks waiters until every active chat exits", async () => {
        const activity = new ChatActivity();
        activity.enter();
        activity.enter();

        let released = false;
        const waiting = activity.waitUntilIdle().then(() => {
            released = true;
        });

        activity.exit();
        await tick();
        expect(released).toBe(false);

        activity.exit();
        await waiting;
        expect(released).toBe(true);
    });

    it("wakes all pending waiters at once", async () => {
        const activity = new ChatActivity();
        activity.enter();
        const results: number[] = [];
        const a = activity.waitUntilIdle().then(() => results.push(1));
        const b = activity.waitUntilIdle().then(() => results.push(2));
        activity.exit();
        await Promise.all([a, b]);
        expect(results.sort()).toEqual([1, 2]);
    });

    it("tolerates unbalanced exits", () => {
        const activity = new ChatActivity();
        activity.exit();
        expect(activity.activeCount).toBe(0);
        activity.enter();
        expect(activity.activeCount).toBe(1);
    });
});
