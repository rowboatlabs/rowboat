import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrefixLogger } from "./prefix-logger.js";

describe("PrefixLogger", () => {
  const FIXED_TIMESTAMP = "2026-01-01T00:00:00.000Z";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_TIMESTAMP));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("root logger (no parent)", () => {
    it("logs with prefix, timestamp, and args", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = new PrefixLogger("app");

      logger.log("Hello");

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(
        FIXED_TIMESTAMP,
        "[app]",
        "Hello",
      );
    });

    it("logs multiple arguments", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = new PrefixLogger("test");

      logger.log("a", 42, { key: "value" });

      expect(spy).toHaveBeenCalledWith(
        FIXED_TIMESTAMP,
        "[test]",
        "a",
        42,
        { key: "value" },
      );
    });

    it("logs with no additional args", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = new PrefixLogger("alone");

      logger.log();

      expect(spy).toHaveBeenCalledWith(
        FIXED_TIMESTAMP,
        "[alone]",
      );
    });
  });

  describe("child logger", () => {
    it("creates a child logger that delegates to the parent", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const parent = new PrefixLogger("parent");
      const child = parent.child("child");

      child.log("message");

      // Parent receives child's prefix first, then the args
      expect(spy).toHaveBeenCalledWith(
        FIXED_TIMESTAMP,
        "[parent]",
        "[child]",
        "message",
      );
    });

    it("supports multiple levels of nesting", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const root = new PrefixLogger("root");
      const mid = root.child("mid");
      const leaf = mid.child("leaf");

      leaf.log("deep");

      expect(spy).toHaveBeenCalledWith(
        FIXED_TIMESTAMP,
        "[root]",
        "[mid]",
        "[leaf]",
        "deep",
      );
    });

    it("child of root logs correctly with multiple args", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const root = new PrefixLogger("app");
      const child = root.child("sub");

      child.log("info", 123, true);

      expect(spy).toHaveBeenCalledWith(
        FIXED_TIMESTAMP,
        "[app]",
        "[sub]",
        "info",
        123,
        true,
      );
    });
  });

  describe("prefix formatting", () => {
    it("wraps prefix in brackets", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = new PrefixLogger("my-component");

      logger.log("test");

      expect(spy).toHaveBeenCalledWith(
        FIXED_TIMESTAMP,
        "[my-component]",
        "test",
      );
    });

    it("handles empty string prefix", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = new PrefixLogger("");

      logger.log("test");

      expect(spy).toHaveBeenCalledWith(
        FIXED_TIMESTAMP,
        "[]",
        "test",
      );
    });

    it("handles prefix with special characters", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = new PrefixLogger("test@#$");

      logger.log("test");

      expect(spy).toHaveBeenCalledWith(
        FIXED_TIMESTAMP,
        "[test@#$]",
        "test",
      );
    });
  });

  describe("independence", () => {
    it("sibling loggers do not interfere with each other", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const root = new PrefixLogger("root");
      const a = root.child("a");
      const b = root.child("b");

      a.log("from-a");
      b.log("from-b");

      expect(spy).toHaveBeenNthCalledWith(
        1,
        FIXED_TIMESTAMP,
        "[root]",
        "[a]",
        "from-a",
      );
      expect(spy).toHaveBeenNthCalledWith(
        2,
        FIXED_TIMESTAMP,
        "[root]",
        "[b]",
        "from-b",
      );
    });

    it("logs from the root do not affect child recording", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const root = new PrefixLogger("root");
      const child = root.child("child");

      root.log("root-only");
      child.log("child-only");

      expect(spy).toHaveBeenNthCalledWith(
        1,
        FIXED_TIMESTAMP,
        "[root]",
        "root-only",
      );
      expect(spy).toHaveBeenNthCalledWith(
        2,
        FIXED_TIMESTAMP,
        "[root]",
        "[child]",
        "child-only",
      );
    });
  });
});
