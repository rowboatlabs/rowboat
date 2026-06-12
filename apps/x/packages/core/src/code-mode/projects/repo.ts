import fs from 'fs/promises';
import path from 'path';
import { WorkDir } from '../../config/config.js';
import z from 'zod';
import { CodeProject } from '@x/shared/dist/code-sessions.js';

const ProjectsFile = z.object({
    projects: z.array(CodeProject),
});

export interface ICodeProjectsRepo {
    list(): Promise<CodeProject[]>;
    get(projectId: string): Promise<CodeProject | null>;
    add(dirPath: string): Promise<CodeProject>;
    remove(projectId: string): Promise<void>;
}

// Registered project directories for the Code section. One small JSON file —
// same pattern as the other config repos.
export class FSCodeProjectsRepo implements ICodeProjectsRepo {
    private readonly configPath = path.join(WorkDir, 'config', 'code-projects.json');

    private async read(): Promise<CodeProject[]> {
        try {
            const raw = await fs.readFile(this.configPath, 'utf8');
            return ProjectsFile.parse(JSON.parse(raw)).projects;
        } catch {
            return [];
        }
    }

    private async write(projects: CodeProject[]): Promise<void> {
        await fs.mkdir(path.dirname(this.configPath), { recursive: true });
        await fs.writeFile(this.configPath, JSON.stringify({ projects }, null, 2));
    }

    async list(): Promise<CodeProject[]> {
        return this.read();
    }

    async get(projectId: string): Promise<CodeProject | null> {
        const projects = await this.read();
        return projects.find((p) => p.id === projectId) ?? null;
    }

    async add(dirPath: string): Promise<CodeProject> {
        const resolved = path.resolve(dirPath);
        const stat = await fs.stat(resolved);
        if (!stat.isDirectory()) {
            throw new Error(`Not a directory: ${resolved}`);
        }
        const projects = await this.read();
        const existing = projects.find((p) => p.path === resolved);
        if (existing) return existing;
        const project: CodeProject = {
            id: `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            path: resolved,
            name: path.basename(resolved),
            addedAt: new Date().toISOString(),
        };
        await this.write([...projects, project]);
        return project;
    }

    async remove(projectId: string): Promise<void> {
        const projects = await this.read();
        await this.write(projects.filter((p) => p.id !== projectId));
    }
}
