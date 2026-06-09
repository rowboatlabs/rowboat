import type { ColumnType } from "kysely";

export type TimestampColumn = ColumnType<string, string, string>;

export interface StorageMetadataTable {
    key: string;
    value: string;
    updated_at: TimestampColumn;
}

export interface Database {
    storage_metadata: StorageMetadataTable;
}
