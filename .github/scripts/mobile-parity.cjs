// Every Spaces change on the web/desktop says what happens on the phone
// (2026-11-13): a "Mobile:" line in the PR description, checked by
// .github/workflows/mobile-parity.yml. "follow-up" opens an issue on merge, so
// the phone's share of a feature is tracked rather than remembered.

// Where Spaces features live in the renderer, shared by the desktop and the web app.
const SPACES_PATHS = [
  'apps/x/apps/renderer/src/components/spaces/',
  'apps/x/apps/renderer/src/web/',
  'apps/x/apps/renderer/src/lib/spaces-',
];

const HOW_TO = [
  'Add one of these lines to the PR description:',
  '',
  '    Mobile: done                    (the phone has it, in this PR or already)',
  '    Mobile: follow-up               (an issue for the phone opens when this merges)',
  '    Mobile: follow-up #123          (it is already tracked in #123)',
  '    Mobile: not needed — <why>      (e.g. desktop-only, a refactor, a bug fix with no phone side)',
].join('\n');

// Tests and docs alone are not a feature.
function touchesSpaces(files) {
  return files.filter(
    (f) => SPACES_PATHS.some((p) => f.startsWith(p)) && !/\.test\.tsx?$/.test(f) && !f.endsWith('.md'),
  );
}

// Returns { kind: 'done' | 'follow-up' | 'not-needed', issue?, reason? } or { error }.
function parseMobileLine(body) {
  const text = (body || '').replace(/<!--[\s\S]*?-->/g, '');
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*]\s+)?(?:\[[ xX]\]\s+)?/, '').replace(/\*\*|__/g, '').trim())
    .filter((l) => /^mobile\s*:/i.test(l));
  if (lines.length === 0) return { error: 'No "Mobile:" line in the PR description.' };
  if (lines.length > 1) return { error: 'More than one "Mobile:" line; keep one.' };
  const value = lines[0].replace(/^mobile\s*:\s*/i, '');
  if (value.includes('|')) return { error: 'The "Mobile:" line still lists every option; keep the one that applies.' };

  if (/^done\b/i.test(value)) return { kind: 'done' };
  const follow = value.match(/^follow[- ]?up\b(.*)$/i);
  if (follow) {
    const issue = follow[1].match(/#(\d+)/);
    return issue ? { kind: 'follow-up', issue: Number(issue[1]) } : { kind: 'follow-up' };
  }
  const notNeeded = value.match(/^not needed\b[\s:,.\-—–]*(?:because\s+)?(.*)$/i);
  if (notNeeded) {
    const reason = notNeeded[1].trim();
    if (reason.length < 3) return { error: '"Mobile: not needed" needs a reason after it.' };
    return { kind: 'not-needed', reason };
  }
  return { error: `"Mobile: ${value}" is not one of done, follow-up, not needed.` };
}

// pull_request: fail the check when a Spaces change has no valid Mobile line.
async function check({ github, context, core }) {
  const pr = context.payload.pull_request;
  const files = await github.paginate(github.rest.pulls.listFiles, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: pr.number,
    per_page: 100,
  });
  const spaces = touchesSpaces(files.map((f) => f.filename));
  if (spaces.length === 0) {
    core.info('No Spaces web changes; no Mobile line needed.');
    return;
  }
  const result = parseMobileLine(pr.body);
  if (result.error) {
    const shown = spaces.slice(0, 10).map((f) => `    ${f}`).join('\n');
    const more = spaces.length > 10 ? `\n    …and ${spaces.length - 10} more` : '';
    core.setFailed(`${result.error}\n\nThis PR changes Spaces on the web/desktop:\n${shown}${more}\n\n${HOW_TO}`);
    return;
  }
  core.info(`Mobile: ${result.kind}${result.issue ? ` #${result.issue}` : ''}${result.reason ? ` — ${result.reason}` : ''}`);
}

// pull_request_target closed+merged: "Mobile: follow-up" without an issue opens one.
async function openFollowUp({ github, context, core }) {
  const pr = context.payload.pull_request;
  const result = parseMobileLine(pr.body);
  if (result.kind !== 'follow-up' || result.issue) {
    core.info('No follow-up issue to open.');
    return;
  }
  const { owner, repo } = context.repo;
  const marker = `<!-- mobile-parity:${pr.number} -->`;
  const existing = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number: pr.number, per_page: 100 });
  if (existing.some((c) => c.body && c.body.includes(marker))) {
    core.info('A follow-up issue was already opened for this PR.');
    return;
  }
  const issue = {
    owner,
    repo,
    title: `Mobile: ${pr.title}`,
    body: [
      `#${pr.number} shipped this on the web/desktop. Bring it to the phone app (\`apps/x/apps/mobile\`).`,
      '',
      'Opened automatically from the PR\'s "Mobile: follow-up" line.',
    ].join('\n'),
  };
  let created;
  try {
    created = await github.rest.issues.create({ ...issue, assignees: [pr.user.login] });
  } catch (err) {
    // The author may not be assignable (e.g. an outside contributor).
    core.info(`Could not assign ${pr.user.login}: ${err.message}`);
    created = await github.rest.issues.create(issue);
  }
  await github.rest.issues.createComment({
    owner,
    repo,
    issue_number: pr.number,
    body: `${marker}\nOpened #${created.data.number} to bring this to the phone app.`,
  });
  core.info(`Opened #${created.data.number}`);
}

module.exports = { SPACES_PATHS, touchesSpaces, parseMobileLine, check, openFollowUp };
