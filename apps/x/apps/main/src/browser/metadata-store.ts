import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  BrowserSettingsPatchSchema,
  BrowserSettingsSchema,
  DEFAULT_BROWSER_PARTITION,
  DEFAULT_BROWSER_PROFILE_ID,
  type BrowserSettings,
  type BrowserSettingsPatch,
} from '@x/shared/dist/browser-control.js';

const MetadataSchema = z.object({
  version: z.literal(1),
  defaultProfile: z.object({
    id: z.literal(DEFAULT_BROWSER_PROFILE_ID),
    partition: z.literal(DEFAULT_BROWSER_PARTITION),
  }).strict(),
  settings: BrowserSettingsSchema,
}).strict();
type Metadata = z.infer<typeof MetadataSchema>;

function defaults(): Metadata {
  return {
    version: 1,
    defaultProfile: { id: DEFAULT_BROWSER_PROFILE_ID, partition: DEFAULT_BROWSER_PARTITION },
    settings: { tabRailOpen: false },
  };
}

/** Main-process-only, single-writer store. Never stores cookies or page contents. */
export class BrowserMetadataStore {
  private pending: Promise<unknown> = Promise.resolve();
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private transaction<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    // A failed write must not poison future transactions.
    this.pending = result.catch(() => undefined);
    return result;
  }

  private async read(): Promise<Metadata | null> {
    let text: string;
    try {
      text = await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Browser settings file is invalid. The original file has been preserved.');
    }
    if (data && typeof data === 'object' && 'version' in data && data.version !== 1) {
      throw new Error('Browser settings use an unsupported version. The original file has been preserved.');
    }
    const result = MetadataSchema.safeParse(data);
    if (!result.success) {
      throw new Error('Browser settings file is invalid. The original file has been preserved.');
    }
    return result.data;
  }

  private async write(data: Metadata): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    // Same-directory rename keeps readers on either the old or new whole file.
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporary, this.filePath);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }

  getSettings(legacyTabRailOpen?: boolean): Promise<BrowserSettings> {
    return this.transaction(async () => {
      const existing = await this.read();
      if (existing) return existing.settings;
      const initial = defaults();
      if (legacyTabRailOpen !== undefined) initial.settings.tabRailOpen = legacyTabRailOpen;
      await this.write(initial);
      return initial.settings;
    });
  }

  updateSettings(patch: BrowserSettingsPatch): Promise<BrowserSettings> {
    return this.transaction(async () => {
      const validated = BrowserSettingsPatchSchema.parse(patch);
      const current = await this.read() ?? defaults();
      const next = { ...current, settings: BrowserSettingsSchema.parse({ ...current.settings, ...validated }) };
      await this.write(next);
      return next.settings;
    });
  }
}
