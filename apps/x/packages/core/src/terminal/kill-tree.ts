import { execFile, execFileSync } from 'node:child_process';

// Kills everything a process left running under it. A plain pty.kill() only
// SIGHUPs the shell: zsh's job control puts every job in its OWN process
// group, and any job that traps SIGHUP — which most dev servers do, to
// survive terminal disconnects — keeps running (verified empirically on
// macOS). So: snapshot the root's descendants while it is still alive
// (orphans reparent to init the moment it dies and become untraceable),
// TERM them right away (plus CONT, so ctrl-Z'd jobs actually receive it),
// and SIGKILL whatever is left after a grace period.
//
// Group signalling is restricted to groups OWNED by the tree (their leader
// is a tree member — every pty job group qualifies). A group merely
// inherited from above the root (the caller's own, when the root is not a
// session leader) must never be swept: kill(-pgid) there would take out
// innocent processes, up to the app itself. Members of foreign groups are
// signalled per-pid instead, and the delayed KILL re-checks pid+pgid
// against the snapshot so a reused pid is never hit.

const KILL_GRACE_MS = 1500;

interface ProcRow {
    pid: number;
    ppid: number;
    pgid: number;
}

interface TreeSnapshot {
    rows: Array<{ pid: number; pgid: number }>;
    ownedPgids: Set<number>;
}

function listProcesses(): ProcRow[] {
    const out = execFileSync('ps', ['-axo', 'pid=,ppid=,pgid='], { encoding: 'utf8', timeout: 5000 });
    const rows: ProcRow[] = [];
    for (const line of out.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 3) continue;
        const [pid, ppid, pgid] = parts.map(Number);
        if (Number.isInteger(pid) && Number.isInteger(ppid) && Number.isInteger(pgid)) {
            rows.push({ pid, ppid, pgid });
        }
    }
    return rows;
}

function snapshotTree(rootPid: number): TreeSnapshot {
    const all = listProcesses();
    const byParent = new Map<number, ProcRow[]>();
    for (const row of all) {
        const siblings = byParent.get(row.ppid);
        if (siblings) siblings.push(row);
        else byParent.set(row.ppid, [row]);
    }
    const rows: Array<{ pid: number; pgid: number }> = [];
    const rootRow = all.find((row) => row.pid === rootPid);
    if (rootRow) rows.push({ pid: rootRow.pid, pgid: rootRow.pgid });
    const queue = [rootPid];
    while (queue.length) {
        for (const child of byParent.get(queue.shift() as number) ?? []) {
            rows.push({ pid: child.pid, pgid: child.pgid });
            queue.push(child.pid);
        }
    }
    const treePids = new Set(rows.map((row) => row.pid));
    const ownedPgids = new Set(rows.map((row) => row.pgid).filter((pgid) => pgid > 1 && treePids.has(pgid)));
    return { rows, ownedPgids };
}

function signalPid(pid: number, signal: NodeJS.Signals): void {
    if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return;
    try {
        process.kill(pid, signal);
    } catch {
        // already gone
    }
}

function signalGroup(pgid: number, signal: NodeJS.Signals): void {
    if (!Number.isInteger(pgid) || pgid <= 1) return;
    try {
        process.kill(-pgid, signal);
    } catch {
        // already gone
    }
}

/**
 * Terminate rootPid and every descendant: TERM (+CONT) immediately, then
 * SIGKILL survivors after graceMs. Fire-and-forget — the escalation timer
 * is unref'd so it never holds the process open (on app quit only the
 * TERM pass lands, which is the right trade).
 */
export function killProcessTree(rootPid: number, graceMs: number = KILL_GRACE_MS): void {
    if (!Number.isInteger(rootPid) || rootPid <= 1) return;
    if (process.platform === 'win32') {
        // taskkill fells the whole tree in one shot; no unix signals here.
        execFile('taskkill', ['/pid', String(rootPid), '/T', '/F'], () => {});
        return;
    }
    let snapshot: TreeSnapshot;
    try {
        snapshot = snapshotTree(rootPid);
    } catch {
        // ps unavailable — still put the root itself through TERM→KILL.
        snapshot = { rows: [{ pid: rootPid, pgid: -1 }], ownedPgids: new Set() };
    }
    for (const pgid of snapshot.ownedPgids) {
        signalGroup(pgid, 'SIGTERM');
        signalGroup(pgid, 'SIGCONT');
    }
    for (const row of snapshot.rows) {
        if (snapshot.ownedPgids.has(row.pgid)) continue; // covered by its group
        signalPid(row.pid, 'SIGTERM');
        signalPid(row.pid, 'SIGCONT');
    }
    const timer = setTimeout(() => {
        let current: ProcRow[];
        try {
            current = listProcesses();
        } catch {
            // Blind fallback: the snapshot pids, reuse risk accepted.
            for (const row of snapshot.rows) signalPid(row.pid, 'SIGKILL');
            return;
        }
        for (const row of current) {
            // Owned-group match catches members spawned after the snapshot;
            // the pid+pgid match catches original members in foreign groups
            // without ever hitting a reused pid.
            if (snapshot.ownedPgids.has(row.pgid)) {
                signalPid(row.pid, 'SIGKILL');
            } else if (snapshot.rows.some((s) => s.pid === row.pid && s.pgid === row.pgid)) {
                signalPid(row.pid, 'SIGKILL');
            }
        }
    }, graceMs);
    timer.unref();
}
