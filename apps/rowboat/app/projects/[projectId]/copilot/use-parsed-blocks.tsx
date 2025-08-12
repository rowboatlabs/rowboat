import { useMemo } from "react";

type Block =
  | { type: "text"; content: string }
  | { type: "code"; content: string };

const copilotCodeMarker = "copilot_change\n";

function parseMarkdown(markdown: string): Block[] {
  // Split on triple backticks but keep the delimiters
  // This gives us the raw content between and including delimiters
  const parts = markdown.split("\n```");
  const blocks: Block[] = [];
  
  for (const part of parts) {
    if (part.trim().startsWith(copilotCodeMarker)) {
      blocks.push({ type: 'code', content: part.slice(copilotCodeMarker.length) });
    } else {
      blocks.push({ type: 'text', content: part });
    }
  }

  return blocks;
}

export function useParsedBlocks(text: string): Block[] {
  return useMemo(() => {
    return parseMarkdown(text);
  }, [text]);
}