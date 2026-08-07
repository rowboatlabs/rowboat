import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import type { z } from 'zod';
import { ipc } from '@x/shared';

export type ZoomAccessibilityEvent = z.infer<typeof ipc.ZoomAccessibilityEvidence>;

type SupervisorOptions = {
  helperPath: string;
  onEvent: (event: ZoomAccessibilityEvent) => void;
  onMeetingEnded: () => void;
};

const MISSING_POLLS_TO_END = 3;
const MAX_LINE_LENGTH = 16 * 1024;

/**
 * Owns the optional macOS Zoom Accessibility helper for one Rowboat capture.
 * Meeting end is emitted only after a validated active Zoom surface was seen
 * and then disappeared for three consecutive observations.
 */
export class ZoomAccessibilitySupervisor {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = '';
  private activeSurfaceSeen = false;
  private consecutiveMissing = 0;
  private endEmitted = false;

  start(options: SupervisorOptions): boolean {
    this.stop();
    if (process.platform !== 'darwin' || !fs.existsSync(options.helperPath)) {
      return false;
    }

    this.activeSurfaceSeen = false;
    this.consecutiveMissing = 0;
    this.endEmitted = false;
    this.stdoutBuffer = '';

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(options.helperPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      console.warn('[ZoomAX] failed to start helper:', error);
      return false;
    }
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      this.stdoutBuffer += chunk;
      if (this.stdoutBuffer.length > MAX_LINE_LENGTH * 4) {
        console.warn('[ZoomAX] dropping oversized helper output');
        this.stdoutBuffer = '';
        return;
      }
      let newline: number;
      while ((newline = this.stdoutBuffer.indexOf('\n')) >= 0) {
        const line = this.stdoutBuffer.slice(0, newline).trim();
        this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
        if (!line || line.length > MAX_LINE_LENGTH) continue;
        this.handleLine(line, options);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      const message = chunk.trim();
      if (message) console.warn('[ZoomAX helper]', message.slice(0, 2_000));
    });
    child.on('error', (error) => {
      console.warn('[ZoomAX] helper error:', error);
    });
    child.on('exit', (code) => {
      if (this.child === child) this.child = null;
      if (code !== 0 && code !== null) {
        console.warn(`[ZoomAX] helper exited with code ${code}`);
      }
    });
    return true;
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    this.stdoutBuffer = '';
    this.activeSurfaceSeen = false;
    this.consecutiveMissing = 0;
    this.endEmitted = false;
    if (!child) return;
    child.stdin.end();
    const forceKill = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGTERM');
    }, 1_000);
    forceKill.unref();
    child.once('exit', () => clearTimeout(forceKill));
  }

  private handleLine(line: string, options: SupervisorOptions): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    const result = ipc.ZoomAccessibilityEvidence.safeParse(parsed);
    if (!result.success) return;
    const event = result.data;
    options.onEvent(event);

    if (event.type !== 'surface' || this.endEmitted) return;
    if (event.state === 'active') {
      this.activeSurfaceSeen = true;
      this.consecutiveMissing = 0;
      return;
    }
    if (event.state === 'unknown') {
      // Permission and transient AX failures never prove that a call ended.
      this.consecutiveMissing = 0;
      return;
    }
    if (!this.activeSurfaceSeen) return;
    this.consecutiveMissing += 1;
    if (this.consecutiveMissing >= MISSING_POLLS_TO_END) {
      this.endEmitted = true;
      options.onMeetingEnded();
    }
  }
}

export const zoomAccessibilitySupervisor = new ZoomAccessibilitySupervisor();
