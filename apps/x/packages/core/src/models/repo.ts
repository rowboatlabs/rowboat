import { LlmModelConfig, LlmProvider, ModelRef, TaskModels } from "@x/shared/dist/models.js";
import { WorkDir } from "../config/config.js";
import { isSignedIn } from "../account/account.js";
import { capture } from "../analytics/posthog.js";
import {
    captureProviderConnected,
    captureProviderDisconnected,
    syncModelProviderPersonProperties,
} from "../analytics/model-providers.js";
import { migrateModelsConfig } from "./migrate.js";
import fs from "fs/promises";
import path from "path";
import z from "zod";

type Config = z.infer<typeof LlmModelConfig>;
type Ref = z.infer<typeof ModelRef>;
type TaskModelPatch = { [K in keyof z.infer<typeof TaskModels>]?: Ref | null };

// Top-level merge patch: omitted keys are untouched; an explicit null clears
// a key. taskModels merges per-key (null clears that task's override).
export type ModelConfigPatch = {
    assistantModel?: Ref | null;
    taskModels?: TaskModelPatch;
    deferBackgroundTasks?: boolean | null;
};

export interface IModelConfigRepo {
    /** Create the file if missing; migrate v1 → v2 in place if needed. */
    ensureConfig(): Promise<void>;
    getConfig(): Promise<Config>;
    /** Upsert one provider entry (credentials + connection prefs). */
    setProvider(id: string, provider: z.infer<typeof LlmProvider>): Promise<void>;
    /**
     * Remove a provider entry and every model selection that references it
     * (a dangling assistantModel / task override would just error at run
     * time — dropping them lets resolution fall back cleanly).
     */
    removeProvider(id: string): Promise<void>;
    updateConfig(patch: ModelConfigPatch): Promise<void>;
}

const emptyConfig: Config = {
    version: 2,
    providers: {},
};

function isEnoent(err: unknown): boolean {
    return (err as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

export class FSModelConfigRepo implements IModelConfigRepo {
    private readonly configPath = path.join(WorkDir, "config", "models.json");

    async ensureConfig(): Promise<void> {
        let rawText: string;
        try {
            rawText = await fs.readFile(this.configPath, "utf8");
        } catch (err) {
            if (isEnoent(err)) {
                await this.write(emptyConfig);
            } else {
                // Transient read failure (permissions, I/O): NEVER overwrite
                // the existing file — it holds the user's API keys. Leave it
                // for the next boot; per-call getConfig errors degrade
                // features without destroying data.
                console.error("[models] Could not read models.json; leaving it untouched:", err);
            }
            return;
        }
        let raw: unknown;
        try {
            raw = JSON.parse(rawText);
        } catch (err) {
            // Corrupt JSON (e.g. a crash mid-write): quarantine the file for
            // manual recovery instead of overwriting the only copy of the
            // user's credentials.
            const quarantinePath = `${this.configPath}.corrupt-${Date.now()}`;
            await fs.rename(this.configPath, quarantinePath).catch(() => {});
            console.error(`[models] models.json is corrupt; preserved at ${quarantinePath}:`, err);
            await this.write(emptyConfig);
            return;
        }
        const signedIn = await isSignedIn().catch(() => false);
        const migrated = migrateModelsConfig(raw, signedIn);
        if (migrated) {
            // Keep the v1 original recoverable — the migration is the only
            // record of the old selections once it runs.
            await fs.writeFile(`${this.configPath}.v1.bak`, rawText).catch(() => {});
            await this.write(migrated);
            // One-shot rollout signal for the v1 → v2 schema migration.
            capture("models_config_migrated", {
                had_assistant: Boolean(migrated.assistantModel),
                materialized_overrides: Object.keys(migrated.taskModels ?? {}).length,
                provider_count: Object.keys(migrated.providers).length,
            });
        }
    }

    async getConfig(): Promise<Config> {
        const config = await fs.readFile(this.configPath, "utf8");
        return LlmModelConfig.parse(JSON.parse(config));
    }

    async setProvider(id: string, provider: z.infer<typeof LlmProvider>): Promise<void> {
        // The credential-less flavors are never stored: their connection IS
        // their auth token store (oauth.json / chatgpt-auth.json), and the
        // catalog derives their presence from auth state — a providers-map
        // entry would double-list them.
        if (provider.flavor === "rowboat" || provider.flavor === "codex") {
            throw new Error(`Provider flavor '${provider.flavor}' is auth-derived and cannot be stored in models.json`);
        }
        const config = await this.read();
        const isNew = !config.providers[id];
        // Merge over an existing entry: replacing a key must not wipe
        // hand-tuned connection prefs (contextLength, reasoningEffort).
        config.providers[id] = LlmProvider.parse({
            ...config.providers[id],
            ...provider,
        });
        await this.write(config);
        // A brand-new entry is a connect; a key rotation is not.
        if (isNew) captureProviderConnected(provider.flavor);
    }

    async removeProvider(id: string): Promise<void> {
        const config = await this.read();
        const removed = config.providers[id];
        delete config.providers[id];
        if (config.assistantModel?.provider === id) {
            delete config.assistantModel;
        }
        if (config.taskModels) {
            for (const key of Object.keys(config.taskModels) as Array<keyof NonNullable<Config["taskModels"]>>) {
                if (config.taskModels[key]?.provider === id) {
                    delete config.taskModels[key];
                }
            }
            if (Object.keys(config.taskModels).length === 0) delete config.taskModels;
        }
        await this.write(config);
        if (removed) captureProviderDisconnected(removed.flavor);
    }

    async updateConfig(patch: ModelConfigPatch): Promise<void> {
        const config = await this.read();
        if (patch.assistantModel !== undefined) {
            if (patch.assistantModel === null) delete config.assistantModel;
            else config.assistantModel = patch.assistantModel;
        }
        if (patch.taskModels !== undefined) {
            const merged = { ...(config.taskModels ?? {}) };
            for (const [key, value] of Object.entries(patch.taskModels)) {
                if (value === undefined) continue;
                if (value === null) delete merged[key as keyof typeof merged];
                else merged[key as keyof typeof merged] = value;
            }
            if (Object.keys(merged).length > 0) config.taskModels = merged;
            else delete config.taskModels;
        }
        if (patch.deferBackgroundTasks !== undefined) {
            if (patch.deferBackgroundTasks === null) delete config.deferBackgroundTasks;
            else config.deferBackgroundTasks = patch.deferBackgroundTasks;
        }
        await this.write(config);
        // The assistant person properties track the config.
        if (patch.assistantModel !== undefined) {
            void syncModelProviderPersonProperties();
        }
    }

    private async read(): Promise<Config> {
        try {
            return await this.getConfig();
        } catch (err) {
            // ONLY a missing file falls back to empty (writes can arrive
            // before ensureConfig on a fresh install). Any other failure —
            // unreadable file, schema-invalid content — must propagate:
            // read-modify-write on an empty fallback would clobber the
            // user's stored credentials.
            if (isEnoent(err)) {
                return structuredClone(emptyConfig);
            }
            throw err;
        }
    }

    // Atomic write (temp + rename): a crash mid-write must never leave a
    // truncated models.json — that file is the only copy of the user's keys.
    private async write(config: Config): Promise<void> {
        const data = JSON.stringify(LlmModelConfig.parse(config), null, 2);
        const tmpPath = `${this.configPath}.tmp`;
        await fs.writeFile(tmpPath, data);
        await fs.rename(tmpPath, this.configPath);
    }
}
