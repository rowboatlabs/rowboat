import { z } from 'zod';

// Returns the list of built-in tools that should appear by default
// in the workflow editor and be usable at runtime without attaching
// them to the workflow. These are displayed as read-only library tools.
// Note: avoid importing WorkflowTool here to prevent circular deps.
// Return a structurally compatible object instead.
export function getDefaultTools(): Array<any> {
  // Always expose built-in library tools in the editor so users can
  // discover them. Runtime invocation will still validate required
  // environment variables and return an error if missing.

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
