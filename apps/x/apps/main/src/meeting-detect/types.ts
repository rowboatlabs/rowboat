export interface MicUser {
    // Best-effort executable identifier — full path on Windows, command name on macOS.
    executable: string;
    // Process id when the platform exposes it (macOS via lsof). Undefined on Windows
    // because the registry only records the exe path, not which pid is currently
    // holding the mic.
    pid?: number;
}

export interface MicProbe {
    probe(): Promise<MicUser[]>;
}
