/**
 * Shared types for the Bases view (saved filtered views over the knowledge graph).
 */

export type SortDir = 'asc' | 'desc';

export interface ActiveFilter {
  category: string;
  value: string;
}

export interface BaseConfig {
  filters: ActiveFilter[];
  columns: string[];
  sort?: { field: string; dir: SortDir };
  search?: string;
}

export const DEFAULT_BASE_CONFIG: BaseConfig = {
  filters: [],
  columns: [],
};
