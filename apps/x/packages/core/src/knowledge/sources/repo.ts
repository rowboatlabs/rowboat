import fs from 'fs';
import path from 'path';
import { WorkDir } from '../../config/config.js';
import {
    KnowledgeSourceConfig,
    KnowledgeSourcesFile,
    type KnowledgeSourcesFile as KnowledgeSourcesFileType,
} from './types.js';

const CONFIG_FILE = path.join(WorkDir, 'config', 'knowledge_sources.json');

const BUILTIN_SOURCES: KnowledgeSourceConfig[] = [
    {
        id: 'gmail',
        provider: 'gmail',
        enabled: true,
        artifactDir: 'gmail_sync',
        syncMode: 'file',
        scopes: [],
    },
    {
        id: 'fireflies-meetings',
        provider: 'meeting',
        enabled: true,
        artifactDir: path.join('knowledge', 'Meetings', 'fireflies'),
        syncMode: 'file',
        scopes: [],
    },
    {
        id: 'granola-meetings',
        provider: 'meeting',
        enabled: true,
        artifactDir: path.join('knowledge', 'Meetings', 'granola'),
        syncMode: 'file',
        scopes: [],
    },
    {
        id: 'rowboat-meetings',
        provider: 'meeting',
        enabled: true,
        artifactDir: path.join('knowledge', 'Meetings', 'rowboat'),
        syncMode: 'file',
        scopes: [],
    },
];

function ensureConfigDir(): void {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
}

function mergeBuiltinSources(config: KnowledgeSourcesFileType): KnowledgeSourcesFileType {
    const byId = new Map(config.sources.map(source => [source.id, source]));
    for (const builtin of BUILTIN_SOURCES) {
        if (!byId.has(builtin.id)) {
            byId.set(builtin.id, builtin);
        }
    }
    return { sources: Array.from(byId.values()) };
}

export interface IKnowledgeSourcesRepo {
    getConfig(): KnowledgeSourcesFileType;
    setConfig(config: KnowledgeSourcesFileType): void;
    listEnabledSources(): KnowledgeSourceConfig[];
    upsertSource(source: KnowledgeSourceConfig): KnowledgeSourcesFileType;
}

export class FSKnowledgeSourcesRepo implements IKnowledgeSourcesRepo {
    getConfig(): KnowledgeSourcesFileType {
        try {
            if (!fs.existsSync(CONFIG_FILE)) {
                const config = { sources: BUILTIN_SOURCES };
                this.setConfig(config);
                return config;
            }

            const parsed = KnowledgeSourcesFile.parse(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')));
            const merged = mergeBuiltinSources(parsed);
            if (merged.sources.length !== parsed.sources.length) {
                this.setConfig(merged);
            }
            return merged;
        } catch (error) {
            console.error('[KnowledgeSources] Failed to load config:', error);
            return { sources: BUILTIN_SOURCES };
        }
    }

    setConfig(config: KnowledgeSourcesFileType): void {
        const validated = KnowledgeSourcesFile.parse(mergeBuiltinSources(config));
        ensureConfigDir();
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(validated, null, 2), 'utf-8');
    }

    listEnabledSources(): KnowledgeSourceConfig[] {
        return this.getConfig().sources.filter(source => source.enabled);
    }

    upsertSource(source: KnowledgeSourceConfig): KnowledgeSourcesFileType {
        const validated = KnowledgeSourceConfig.parse(source);
        const config = this.getConfig();
        const existingIndex = config.sources.findIndex(item => item.id === validated.id);
        if (existingIndex >= 0) {
            config.sources[existingIndex] = validated;
        } else {
            config.sources.push(validated);
        }
        this.setConfig(config);
        return this.getConfig();
    }
}

export const knowledgeSourcesRepo = new FSKnowledgeSourcesRepo();
