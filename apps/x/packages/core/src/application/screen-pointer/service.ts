// Screen pointer: lets the assistant point at a spot on the user's SHARED
// screen during a call (an animated overlay marker, not the OS cursor).
// Core owns the tool; the Electron main process implements the service
// (overlay window + share-state tracking) and registers it in the DI
// container, same seam as IBrowserControlService.

export type ScreenPointerTarget = {
  /** Horizontal position as a fraction of the shared screen, 0 (left) to 1 (right). */
  x: number;
  /** Vertical position as a fraction of the shared screen, 0 (top) to 1 (bottom). */
  y: number;
  /** Short caption rendered next to the pointer. */
  label?: string;
  /** How long the pointer stays up before auto-hiding. */
  durationMs?: number;
};

export type ScreenPointerResult = {
  success: boolean;
  error?: string;
};

export type ScreenClickTarget = {
  /** Horizontal position as a fraction of the shared screen, 0 (left) to 1 (right). */
  x: number;
  /** Vertical position as a fraction of the shared screen, 0 (top) to 1 (bottom). */
  y: number;
  doubleClick?: boolean;
};

export type ScreenTypeInput = {
  /** Text typed into whatever currently has keyboard focus. Newlines become Return presses. */
  text: string;
  /** Press Return after the text (submit a field, send a message). */
  pressEnter?: boolean;
};

export interface IScreenPointerService {
  /** Whether the user is currently sharing their screen (call or quick-ask). */
  isShareActive(): boolean;
  point(target: ScreenPointerTarget): Promise<ScreenPointerResult>;
  hide(): Promise<void>;
  /** Real input injection (v2): click at a position on the shared screen.
   *  Shows the pointer at the spot first so the user sees it coming. */
  click(target: ScreenClickTarget): Promise<ScreenPointerResult>;
  /** Real input injection (v2): type into the focused field. */
  typeText(input: ScreenTypeInput): Promise<ScreenPointerResult>;
}
