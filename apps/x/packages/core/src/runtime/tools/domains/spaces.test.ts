import { describe, expect, it } from "vitest";
import { blobFilename, mimeForFilename, parseBlobLink } from "./spaces.js";

const HASH = "a".repeat(64);
const SPACE = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

describe("parseBlobLink", () => {
    it("parses the canonical grammar with a name", () => {
        expect(
            parseBlobLink(`https://acme.rowboat.space/s/${SPACE}/b/${HASH}?name=shot%20one.png`),
        ).toEqual({ address: "acme.rowboat.space", spaceId: SPACE, hash: HASH, name: "shot one.png" });
    });

    it("parses without a query, and dev http addresses with ports", () => {
        expect(parseBlobLink(`http://localhost:4272/s/${SPACE}/b/${HASH}`)).toEqual({
            address: "localhost:4272",
            spaceId: SPACE,
            hash: HASH,
        });
    });

    it("rejects non-blob links and malformed hashes", () => {
        expect(parseBlobLink(`https://acme.test/s/${SPACE}/f/notes.md`)).toBeNull();
        expect(parseBlobLink(`https://acme.test/s/${SPACE}/b/deadbeef`)).toBeNull();
        expect(parseBlobLink("not a url")).toBeNull();
    });
});

describe("blobFilename", () => {
    it("keeps a named file's extension and strips hostile characters", () => {
        expect(blobFilename('q3: "final" report.pdf', HASH, "application/pdf")).toBe("q3 final report.pdf");
    });

    it("appends an extension from the mime when the name has none", () => {
        expect(blobFilename("screenshot", HASH, "image/png")).toBe("screenshot.png");
    });

    it("falls back to a hash prefix, with an extension when the mime is known", () => {
        expect(blobFilename(undefined, HASH, "image/jpeg")).toBe(`${HASH.slice(0, 12)}.jpg`);
        expect(blobFilename(undefined, HASH, "application/x-mystery")).toBe(HASH.slice(0, 12));
    });

    it("never lets a name traverse directories", () => {
        expect(blobFilename("../../etc/passwd", HASH, "text/plain")).toBe("passwd.txt");
    });
});

describe("mimeForFilename", () => {
    it("maps well-known extensions and passes on the rest", () => {
        expect(mimeForFilename("chart.png")).toBe("image/png");
        expect(mimeForFilename("photo.JPEG")).toBe("image/jpeg");
        expect(mimeForFilename("archive.tar.zst")).toBeUndefined();
        expect(mimeForFilename("noext")).toBeUndefined();
    });
});
