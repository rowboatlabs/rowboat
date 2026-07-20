export const skill = String.raw`
# Generate Images

Load this skill when the user asks you to create, generate, edit, or remix an image — illustrations, logos, mockups, photos, diagrams-as-art, profile pictures, social cards, and so on.

## The tool: \`generate-image\`

Generates one image with the user's configured image model and saves it under \`generated-images/\` in the workspace.

### Parameters
- **\`prompt\`** (required) — what to generate. Be concrete: subject, style, composition, colors, lighting, mood. For edits, describe the change relative to the source images.
- **\`sourceImagePaths\`** (optional) — existing images (png/jpg/webp/gif) to edit or remix. Accepts workspace-relative, absolute, or \`~/\` paths — e.g. an attachment the user dropped into chat, or a previously generated image.

### Result
Returns \`{ success, path, absolutePath }\` where \`path\` is workspace-relative (e.g. \`generated-images/sunset-cabin-….png\`).

- **In chat, the image is displayed to the user automatically** as part of the tool result — do NOT repeat it as a markdown image in your reply. Just describe what you made in a short sentence.
- **In notes / HTML artifacts** (background tasks, live notes), embed the image yourself with a path that is relative to the file you're writing — e.g. from \`bg-tasks/<slug>/index.html\` the generated image is \`../../generated-images/<file>.png\`.

## Iterating

Image generation is iterative by nature. When the user asks for tweaks ("make it darker", "remove the text"), call \`generate-image\` again with the previous output as a source image:

\`\`\`json
{
  "prompt": "Same scene, but at night with warm window lighting",
  "sourceImagePaths": ["generated-images/sunset-cabin-2026-07-16T....png"]
}
\`\`\`

## Anti-patterns
- **Don't generate unprompted.** Only call the tool when the user asked for an image (or a background task's instructions clearly require one).
- **Don't batch speculative variations.** Generate one image, let the user react, then iterate. Each call costs real money.
- **Don't re-embed the chat result.** The UI already renders it; a duplicate markdown embed shows the image twice.
`;

export default skill;
