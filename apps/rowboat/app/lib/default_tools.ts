import { z } from 'zod';

// Returns the list of built-in tools that should appear by default
// in the workflow editor and be usable at runtime without attaching
// them to the workflow. These are displayed as read-only library tools.
// Note: avoid importing WorkflowTool here to prevent circular deps.
// Return a structurally compatible object instead.
export function getDefaultTools(): Array<any> {
  // Show built-in tools only when a public, non-secret flag is set.
  // Avoids exposing real secrets in client bundles.
  const hasGoogleKeyFlag = (process.env.NEXT_PUBLIC_HAS_GOOGLE_API_KEY || '').toLowerCase() === 'true';

  if (!hasGoogleKeyFlag) return [];

  return [
    {
      name: 'Generate Image',
      description:
        'Generate an image using Google Gemini given a text prompt. Returns base64-encoded image data and any text parts.',
      isGeminiImage: true,
      isLibrary: true,
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Text prompt describing the image to generate',
          },
          modelName: { type: 'string', description: 'Optional Gemini model override' },
        },
        required: ['prompt'],
        additionalProperties: true,
      },
    },
  ];
}
