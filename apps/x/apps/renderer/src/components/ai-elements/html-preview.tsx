import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { CodeIcon, EyeIcon, MaximizeIcon, MinimizeIcon } from "lucide-react";

interface HtmlPreviewProps {
  code: string;
  className?: string;
}

const IFRAME_MIN_HEIGHT = 100;
const IFRAME_MAX_HEIGHT = 600;
const IFRAME_EXPANDED_MAX = 2000;

/**
 * Auto-height script injected into the iframe's srcdoc.
 * Posts the document height to the parent so the iframe can resize.
 */
const AUTO_HEIGHT_SCRIPT = `
<script>
(function() {
  function postHeight() {
    var h = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    );
    window.parent.postMessage({ type: '__html_preview_height__', height: h }, '*');
  }
  // Send height after load, images, and on resize
  window.addEventListener('load', postHeight);
  window.addEventListener('resize', postHeight);
  new MutationObserver(postHeight).observe(document.body, { childList: true, subtree: true, attributes: true });
  // Initial send
  if (document.readyState === 'complete') postHeight();
  else document.addEventListener('DOMContentLoaded', postHeight);
})();
</script>
`;

/**
 * Renders HTML code with a toggle between raw Code view and a live Preview
 * rendered in a sandboxed iframe (no same-origin access, no navigation, no popups).
 */
export function HtmlPreview({ code, className }: HtmlPreviewProps) {
  const [mode, setMode] = useState<"code" | "preview">("preview");
  const [expanded, setExpanded] = useState(false);
  const [iframeHeight, setIframeHeight] = useState(200);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const maxHeight = expanded ? IFRAME_EXPANDED_MAX : IFRAME_MAX_HEIGHT;

  // Listen for height messages from the iframe
  const handleMessage = useCallback(
    (e: MessageEvent) => {
      if (
        e.data?.type === "__html_preview_height__" &&
        typeof e.data.height === "number" &&
        iframeRef.current
      ) {
        // Only accept messages from our iframe
        if (e.source === iframeRef.current.contentWindow) {
          const clamped = Math.min(
            Math.max(e.data.height + 16, IFRAME_MIN_HEIGHT),
            maxHeight
          );
          setIframeHeight(clamped);
        }
      }
    },
    [maxHeight]
  );

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  // Build srcdoc: inject the auto-height script before </body> or at the end
  const srcdoc = code.includes("</body>")
    ? code.replace("</body>", `${AUTO_HEIGHT_SCRIPT}</body>`)
    : code + AUTO_HEIGHT_SCRIPT;

  return (
    <div className={cn("rounded-md border bg-muted/30 overflow-hidden", className)}>
      {/* Header bar with toggle */}
      <div className="flex items-center justify-between gap-2 border-b bg-muted/50 px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          HTML
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMode("code")}
            className={cn(
              "inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition-colors",
              mode === "code"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <CodeIcon className="size-3" />
            Code
          </button>
          <button
            type="button"
            onClick={() => setMode("preview")}
            className={cn(
              "inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition-colors",
              mode === "preview"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <EyeIcon className="size-3" />
            Preview
          </button>
          {mode === "preview" && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="ml-1 inline-flex items-center rounded px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              title={expanded ? "Collapse" : "Expand"}
            >
              {expanded ? (
                <MinimizeIcon className="size-3" />
              ) : (
                <MaximizeIcon className="size-3" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Content area */}
      {mode === "code" ? (
        <div className="overflow-x-auto p-4">
          <pre className="whitespace-pre-wrap text-xs font-mono text-foreground">
            {code}
          </pre>
        </div>
      ) : (
        <div className="relative bg-white" style={{ height: iframeHeight }}>
          <iframe
            ref={iframeRef}
            srcDoc={srcdoc}
            sandbox="allow-scripts"
            title="HTML Preview"
            className="h-full w-full border-0"
            style={{
              minHeight: IFRAME_MIN_HEIGHT,
              maxHeight: maxHeight,
              colorScheme: "light",
            }}
          />
        </div>
      )}
    </div>
  );
}
