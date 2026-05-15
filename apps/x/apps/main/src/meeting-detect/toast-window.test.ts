import { describe, it, expect } from "vitest";
import { buildToastHtml } from "./toast-window.js";

describe("buildToastHtml", () => {
    it("renders title, message, action label, and a primary link to the rowboat deeplink", () => {
        const html = buildToastHtml({
            title: "You're in a meeting",
            message: "Detected on Google Meet. Click to take notes.",
            actionLabel: "Take notes",
            actionLink: "rowboat://action?type=take-meeting-notes&title=Meeting%20Notes%20-%20Meet",
        });

        expect(html).toContain("You&#39;re in a meeting");
        expect(html).toContain("Detected on Google Meet");
        expect(html).toContain("Take notes");
        expect(html).toContain("rowboat://action?type=take-meeting-notes");
    });

    it("includes a dismiss link the window will intercept", () => {
        const html = buildToastHtml({
            title: "x", message: "y", actionLabel: "Go", actionLink: "rowboat://action",
        });
        expect(html).toContain("rowboat-toast://dismiss");
    });

    it("escapes HTML in title/message so a Meet titled `<script>` can't break the toast", () => {
        const html = buildToastHtml({
            title: "<script>alert(1)</script>",
            message: "& < > \" '",
            actionLabel: "ok",
            actionLink: "rowboat://action",
        });
        expect(html).not.toContain("<script>alert(1)</script>");
        expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
        expect(html).toContain("&amp; &lt; &gt; &quot; &#39;");
    });

    it("escapes the action link so a malicious title in the URL can't break out of the href quotes", () => {
        const html = buildToastHtml({
            title: "x", message: "y", actionLabel: "ok",
            actionLink: `rowboat://action?title=evil"onerror=alert(1)`,
        });
        expect(html).not.toContain(`"onerror=alert(1)`);
        expect(html).toContain("&quot;onerror=alert(1)");
    });
});
