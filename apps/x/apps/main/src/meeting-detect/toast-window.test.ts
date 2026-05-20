import { describe, it, expect } from "vitest";
import { buildToastHtml } from "./toast-window.js";

describe("buildToastHtml", () => {
    it("renders title, subtitle, CTA and a link to the rowboat deeplink", () => {
        const html = buildToastHtml({
            title: "You are in a meeting",
            subtitle: "Detected on Google Meet",
            actionLabel: "Start taking notes",
            actionLink: "rowboat://action?type=take-meeting-notes&title=Meeting%20Notes%20-%20Meet",
        });

        expect(html).toContain("You are in a meeting");
        expect(html).toContain("Detected on Google Meet");
        expect(html).toContain("Start taking notes");
        expect(html).toContain("rowboat://action?type=take-meeting-notes");
    });

    it("includes the rowboat wordmark and accessibility attributes", () => {
        const html = buildToastHtml({
            title: "x", subtitle: "y", actionLabel: "Go", actionLink: "rowboat://action",
        });
        expect(html).toContain(">rowboat<");
        expect(html).toContain('role="alert"');
        expect(html).toContain('aria-live="polite"');
        expect(html).toContain('aria-label="Dismiss meeting notification"');
    });

    it("includes a dismiss link the window will intercept", () => {
        const html = buildToastHtml({
            title: "x", subtitle: "y", actionLabel: "Go", actionLink: "rowboat://action",
        });
        expect(html).toContain("rowboat-toast://dismiss");
    });

    it("escapes HTML in title/subtitle so a Meet titled `<script>` can't break the toast", () => {
        const html = buildToastHtml({
            title: "<script>alert(1)</script>",
            subtitle: "& < > \" '",
            actionLabel: "ok",
            actionLink: "rowboat://action",
        });
        expect(html).not.toContain("<script>alert(1)</script>");
        expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
        expect(html).toContain("&amp; &lt; &gt; &quot; &#39;");
    });

    it("escapes the action link so a malicious title in the URL can't break out of the href quotes", () => {
        const html = buildToastHtml({
            title: "x", subtitle: "y", actionLabel: "ok",
            actionLink: `rowboat://action?title=evil"onerror=alert(1)`,
        });
        expect(html).not.toContain(`"onerror=alert(1)`);
        expect(html).toContain("&quot;onerror=alert(1)");
    });
});
