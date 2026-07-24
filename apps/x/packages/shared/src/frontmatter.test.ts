import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "./frontmatter.js";

describe("parseFrontmatter", () => {
  describe("no frontmatter", () => {
    it("returns empty fields and the full body for plain markdown", () => {
      const md = "# Hello\n\nThis is content.";
      expect(parseFrontmatter(md)).toEqual({ fields: {}, body: md });
    });

    it("returns empty fields and the full body for an empty string", () => {
      expect(parseFrontmatter("")).toEqual({ fields: {}, body: "" });
    });

    it("returns empty fields for content that starts with --- but has no closing delimiter", () => {
      const md = "---\ntitle: Hello\nno closing delimiter here";
      expect(parseFrontmatter(md)).toEqual({ fields: {}, body: md });
    });

    it("returns empty fields for a bare opening --- with trailing newline but no content", () => {
      const md = "---\n";
      expect(parseFrontmatter(md)).toEqual({ fields: {}, body: md });
    });

    it("returns empty fields for a lone --- without trailing newline", () => {
      const md = "---";
      expect(parseFrontmatter(md)).toEqual({ fields: {}, body: md });
    });
  });

  describe("basic key-value frontmatter", () => {
    it("parses a single key-value pair", () => {
      const md = "---\ntitle: Hello\n---\nBody text";
      expect(parseFrontmatter(md)).toEqual({
        fields: { title: "Hello" },
        body: "Body text",
      });
    });

    it("parses multiple key-value pairs", () => {
      const md = "---\ntitle: Hello World\ndate: 2024-01-15\n---\nContent";
      expect(parseFrontmatter(md)).toEqual({
        fields: { title: "Hello World", date: "2024-01-15" },
        body: "Content",
      });
    });

    it("strips whitespace around values", () => {
      const md = "---\ntitle:   Hello   \n---\nBody";
      expect(parseFrontmatter(md).fields).toEqual({ title: "Hello" });
    });

    it("handles values with colons", () => {
      const md = "---\ntitle: Hello: World\n---\nBody";
      expect(parseFrontmatter(md).fields).toEqual({ title: "Hello: World" });
    });

    it("handles keys with spaces", () => {
      const md = "---\nmy title: Hello\n---\nBody";
      expect(parseFrontmatter(md).fields).toEqual({ "my title": "Hello" });
    });

    it("handles single-word keys", () => {
      const md = "---\na: b\n---\nBody";
      expect(parseFrontmatter(md).fields).toEqual({ a: "b" });
    });
  });

  describe("empty values", () => {
    it("treats an empty value as the start of a list", () => {
      const md = "---\ntags:\n---\nBody";
      expect(parseFrontmatter(md).fields).toEqual({ tags: [] });
    });

    it("treats a key with trailing whitespace but no value as a list start", () => {
      const md = "---\ntags: \n---\nBody";
      expect(parseFrontmatter(md).fields).toEqual({ tags: [] });
    });
  });

  describe("list values", () => {
    it("parses a list of items", () => {
      const md = "---\ntags:\n  - one\n  - two\n  - three\n---\nBody";
      expect(parseFrontmatter(md).fields).toEqual({
        tags: ["one", "two", "three"],
      });
    });

    it("trims whitespace from list items", () => {
      const md = "---\ntags:\n  -   spaced   \n  -   item  \n---\nBody";
      expect(parseFrontmatter(md).fields).toEqual({
        tags: ["spaced", "item"],
      });
    });

    it("handles mixed key-value and list frontmatter", () => {
      const md =
        "---\ntitle: Hello\ndate: 2024-01-15\ntags:\n  - a\n  - b\n---\nBody";
      expect(parseFrontmatter(md).fields).toEqual({
        title: "Hello",
        date: "2024-01-15",
        tags: ["a", "b"],
      });
    });

    it("handles multiple list keys", () => {
      const md = "---\ntags:\n  - one\n  - two\ncategories:\n  - x\n  - y\n---\nBody";
      expect(parseFrontmatter(md).fields).toEqual({
        tags: ["one", "two"],
        categories: ["x", "y"],
      });
    });

    it("does not confuse a non-list indented line with a list item", () => {
      const md = "---\ntags:\n  not a list item\n---\nBody";
      expect(parseFrontmatter(md).fields).toEqual({ tags: [] });
    });
  });

  describe("body extraction", () => {
    it("returns the body after the closing ---", () => {
      const md = "---\ntitle: Hello\n---\n# Section\n\nSome text";
      expect(parseFrontmatter(md).body).toBe("# Section\n\nSome text");
    });

    it("returns empty body when frontmatter is immediately followed by end of string", () => {
      const md = "---\ntitle: Hello\n---";
      expect(parseFrontmatter(md).body).toBe("");
    });

    it("strips the first leading newline from the body but keeps the second", () => {
      const md = "---\ntitle: Hello\n---\n\nBody with leading blank line";
      // After closing --- there are two newlines (line end + blank line);
      // the function strips only the first \n from the body.
      expect(parseFrontmatter(md).body).toBe("\nBody with leading blank line");
    });

    it("strips the first leading newline and keeps multiple remaining", () => {
      const md = "---\ntitle: Hello\n---\n\n\nBody with two leading blank lines";
      // After closing --- there are three newlines (line end + two blank lines);
      // the function strips only the first \n, leaving two.
      expect(parseFrontmatter(md).body).toBe("\n\nBody with two leading blank lines");
    });

    it("handles body with no newline after closing ---", () => {
      const md = "---\ntitle: Hello\n---Body without newline";
      expect(parseFrontmatter(md).body).toBe("Body without newline");
    });
  });

  describe("edge cases", () => {
    it("handles empty frontmatter block (---\\n---)", () => {
      const md = "---\n---\nBody";
      expect(parseFrontmatter(md)).toEqual({
        fields: {},
        body: "Body",
      });
    });

    it("handles --- in the body content (only first closing matters)", () => {
      const md = "---\ntitle: Hello\n---\nBody with --- in it";
      expect(parseFrontmatter(md).fields).toEqual({ title: "Hello" });
      expect(parseFrontmatter(md).body).toBe("Body with --- in it");
    });

    it("strips blank lines within the frontmatter block", () => {
      const md = "---\ntitle: Hello\n\ndate: 2024-01-15\n---\nBody";
      expect(parseFrontmatter(md).fields).toEqual({
        title: "Hello",
        date: "2024-01-15",
      });
    });

    it("handles a single field with a numeric value as a string", () => {
      const md = "---\nversion: 42\n---\nBody";
      expect(parseFrontmatter(md).fields).toEqual({ version: "42" });
    });

    it("handles boolean-looking values as strings", () => {
      const md = "---\npublished: true\nfeatured: false\n---\nBody";
      expect(parseFrontmatter(md).fields).toEqual({
        published: "true",
        featured: "false",
      });
    });
  });
});
