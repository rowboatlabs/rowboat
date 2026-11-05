// One line per event on stderr: what the worker did, when, with the facts
// beside it. A VM's exec output or a laptop's terminal is the reader; nothing
// here is parsed by anything.

export type Logger = (message: string, fields?: Record<string, unknown>) => void;

export function makeLogger(stream: NodeJS.WritableStream = process.stderr): Logger {
  return (message, fields) => {
    const at = new Date().toISOString();
    stream.write(`${at} ${message}${fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : ''}\n`);
  };
}

export const silentLogger: Logger = () => {};

/** An error's words, for a log line or a report. */
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A string cut to `max` characters, with an ellipsis when it was longer. */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** One line of a command or a tool's name, for an activity line. */
export function oneLine(text: string, max: number): string {
  return clip(text.replace(/\s+/g, ' ').trim(), max);
}
