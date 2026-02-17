import fs from 'fs';
import path from 'path';
import { WorkDir } from './config.js';

export interface KnowledgeVault {
    name: string;
    path: string;
    mountPath: string;
    readOnly: boolean;
    addedAt: string;
}

interface KnowledgeVaultsConfig {
    vaults: KnowledgeVault[];
}

const CONFIG_FILE = path.join(WorkDir, 'config', 'knowledge_vaults.json');
const RESERVED_NAMES = new Set([
    'People',
    'Organizations',
    'Projects',
    'Topics',
    '.assets',
    '.trash',
]);

function normalizeVaultName(input: string): string {
    return input
        .trim()
        .replace(/[\\/]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeRelPath(relPath: string): string {
    return relPath.split(path.sep).join('/');
}

function readConfig(): KnowledgeVaultsConfig {
    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            return { vaults: [] };
        }
        const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as KnowledgeVaultsConfig;
        if (!parsed || !Array.isArray(parsed.vaults)) {
            return { vaults: [] };
        }
        return {
            vaults: parsed.vaults.filter((vault) => typeof vault?.mountPath === 'string'),
        };
    } catch {
        return { vaults: [] };
    }
}

function writeConfig(config: KnowledgeVaultsConfig): void {
    const dir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function ensureKnowledgeVaultsConfig(): void {
    if (!fs.existsSync(CONFIG_FILE)) {
        writeConfig({ vaults: [] });
    }
}

export function listKnowledgeVaults(): KnowledgeVault[] {
    return readConfig().vaults;
}

export function getKnowledgeVaultMountPaths(): string[] {
    return readConfig().vaults.map((vault) => normalizeRelPath(vault.mountPath));
}

export function isKnowledgeVaultMountPath(relPath: string): boolean {
    const normalized = normalizeRelPath(relPath);
    return getKnowledgeVaultMountPaths().includes(normalized);
}

export function addKnowledgeVault({
    name,
    path: vaultPath,
    readOnly = false,
}: {
    name: string;
    path: string;
    readOnly?: boolean;
}): KnowledgeVault {
    const normalizedName = normalizeVaultName(name);
    if (!normalizedName) {
        throw new Error('Vault name is required');
    }
    if (RESERVED_NAMES.has(normalizedName)) {
        throw new Error('Vault name is reserved');
    }

    const stats = fs.statSync(vaultPath);
    if (!stats.isDirectory()) {
        throw new Error('Vault path must be a directory');
    }

    const config = readConfig();
    const mountPath = `knowledge/${normalizedName}`;
    if (config.vaults.some((vault) => vault.name.toLowerCase() === normalizedName.toLowerCase())) {
        throw new Error('A vault with that name already exists');
    }
    if (config.vaults.some((vault) => vault.path === vaultPath)) {
        throw new Error('That vault is already added');
    }

    const mountAbsPath = path.join(WorkDir, mountPath);
    if (fs.existsSync(mountAbsPath)) {
        throw new Error(`Mount path already exists: ${mountPath}`);
    }

    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    fs.symlinkSync(vaultPath, mountAbsPath, linkType);

    const vault: KnowledgeVault = {
        name: normalizedName,
        path: vaultPath,
        mountPath,
        readOnly: readOnly === true,
        addedAt: new Date().toISOString(),
    };

    config.vaults.push(vault);
    writeConfig(config);
    return vault;
}

export function removeKnowledgeVault(nameOrMountPath: string): KnowledgeVault | null {
    const config = readConfig();
    const normalizedInput = nameOrMountPath.trim();
    const mountPath = normalizedInput.startsWith('knowledge/')
        ? normalizedInput
        : `knowledge/${normalizeVaultName(normalizedInput)}`;
    const idx = config.vaults.findIndex((vault) => vault.mountPath === mountPath);
    if (idx === -1) {
        return null;
    }
    const [removed] = config.vaults.splice(idx, 1);
    writeConfig(config);

    const mountAbsPath = path.join(WorkDir, mountPath);
    try {
        const stats = fs.lstatSync(mountAbsPath);
        if (stats.isSymbolicLink()) {
            fs.unlinkSync(mountAbsPath);
        }
    } catch {
        // Ignore missing or invalid mount path
    }
    return removed;
}
