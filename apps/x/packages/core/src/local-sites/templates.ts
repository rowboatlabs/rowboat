export const LOCAL_SITE_SCAFFOLD: Record<string, string> = {
  'README.md': `# Local Sites

Anything inside this folder is available at:

\`http://localhost:3210/sites/<slug>/\`

Examples:

- \`sites/example-dashboard/\` -> \`http://localhost:3210/sites/example-dashboard/\`
- \`sites/team-ops/\` -> \`http://localhost:3210/sites/team-ops/\`

You can embed a local site in a note with:

\`\`\`iframe
{"url":"http://localhost:3210/sites/example-dashboard/","title":"Signal Deck","height":640,"caption":"Local dashboard served from sites/example-dashboard"}
\`\`\`

Notes:

- The app serves each site with SPA-friendly routing, so client-side routers work
- Local HTML pages auto-expand inside Rowboat iframe blocks to fit their content height
- Put an \`index.html\` file at the site root
- Remote APIs still need to allow browser requests from a local page
`,
  'example-dashboard/index.html': `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Signal Deck</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <div class="ambient ambient-one"></div>
    <div class="ambient ambient-two"></div>
    <main class="shell">
      <header class="hero">
        <div>
          <p class="eyebrow">Local iframe sample · external APIs</p>
          <h1>Signal Deck</h1>
          <p class="lede">
            A locally-served dashboard designed to live inside a Rowboat note. It fetches
            live signals from public APIs and stays readable at note width.
          </p>
        </div>
        <div class="hero-status" id="hero-status">Booting dashboard...</div>
      </header>

      <section class="metric-grid" id="metric-grid"></section>

      <section class="board">
        <article class="panel">
          <div class="panel-header">
            <div>
              <p class="panel-kicker">Hacker News</p>
              <h2>Live headlines</h2>
            </div>
            <span class="panel-chip">public API</span>
          </div>
          <div class="story-list" id="story-list"></div>
        </article>

        <article class="panel">
          <div class="panel-header">
            <div>
              <p class="panel-kicker">GitHub</p>
              <h2>Repo pulse</h2>
            </div>
            <span class="panel-chip">public API</span>
          </div>
          <div class="repo-list" id="repo-list"></div>
        </article>
      </section>
    </main>

    <script type="module" src="./app.js"></script>
  </body>
</html>
`,
  'example-dashboard/styles.css': `:root {
  color-scheme: dark;
  --bg: #090816;
  --panel: rgba(18, 16, 39, 0.88);
  --panel-strong: rgba(26, 23, 54, 0.96);
  --line: rgba(255, 255, 255, 0.08);
  --text: #f5f7ff;
  --muted: rgba(230, 235, 255, 0.68);
  --cyan: #66e2ff;
  --lime: #b7ff6a;
  --amber: #ffcb6b;
  --pink: #ff7ed1;
  --shadow: 0 24px 80px rgba(0, 0, 0, 0.4);
}

* {
  box-sizing: border-box;
}

html,
body {
  min-height: 100%;
}

body {
  margin: 0;
  font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
  color: var(--text);
  background:
    radial-gradient(circle at top, rgba(74, 51, 175, 0.28), transparent 34%),
    linear-gradient(180deg, #0c0b1d 0%, var(--bg) 100%);
}

.ambient {
  position: fixed;
  inset: auto;
  width: 320px;
  height: 320px;
  border-radius: 999px;
  filter: blur(70px);
  pointer-events: none;
  opacity: 0.35;
}

.ambient-one {
  top: -80px;
  right: -40px;
  background: rgba(102, 226, 255, 0.22);
}

.ambient-two {
  bottom: -120px;
  left: -60px;
  background: rgba(255, 126, 209, 0.18);
}

.shell {
  position: relative;
  max-width: 1180px;
  margin: 0 auto;
  padding: 32px 24px 40px;
}

.hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 22px;
}

.eyebrow,
.panel-kicker {
  margin: 0 0 10px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-size: 11px;
  color: var(--cyan);
}

h1,
h2,
p {
  margin: 0;
}

h1 {
  font-family: "Space Grotesk", "IBM Plex Sans", sans-serif;
  font-size: clamp(2rem, 5vw, 3.4rem);
  line-height: 0.95;
  letter-spacing: -0.05em;
}

.lede {
  max-width: 620px;
  margin-top: 12px;
  color: var(--muted);
  line-height: 1.55;
  font-size: 15px;
}

.hero-status {
  flex-shrink: 0;
  min-width: 180px;
  padding: 12px 14px;
  border: 1px solid rgba(102, 226, 255, 0.18);
  border-radius: 16px;
  background: rgba(14, 17, 32, 0.62);
  color: var(--muted);
  font-size: 13px;
  line-height: 1.4;
  box-shadow: var(--shadow);
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 18px;
}

.metric-card,
.panel {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 22px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0)),
    var(--panel);
  box-shadow: var(--shadow);
}

.metric-card {
  padding: 18px;
  min-height: 152px;
}

.metric-card::after,
.panel::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.07), transparent 40%);
  pointer-events: none;
}

.metric-label {
  color: var(--muted);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.metric-value {
  margin-top: 16px;
  font-family: "Space Grotesk", "IBM Plex Sans", sans-serif;
  font-size: clamp(2rem, 4vw, 2.7rem);
  line-height: 0.95;
  letter-spacing: -0.06em;
}

.metric-detail {
  margin-top: 12px;
  color: var(--muted);
  font-size: 13px;
}

.metric-spark {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 6px;
  align-items: end;
  height: 40px;
  margin-top: 18px;
}

.metric-spark span {
  display: block;
  border-radius: 999px 999px 3px 3px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.82), rgba(255, 255, 255, 0.1));
}

.board {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 18px;
}

.panel {
  padding: 20px;
}

.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.panel-header h2 {
  font-family: "Space Grotesk", "IBM Plex Sans", sans-serif;
  font-size: 1.3rem;
  letter-spacing: -0.04em;
}

.panel-chip {
  padding: 7px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--muted);
  font-size: 12px;
}

.story-list,
.repo-list {
  display: grid;
  gap: 12px;
}

.story-item,
.repo-item {
  position: relative;
  display: grid;
  gap: 8px;
  padding: 16px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 18px;
  background: var(--panel-strong);
}

.story-rank {
  position: absolute;
  top: 14px;
  right: 14px;
  font-family: "Space Grotesk", "IBM Plex Sans", sans-serif;
  font-size: 1.2rem;
  color: rgba(255, 255, 255, 0.18);
}

.story-item a,
.repo-item a {
  color: var(--text);
  text-decoration: none;
}

.story-item a:hover,
.repo-item a:hover {
  color: var(--cyan);
}

.story-title,
.repo-name {
  padding-right: 34px;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.35;
}

.story-meta,
.repo-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--muted);
  font-size: 12px;
}

.story-pill,
.repo-pill {
  padding: 5px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
}

.repo-description {
  color: var(--muted);
  font-size: 13px;
  line-height: 1.45;
}

.empty-state {
  padding: 18px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--muted);
  font-size: 14px;
}

@media (max-width: 940px) {
  .metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .board {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .shell {
    padding: 22px 14px 28px;
  }

  .hero {
    flex-direction: column;
  }

  .hero-status {
    width: 100%;
  }

  .metric-grid {
    grid-template-columns: 1fr;
  }

  .panel,
  .metric-card {
    border-radius: 18px;
  }
}
`,
  'example-dashboard/app.js': `const formatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const reposConfig = [
  {
    slug: 'rowboatlabs/rowboat',
    label: 'Rowboat',
    description: 'AI coworker with memory',
  },
  {
    slug: 'openai/openai-cookbook',
    label: 'OpenAI Cookbook',
    description: 'Examples and guides for building with OpenAI APIs',
  },
];

const fallbackStories = [
  { id: 1, title: 'AI product launches keep getting more opinionated', score: 182, descendants: 49, by: 'analyst', url: '#' },
  { id: 2, title: 'Designing dashboards that can survive a narrow iframe', score: 141, descendants: 26, by: 'maker', url: '#' },
  { id: 3, title: 'Why local mini-apps inside notes are underrated', score: 119, descendants: 18, by: 'builder', url: '#' },
  { id: 4, title: 'Teams want live data in docs, not screenshots', score: 97, descendants: 14, by: 'operator', url: '#' },
];

const fallbackRepos = [
  { ...reposConfig[0], stars: 1280, forks: 144, issues: 28, url: 'https://github.com/rowboatlabs/rowboat' },
  { ...reposConfig[1], stars: 71600, forks: 11300, issues: 52, url: 'https://github.com/openai/openai-cookbook' },
];

const metricGrid = document.getElementById('metric-grid');
const storyList = document.getElementById('story-list');
const repoList = document.getElementById('repo-list');
const heroStatus = document.getElementById('hero-status');

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error('Request failed with status ' + response.status);
  }

  return response.json();
}

async function loadRepos() {
  try {
    const repos = await Promise.all(
      reposConfig.map(async (repo) => {
        const data = await fetchJson('https://api.github.com/repos/' + repo.slug);
        return {
          ...repo,
          stars: data.stargazers_count,
          forks: data.forks_count,
          issues: data.open_issues_count,
          url: data.html_url,
        };
      }),
    );
    return repos;
  } catch {
    return fallbackRepos;
  }
}

async function loadStories() {
  try {
    const ids = await fetchJson('https://hacker-news.firebaseio.com/v0/topstories.json');
    const stories = await Promise.all(
      ids.slice(0, 4).map((id) =>
        fetchJson('https://hacker-news.firebaseio.com/v0/item/' + id + '.json'),
      ),
    );

    return stories
      .filter(Boolean)
      .map((story) => ({
        id: story.id,
        title: story.title,
        score: story.score || 0,
        descendants: story.descendants || 0,
        by: story.by || 'unknown',
        url: story.url || ('https://news.ycombinator.com/item?id=' + story.id),
      }));
  } catch {
    return fallbackStories;
  }
}

function metricSpark(values) {
  const max = Math.max(...values, 1);
  const bars = values.map((value) => {
    const height = Math.max(18, Math.round((value / max) * 40));
    return '<span style="height:' + height + 'px"></span>';
  });
  return '<div class="metric-spark">' + bars.join('') + '</div>';
}

function renderMetrics(repos, stories) {
  const leadRepo = repos[0];
  const companionRepo = repos[1];
  const topStory = stories[0];
  const averageScore = Math.round(
    stories.reduce((sum, story) => sum + story.score, 0) / Math.max(stories.length, 1),
  );

  const metrics = [
    {
      label: 'Rowboat stars',
      value: formatter.format(leadRepo.stars),
      detail: formatter.format(leadRepo.forks) + ' forks · ' + leadRepo.issues + ' open issues',
      spark: [leadRepo.stars * 0.58, leadRepo.stars * 0.71, leadRepo.stars * 0.88, leadRepo.stars],
      accent: 'var(--cyan)',
    },
    {
      label: 'Cookbook stars',
      value: formatter.format(companionRepo.stars),
      detail: formatter.format(companionRepo.forks) + ' forks · ' + companionRepo.issues + ' open issues',
      spark: [companionRepo.stars * 0.76, companionRepo.stars * 0.81, companionRepo.stars * 0.93, companionRepo.stars],
      accent: 'var(--lime)',
    },
    {
      label: 'Top story score',
      value: formatter.format(topStory.score),
      detail: topStory.descendants + ' comments · by ' + topStory.by,
      spark: stories.map((story) => story.score),
      accent: 'var(--amber)',
    },
    {
      label: 'Average HN score',
      value: formatter.format(averageScore),
      detail: stories.length + ' live stories in this panel',
      spark: stories.map((story) => story.descendants + 10),
      accent: 'var(--pink)',
    },
  ];

  metricGrid.innerHTML = metrics
    .map((metric) => (
      '<article class="metric-card" style="box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), 0 24px 80px rgba(0,0,0,0.34), 0 0 0 1px color-mix(in srgb, ' + metric.accent + ' 16%, transparent);">' +
        '<div class="metric-label">' + metric.label + '</div>' +
        '<div class="metric-value">' + metric.value + '</div>' +
        '<div class="metric-detail">' + metric.detail + '</div>' +
        metricSpark(metric.spark) +
      '</article>'
    ))
    .join('');
}

function renderStories(stories) {
  storyList.innerHTML = stories
    .map((story, index) => (
      '<article class="story-item">' +
        '<div class="story-rank">0' + (index + 1) + '</div>' +
        '<a class="story-title" href="' + story.url + '" target="_blank" rel="noreferrer">' + story.title + '</a>' +
        '<div class="story-meta">' +
          '<span class="story-pill">' + formatter.format(story.score) + ' pts</span>' +
          '<span class="story-pill">' + story.descendants + ' comments</span>' +
          '<span class="story-pill">by ' + story.by + '</span>' +
        '</div>' +
      '</article>'
    ))
    .join('');
}

function renderRepos(repos) {
  repoList.innerHTML = repos
    .map((repo) => (
      '<article class="repo-item">' +
        '<a class="repo-name" href="' + repo.url + '" target="_blank" rel="noreferrer">' + repo.label + '</a>' +
        '<p class="repo-description">' + repo.description + '</p>' +
        '<div class="repo-meta">' +
          '<span class="repo-pill">' + formatter.format(repo.stars) + ' stars</span>' +
          '<span class="repo-pill">' + formatter.format(repo.forks) + ' forks</span>' +
          '<span class="repo-pill">' + repo.issues + ' open issues</span>' +
        '</div>' +
      '</article>'
    ))
    .join('');
}

function renderErrorState(message) {
  metricGrid.innerHTML = '<div class="empty-state">' + message + '</div>';
  storyList.innerHTML = '<div class="empty-state">No stories available.</div>';
  repoList.innerHTML = '<div class="empty-state">No repositories available.</div>';
}

async function refresh() {
  heroStatus.textContent = 'Refreshing live signals...';

  try {
    const [repos, stories] = await Promise.all([loadRepos(), loadStories()]);

    if (!repos.length || !stories.length) {
      renderErrorState('The sample site loaded, but the data sources returned no content.');
      heroStatus.textContent = 'Loaded with empty data.';
      return;
    }

    renderMetrics(repos, stories);
    renderStories(stories);
    renderRepos(repos);

    heroStatus.textContent = 'Updated ' + new Date().toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    }) + ' · embedded from sites/example-dashboard';
  } catch (error) {
    renderErrorState('This site is running, but the live fetch failed. The local scaffold is still valid.');
    heroStatus.textContent = error instanceof Error ? error.message : 'Refresh failed';
  }
}

refresh();
setInterval(refresh, 120000);
`,
  'homepage/index.html': `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Home</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0a0a0f; --fg: #e5e5ef; --muted: #7c7c8a; --accent: #6366f1;
    --card: rgba(255,255,255,0.04); --border: rgba(255,255,255,0.08); --hover: rgba(255,255,255,0.07);
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #f8f8fb; --fg: #1a1a2e; --muted: #6b6b7b; --accent: #4f46e5;
      --card: rgba(0,0,0,0.03); --border: rgba(0,0,0,0.08); --hover: rgba(0,0,0,0.05);
    }
  }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--fg); min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  .shell { max-width: 640px; width: 100%; padding: 40px 24px; }
  h1 { font-size: 1.75rem; font-weight: 700; margin-bottom: 8px; }
  .subtitle { color: var(--muted); font-size: 0.95rem; margin-bottom: 32px; line-height: 1.5; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
  @media (max-width: 480px) { .grid { grid-template-columns: 1fr; } }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; text-decoration: none; color: var(--fg); transition: background 0.15s; display: flex; flex-direction: column; gap: 6px; }
  .card:hover { background: var(--hover); }
  .card-title { font-weight: 600; font-size: 0.95rem; }
  .card-desc { color: var(--muted); font-size: 0.82rem; line-height: 1.4; }
  .footer { margin-top: 40px; color: var(--muted); font-size: 0.78rem; text-align: center; }
  .footer a { color: var(--accent); text-decoration: none; }
</style>
</head>
<body>
<div class="shell">
  <h1>Welcome home</h1>
  <p class="subtitle">Your local dashboard. Edit <code>~/.rowboat/sites/homepage/index.html</code> to customize this page.</p>
  <div class="grid">
    <a class="card" href="http://localhost:3210/workspace/">
      <span class="card-title">Workspace</span>
      <span class="card-desc">Browse your project files</span>
    </a>
    <a class="card" href="http://localhost:3210/sites/example-dashboard/">
      <span class="card-title">Example Dashboard</span>
      <span class="card-desc">Live signals demo</span>
    </a>
  </div>
  <p class="footer">Serving from <a href="http://localhost:3210">localhost:3210</a></p>
</div>
</body>
</html>`,
}
