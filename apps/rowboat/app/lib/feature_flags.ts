export const USE_RAG = process.env.USE_RAG === 'true';
export const USE_RAG_UPLOADS = process.env.USE_RAG_UPLOADS === 'true';
export const USE_RAG_SCRAPING = process.env.USE_RAG_SCRAPING === 'true';
export const USE_CHAT_WIDGET = process.env.USE_CHAT_WIDGET === 'true';
export const USE_AUTH = process.env.USE_AUTH === 'true';
export const USE_RAG_S3_UPLOADS = process.env.USE_RAG_S3_UPLOADS === 'true';
export const USE_GEMINI_FILE_PARSING = process.env.USE_GEMINI_FILE_PARSING === 'true';
export const USE_BILLING = process.env.NEXT_PUBLIC_USE_BILLING === 'true' || process.env.USE_BILLING === 'true';
export const USE_COMPOSIO_TOOLS = process.env.USE_COMPOSIO_TOOLS === 'true';
export const USE_KLAVIS_TOOLS = process.env.USE_KLAVIS_TOOLS === 'false';

// Hardcoded flags
export const USE_MULTIPLE_PROJECTS = true;
export const USE_VOICE_FEATURE = false;
export const USE_TRANSFER_CONTROL_OPTIONS = false;
export const USE_PRODUCT_TOUR = false;
export const SHOW_COPILOT_MARQUEE = false;
export const SHOW_PROMPTS_SECTION = true;
export const SHOW_DARK_MODE_TOGGLE = false;
export const SHOW_VISUALIZATION = false;
