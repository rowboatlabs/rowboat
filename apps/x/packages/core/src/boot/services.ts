import container from '../di/container.js';
import type { ISessions } from '../runtime/sessions/index.js';
import type { CodeSessionService } from '../code-mode/sessions/service.js';
import { runRetentionSweep } from '../runtime/sessions/retention.js';
import { loadRetentionSettings } from '../config/retention.js';
import { init as initGmailSync } from '../knowledge/sync_gmail.js';
import { init as initOutlookSync } from '../knowledge/sync_outlook.js';
import { init as initCalendarSync } from '../knowledge/sync_calendar.js';
import { init as initOutlookCalendarSync } from '../knowledge/sync_outlook_calendar.js';
import { init as initFirefliesSync } from '../knowledge/sync_fireflies.js';
import { init as initGranolaSync } from '../knowledge/granola/sync.js';
import { init as initGraphBuilder } from '../knowledge/build_graph.js';
import { init as initNoteTagging } from '../knowledge/tag_notes.js';
import { init as initInlineTasks } from '../knowledge/inline_tasks.js';
import { init as initAgentRunner } from '../agent-schedule/runner.js';
import { init as initChannels } from '../channels/service.js';
import { init as initAgentNotes } from '../knowledge/agent_notes.js';
import { init as initCalendarNotifications } from '../knowledge/notify_calendar_meetings.js';
import { init as initMeetingPrep } from '../knowledge/meeting_prep_scheduler.js';
import { init as initLiveNoteScheduler } from '../knowledge/live-note/scheduler.js';
import { init as initEventProcessor, registerConsumer } from '../events/init.js';
import { liveNoteEventConsumer } from '../knowledge/live-note/event-consumer.js';
import { init as initBackgroundTaskScheduler } from '../background-tasks/scheduler.js';
import { backgroundTaskEventConsumer } from '../background-tasks/event-consumer.js';
import { startSkillsWatcher } from '../runtime/assembly/skills/watcher.js';
import { init as initChromeSync } from '../knowledge/chrome-extension/server/server.js';
import { disconnectGoogleIfScopesStale } from '../auth/oauth-flows.js';
import { migrateRuns } from '../migrations/runs/migrate.js';
import { startModelsDevRefresh } from '../models/models-dev.js';
import { init as initAppsServer } from '../apps/server.js';
import { registerAppsHostApi } from '../apps/host-api.js';
import { cleanInstallTmp } from '../apps/installer.js';
import { startSpaceMentionWatch } from '../spaces/mention-watch.js';
import { flags } from '@x/shared';

// The headless-safe half of Rowboat's boot: everything that runs schedulers,
// sync services, and background agents against the workdir. Extracted from
// apps/main/src/main.ts (Phase 6, SEPARATION_PLAN.md) so Electron main and
// the standalone rowboat-server boot the SAME service set in the SAME order —
// after the flip, only the standalone entrypoint calls this.
//
// Not here (client-machine concerns): meeting detection (mic monitor), tray,
// quick-ask, updater, window watchers, capture permissions.

// One-time data repairs that must precede the session index scan.
export async function prepareCoreData(): Promise<void> {
  try {
    const migration = migrateRuns();
    if (migration.scanned > 0) {
      console.log(
        `[runs-migration] migrated ${migration.migratedTurns} turn(s) across ` +
        `${migration.migratedSessions} session(s) from ${migration.scanned} run(s) ` +
        `(${migration.skipped} skipped, ${migration.failed.length} failed)`,
      );
      for (const failure of migration.failed) {
        console.warn(`[runs-migration] left in place (failed): ${failure.file} — ${failure.error}`);
      }
    }
  } catch (error) {
    console.error('[runs-migration] pass failed:', error);
  }
  try {
    await container.resolve<CodeSessionService>('codeSessionService').backfillChatSessions();
  } catch (error) {
    console.error('[code-sessions] backfill failed:', error);
  }
}

let retentionSweepStarted = false;
export function startRetentionSweep(): void {
  if (retentionSweepStarted) return;
  retentionSweepStarted = true;
  const sweep = async () => {
    try {
      const settings = await loadRetentionSettings();
      if (!settings.enabled || !settings.noticeShown) return;
      const result = await runRetentionSweep({
        sessions: container.resolve<ISessions>('sessions'),
        turnsRootDir: container.resolve<string>('turnsRootDir'),
        settings,
      });
      const orphaned = await container.resolve<CodeSessionService>('codeSessionService').sweepOrphanedMeta().catch(() => 0);
      if (orphaned > 0) {
        console.log(`[Retention] cleared code-mode meta for ${orphaned} deleted session(s)`);
      }
      if (result.deletedSessions > 0 || result.deletedTurnFiles > 0) {
        console.log(
          `[Retention] sweep: deleted ${result.deletedSessions} session(s), ${result.deletedTurnFiles} turn file(s)`,
        );
      }
    } catch (error) {
      console.error('[Retention] sweep failed:', error);
    }
  };
  setTimeout(() => { void sweep(); }, 90_000);
  setInterval(() => { void sweep(); }, 24 * 60 * 60 * 1000);
}

let servicesStarted = false;
// Requires the session index to be initialized. Idempotent.
export async function initCoreServices(): Promise<void> {
  if (servicesStarted) return;
  servicesStarted = true;

  startRetentionSweep();
  startModelsDevRefresh();

  // Rowboat Apps server (per-app origins on 127.0.0.1:3210).
  registerAppsHostApi();
  // Startup hygiene: drop leftover install/update stagings. A cancelled URL
  // preview retains its staging by design and a failed download leaves a
  // partial bundle.zip; nothing else ever removes them, so they accumulate
  // across launches. Fire-and-forget — never block or fail startup on it.
  cleanInstallTmp().catch((error) => {
    console.error('[Apps] Failed to clear install stagings:', error);
  });
  initAppsServer().catch((error) => {
    console.error('[Apps] Failed to start:', error);
  });

  // Space mentions: watch every space of every org and notify on @<me> (over
  // the notification service seam — OS notifications in-process, the WS
  // reverse call from the standalone server). Gated with the Spaces UI flag.
  if (flags.spacesEnabled(process.env)) startSpaceMentionWatch();

  initChannels().catch((error) => {
    console.error('[Channels] Failed to start mobile channels:', error);
  });

  import('../home/command-center.js')
    .then((m) => m.repairCommandCenterSession())
    .catch(() => {});
  void import('../todo/planner-task.js').then((m) => m.ensureMorningPlannerTask());

  initLiveNoteScheduler();
  initBackgroundTaskScheduler();
  startSkillsWatcher();

  registerConsumer(liveNoteEventConsumer);
  registerConsumer(backgroundTaskEventConsumer);
  initEventProcessor();

  await disconnectGoogleIfScopesStale();

  initGmailSync();
  initOutlookSync();
  initCalendarSync();
  initOutlookCalendarSync();
  initFirefliesSync();
  initGranolaSync();
  initGraphBuilder();
  initNoteTagging();
  initInlineTasks();
  initAgentRunner();
  initAgentNotes();
  initCalendarNotifications();
  void initMeetingPrep();
  initChromeSync();
}
