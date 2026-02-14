export const skill = String.raw`
# PDF Presentation Generator Skill

## When to Use

Activate when the user wants to create presentations, slide decks, or pitch decks.

## Workflow

1. Use workspace-readFile to check knowledge/ for relevant context about the company, product, team, etc.
2. Ensure Playwright is installed: 'npm install playwright && npx playwright install chromium'
3. Use workspace-getRoot to get the workspace root path.
4. Use workspace-writeFile to create the HTML file at tmp/presentation.html (workspace-relative) with slides (1280x720px each).
5. Use workspace-writeFile to create a Node.js conversion script at tmp/convert.js (workspace-relative):

~~~javascript
// save as tmp/convert.js via workspace-writeFile
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // Use the workspace root path from workspace-getRoot
  await page.goto('file://<WORKSPACE_ROOT>/tmp/presentation.html', { waitUntil: 'networkidle' });
  await page.pdf({
    path: path.join(process.env.HOME, 'Desktop', 'presentation.pdf'),
    width: '1280px',
    height: '720px',
    printBackground: true,
  });
  await browser.close();
  console.log('Done: ~/Desktop/presentation.pdf');
})();
~~~

Replace <WORKSPACE_ROOT> with the actual absolute path returned by workspace-getRoot.

6. Run it: 'node <WORKSPACE_ROOT>/tmp/convert.js'
7. Tell the user: "Your presentation is ready at ~/Desktop/presentation.pdf"

Do NOT show HTML code to the user. Do NOT explain how to export. Just create the PDF and deliver it.
Use workspace-writeFile and workspace-readFile for ALL file operations. Do NOT use executeCommand to write or read files.

## PDF Export Rules

**These rules prevent rendering issues in PDF. Violating them causes overlapping rectangles and broken layouts.**

1. **No layered elements** - Never create separate elements for backgrounds or shadows. Style content elements directly.
2. **No box-shadow** - Use borders instead: \`border: 1px solid #e5e7eb\`
3. **Bullets via CSS only** - Use \`li::before\` pseudo-elements, not separate DOM elements
4. **Content must fit** - Slides are 1280x720px with 60px padding. Safe area is 1160x600px. Use \`overflow: hidden\`.
5. **No footers or headers** - Never add fixed/absolute-positioned footer or header elements to slides. They overlap with content in PDF rendering. If you need a slide number or title, include it as part of the normal content flow.

## Required CSS

~~~css
@page { size: 1280px 720px; margin: 0; }
html { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
.slide {
  width: 1280px;
  height: 720px;
  padding: 60px;
  overflow: hidden;
  page-break-after: always;
  page-break-inside: avoid;
}
.slide:last-child { page-break-after: auto; }
~~~

## Playwright Export

~~~typescript
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('file://' + htmlPath, { waitUntil: 'networkidle' });
await page.pdf({
  path: '~/Desktop/presentation.pdf',
  width: '1280px',
  height: '720px',
  printBackground: true,
});
await browser.close();
~~~

## Example Slide Layouts Reference

Below are 20 production-ready slide layout templates. Use these as reference when building presentations. Pick the appropriate layout for each slide based on the content type. Mix and match layouts for visual variety — never use the same layout for every slide.

### Available Layout Types

1. **Title Slide (Dark Gradient)** — Hero opening with gradient text and atmospheric glow
2. **Title Slide (Light Editorial)** — Clean, warm serif typography with editorial feel
3. **Section Divider** — Chapter break with oversized background number
4. **Big Statement / Quote** — Full-color background with bold quote or key takeaway
5. **Bullet List (Split Panel)** — Dark sidebar title + light content area with icon bullets
6. **Two Columns** — Side-by-side content cards
7. **Three Columns with Icons** — Feature cards with icon accents
8. **Bar Chart** — Vertical bars with gradient fills and labels
9. **Donut Chart** — CSS conic-gradient donut with legend
10. **Line Chart (SVG)** — SVG polyline with area fill and data labels
11. **Horizontal Timeline** — Connected milestone dots on a horizontal axis
12. **Vertical Timeline** — Left-rail progression of milestones
13. **Process Flow** — Step cards connected with arrows
14. **KPI Dashboard** — Color-coded metric cards with change indicators
15. **Comparison / Vs** — Split layout with contrasting colors for A vs B
16. **Pricing Table** — Tiered cards with featured highlight
17. **Team Grid** — Avatar circles with role descriptions
18. **Image + Text** — Visual panel left, content + CTA right
19. **Funnel Diagram** — Tapered width bars showing conversion stages
20. **Thank You / CTA** — Atmospheric closing with contact details

### Design Guidelines

- Use Google Fonts (DM Sans, Outfit, Playfair Display, Space Mono, Sora, Crimson Pro) loaded via \`<link>\` tag
- Dark slides: use subtle radial gradients for atmosphere, semi-transparent overlays for depth
- Light slides: use warm neutrals, clean borders, and ample whitespace
- Charts: use CSS (conic-gradient for donuts, inline styles for bar heights) or inline SVG for line charts
- Color palette: indigo (#6366f1), violet (#8b5cf6), emerald (#10b981), amber (#fbbf24), rose (#f43e5c)
- Typography hierarchy: monospace overlines for labels, sans-serif for headings, serif for editorial/quotes
- Cards: use \`border-radius: 12-16px\`, subtle borders (\`rgba(255,255,255,0.08)\` on dark), no box-shadow (PDF rule)

### HTML Template Examples

<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Slide Deck Templates — The Future of AI Coworkers</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,700&family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Space+Mono:wght@400;700&family=Outfit:wght@300;400;500;600;700;800&family=Sora:wght@300;400;500;600;700&family=Crimson+Pro:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet">
<style>
  :root {
    --slide-w: 960px;
    --slide-h: 540px;
    --scale: 0.65;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: #0a0a0f;
    color: #e0e0e0;
    font-family: 'DM Sans', sans-serif;
    padding: 40px 20px 80px;
  }

  .page-header {
    text-align: center;
    padding: 60px 20px 80px;
  }
  .page-header h1 {
    font-family: 'Playfair Display', serif;
    font-size: 3.2rem;
    color: #fff;
    letter-spacing: -1px;
    margin-bottom: 12px;
  }
  .page-header p {
    font-size: 1.1rem;
    color: #888;
    max-width: 600px;
    margin: 0 auto;
  }
  .page-header .badge {
    display: inline-block;
    background: linear-gradient(135deg, #6366f1, #a855f7);
    color: #fff;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 2px;
    padding: 6px 16px;
    border-radius: 20px;
    margin-bottom: 20px;
  }

  .slide-section {
    max-width: 1200px;
    margin: 0 auto 70px;
  }
  .section-label {
    font-family: 'Space Mono', monospace;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 3px;
    color: #6366f1;
    margin-bottom: 8px;
  }
  .section-title {
    font-family: 'Outfit', sans-serif;
    font-size: 1.4rem;
    font-weight: 600;
    color: #fff;
    margin-bottom: 6px;
  }
  .section-desc {
    font-size: 0.85rem;
    color: #666;
    margin-bottom: 24px;
  }

  .slide-frame {
    width: var(--slide-w);
    height: var(--slide-h);
    transform: scale(var(--scale));
    transform-origin: top left;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06);
    position: relative;
  }
  .slide-wrapper {
    width: calc(var(--slide-w) * var(--scale));
    height: calc(var(--slide-h) * var(--scale));
    margin: 0 auto;
  }

  /* ========== SLIDE 1: Title Slide — Dark Gradient ========== */
  .slide-title-dark {
    background: linear-gradient(160deg, #0f0c29, #302b63, #24243e);
    display: flex; flex-direction: column; justify-content: center; align-items: center;
    text-align: center; padding: 60px;
    position: relative;
  }
  .slide-title-dark::before {
    content: '';
    position: absolute;
    width: 500px; height: 500px;
    background: radial-gradient(circle, rgba(99,102,241,0.15), transparent 70%);
    top: -100px; right: -100px;
  }
  .slide-title-dark .overline {
    font-family: 'Space Mono', monospace;
    font-size: 11px; text-transform: uppercase; letter-spacing: 4px;
    color: #a78bfa; margin-bottom: 20px;
  }
  .slide-title-dark h1 {
    font-family: 'Outfit', sans-serif;
    font-size: 52px; font-weight: 800; color: #fff;
    line-height: 1.1; margin-bottom: 16px;
    background: linear-gradient(135deg, #fff 30%, #a78bfa);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  .slide-title-dark .subtitle {
    font-size: 18px; color: #94a3b8; max-width: 500px; line-height: 1.5;
  }

  /* ========== SLIDE 2: Title Slide — Light Minimal ========== */
  .slide-title-light {
    background: #fafaf9;
    display: flex; flex-direction: column; justify-content: center;
    padding: 80px; position: relative;
  }
  .slide-title-light::after {
    content: '';
    position: absolute; right: 60px; top: 50%; transform: translateY(-50%);
    width: 200px; height: 200px;
    border-radius: 50%;
    background: linear-gradient(135deg, #fbbf24, #f59e0b);
    opacity: 0.15;
  }
  .slide-title-light .tag {
    font-family: 'Space Mono', monospace;
    font-size: 10px; text-transform: uppercase; letter-spacing: 3px;
    color: #b45309; margin-bottom: 24px;
    padding: 4px 12px; border: 1px solid #fbbf24; border-radius: 4px; display: inline-block;
  }
  .slide-title-light h1 {
    font-family: 'Playfair Display', serif;
    font-size: 48px; font-weight: 700; color: #1a1a1a;
    line-height: 1.15; margin-bottom: 16px; max-width: 600px;
  }
  .slide-title-light .subtitle {
    font-size: 16px; color: #78716c; max-width: 480px; line-height: 1.6;
    font-family: 'DM Sans', sans-serif;
  }

  /* ========== SLIDE 3: Section Divider ========== */
  .slide-divider {
    background: #111827;
    display: flex; align-items: center; justify-content: center;
    position: relative; overflow: hidden;
  }
  .slide-divider .big-num {
    font-family: 'Outfit', sans-serif;
    font-size: 280px; font-weight: 800; color: rgba(99,102,241,0.07);
    position: absolute; right: -20px; top: 50%; transform: translateY(-50%);
    line-height: 1;
  }
  .slide-divider .content { padding: 80px; position: relative; z-index: 1; }
  .slide-divider .section-num {
    font-family: 'Space Mono', monospace; font-size: 12px;
    color: #6366f1; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 16px;
  }
  .slide-divider h2 {
    font-family: 'Outfit', sans-serif; font-size: 44px; font-weight: 700;
    color: #fff; line-height: 1.2; max-width: 500px;
  }
  .slide-divider .line {
    width: 60px; height: 3px; background: #6366f1; margin-top: 24px; border-radius: 2px;
  }

  /* ========== SLIDE 4: Big Statement / Single Bullet ========== */
  .slide-statement {
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    display: flex; flex-direction: column; justify-content: center;
    padding: 80px; position: relative;
  }
  .slide-statement::before {
    content: '"';
    font-family: 'Playfair Display', serif;
    font-size: 300px; color: rgba(255,255,255,0.08);
    position: absolute; top: -40px; left: 40px; line-height: 1;
  }
  .slide-statement blockquote {
    font-family: 'Crimson Pro', serif;
    font-size: 36px; font-weight: 400; color: #fff;
    line-height: 1.4; max-width: 700px;
    font-style: italic; position: relative; z-index: 1;
  }
  .slide-statement .attr {
    font-family: 'DM Sans', sans-serif; font-size: 14px;
    color: rgba(255,255,255,0.7); margin-top: 24px;
  }

  /* ========== SLIDE 5: Bullet List ========== */
  .slide-bullets {
    background: #fff;
    display: flex; padding: 0; position: relative;
  }
  .slide-bullets .left {
    width: 35%; background: #1e1b4b; padding: 50px 40px;
    display: flex; flex-direction: column; justify-content: center;
  }
  .slide-bullets .left h2 {
    font-family: 'Outfit', sans-serif; font-size: 28px; font-weight: 700;
    color: #fff; line-height: 1.3;
  }
  .slide-bullets .left .accent {
    width: 40px; height: 3px; background: #a78bfa; margin-bottom: 16px; border-radius: 2px;
  }
  .slide-bullets .right {
    width: 65%; padding: 50px 50px;
    display: flex; flex-direction: column; justify-content: center;
  }
  .slide-bullets .bullet-item {
    display: flex; align-items: flex-start; margin-bottom: 24px;
  }
  .slide-bullets .bullet-icon {
    width: 32px; height: 32px; border-radius: 8px;
    background: linear-gradient(135deg, #ede9fe, #ddd6fe);
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; color: #6366f1; flex-shrink: 0; margin-right: 16px; margin-top: 2px;
  }
  .slide-bullets .bullet-text h4 {
    font-family: 'Outfit', sans-serif; font-size: 16px; font-weight: 600; color: #1e1b4b; margin-bottom: 3px;
  }
  .slide-bullets .bullet-text p {
    font-size: 13px; color: #64748b; line-height: 1.5;
  }

  /* ========== SLIDE 6: Two Columns ========== */
  .slide-2col {
    background: #fefce8;
    display: flex; flex-direction: column; padding: 50px 60px;
  }
  .slide-2col .top-bar {
    display: flex; justify-content: space-between; align-items: center; margin-bottom: 36px;
  }
  .slide-2col .top-bar h2 {
    font-family: 'Playfair Display', serif; font-size: 30px; color: #1a1a1a;
  }
  .slide-2col .top-bar .pill {
    font-size: 11px; background: #fbbf24; color: #78350f;
    padding: 4px 14px; border-radius: 12px; font-weight: 600;
  }
  .slide-2col .cols {
    display: flex; gap: 40px; flex: 1;
  }
  .slide-2col .col {
    flex: 1; background: #fff; border-radius: 12px; padding: 30px;
    border: 1px solid #fde68a;
  }
  .slide-2col .col h3 {
    font-family: 'Outfit', sans-serif; font-size: 18px; font-weight: 600;
    color: #92400e; margin-bottom: 12px;
  }
  .slide-2col .col p {
    font-size: 14px; color: #78716c; line-height: 1.6;
  }

  /* ========== SLIDE 7: Three Columns with Icons ========== */
  .slide-3col {
    background: #0f172a;
    padding: 50px 60px; display: flex; flex-direction: column;
  }
  .slide-3col h2 {
    font-family: 'Outfit', sans-serif; font-size: 30px; font-weight: 700;
    color: #fff; text-align: center; margin-bottom: 40px;
  }
  .slide-3col .cols { display: flex; gap: 24px; flex: 1; }
  .slide-3col .col {
    flex: 1; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
    border-radius: 16px; padding: 30px; text-align: center;
    display: flex; flex-direction: column; align-items: center;
  }
  .slide-3col .icon-circle {
    width: 56px; height: 56px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 24px; margin-bottom: 16px;
  }
  .slide-3col .col:nth-child(1) .icon-circle { background: rgba(99,102,241,0.2); }
  .slide-3col .col:nth-child(2) .icon-circle { background: rgba(16,185,129,0.2); }
  .slide-3col .col:nth-child(3) .icon-circle { background: rgba(244,63,94,0.2); }
  .slide-3col .col h3 {
    font-family: 'Outfit', sans-serif; font-size: 18px; font-weight: 600;
    color: #fff; margin-bottom: 10px;
  }
  .slide-3col .col p { font-size: 13px; color: #94a3b8; line-height: 1.6; }

  /* ========== SLIDE 8: Bar Chart ========== */
  .slide-bar {
    background: #fff; padding: 50px 60px;
    display: flex; flex-direction: column;
  }
  .slide-bar h2 {
    font-family: 'Outfit', sans-serif; font-size: 26px; font-weight: 700;
    color: #1e293b; margin-bottom: 8px;
  }
  .slide-bar .sub { font-size: 13px; color: #94a3b8; margin-bottom: 30px; }
  .slide-bar .chart { display: flex; align-items: flex-end; gap: 20px; flex: 1; padding-bottom: 30px; }
  .slide-bar .bar-group {
    flex: 1; display: flex; flex-direction: column; align-items: center;
  }
  .slide-bar .bar {
    width: 48px; border-radius: 8px 8px 0 0;
    position: relative;
  }
  .slide-bar .bar-val {
    position: absolute; top: -22px; left: 50%; transform: translateX(-50%);
    font-size: 12px; font-weight: 700; color: #334155;
  }
  .slide-bar .bar-label {
    margin-top: 10px; font-size: 11px; color: #94a3b8; text-align: center;
  }

  /* ========== SLIDE 9: Pie/Donut Chart ========== */
  .slide-donut {
    background: #1a1a2e; padding: 50px 60px;
    display: flex; align-items: center;
  }
  .slide-donut .info { flex: 1; padding-right: 40px; }
  .slide-donut h2 {
    font-family: 'Outfit', sans-serif; font-size: 28px; font-weight: 700;
    color: #fff; margin-bottom: 10px;
  }
  .slide-donut .desc { font-size: 14px; color: #94a3b8; margin-bottom: 24px; line-height: 1.5; }
  .slide-donut .legend { display: flex; flex-direction: column; gap: 10px; }
  .slide-donut .legend-item { display: flex; align-items: center; gap: 10px; font-size: 13px; color: #e2e8f0; }
  .slide-donut .legend-dot { width: 12px; height: 12px; border-radius: 3px; }
  .slide-donut .chart-area {
    width: 260px; height: 260px; position: relative;
    display: flex; align-items: center; justify-content: center;
  }
  .slide-donut .donut-ring {
    width: 220px; height: 220px; border-radius: 50%;
    background: conic-gradient(
      #6366f1 0% 42%, #a78bfa 42% 68%, #c4b5fd 68% 85%, #312e81 85% 100%
    );
    position: relative;
  }
  .slide-donut .donut-ring::after {
    content: ''; position: absolute;
    top: 50%; left: 50%; transform: translate(-50%,-50%);
    width: 120px; height: 120px; border-radius: 50%; background: #1a1a2e;
  }
  .slide-donut .donut-center {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
    text-align: center; z-index: 2;
  }
  .slide-donut .donut-center .big { font-family: 'Outfit'; font-size: 36px; font-weight: 800; color: #fff; }
  .slide-donut .donut-center .small { font-size: 11px; color: #94a3b8; }

  /* ========== SLIDE 10: Line Chart ========== */
  .slide-line {
    background: #f0fdf4; padding: 50px 60px;
    display: flex; flex-direction: column;
  }
  .slide-line h2 {
    font-family: 'Outfit', sans-serif; font-size: 26px; font-weight: 700;
    color: #14532d; margin-bottom: 6px;
  }
  .slide-line .sub { font-size: 13px; color: #6b7280; margin-bottom: 24px; }
  .slide-line svg { flex: 1; }

  /* ========== SLIDE 11: Horizontal Timeline ========== */
  .slide-timeline-h {
    background: linear-gradient(180deg, #1e1b4b, #312e81);
    padding: 50px 60px; display: flex; flex-direction: column;
  }
  .slide-timeline-h h2 {
    font-family: 'Outfit', sans-serif; font-size: 28px; font-weight: 700;
    color: #fff; text-align: center; margin-bottom: 50px;
  }
  .slide-timeline-h .timeline {
    display: flex; align-items: flex-start; position: relative; flex: 1;
  }
  .slide-timeline-h .timeline::before {
    content: ''; position: absolute; top: 24px; left: 0; right: 0;
    height: 2px; background: rgba(255,255,255,0.15);
  }
  .slide-timeline-h .t-item {
    flex: 1; text-align: center; position: relative; padding: 0 10px;
  }
  .slide-timeline-h .t-dot {
    width: 14px; height: 14px; border-radius: 50%;
    background: #a78bfa; border: 3px solid #1e1b4b;
    margin: 17px auto 16px; position: relative; z-index: 1;
  }
  .slide-timeline-h .t-year {
    font-family: 'Space Mono', monospace; font-size: 13px;
    color: #a78bfa; font-weight: 700; margin-bottom: 8px;
  }
  .slide-timeline-h .t-title {
    font-family: 'Outfit', sans-serif; font-size: 14px; font-weight: 600;
    color: #fff; margin-bottom: 6px;
  }
  .slide-timeline-h .t-desc { font-size: 11px; color: #94a3b8; line-height: 1.5; }

  /* ========== SLIDE 12: Vertical Timeline ========== */
  .slide-timeline-v {
    background: #fff; padding: 40px 60px;
    display: flex;
  }
  .slide-timeline-v .side-title {
    writing-mode: vertical-rl; text-orientation: mixed;
    font-family: 'Outfit', sans-serif; font-size: 14px; font-weight: 700;
    color: #c7d2fe; letter-spacing: 4px; text-transform: uppercase;
    margin-right: 30px; transform: rotate(180deg);
  }
  .slide-timeline-v .tl {
    flex: 1; position: relative; padding-left: 30px;
  }
  .slide-timeline-v .tl::before {
    content: ''; position: absolute; left: 6px; top: 0; bottom: 0;
    width: 2px; background: #e0e7ff;
  }
  .slide-timeline-v .tl-item {
    position: relative; margin-bottom: 28px; padding-left: 20px;
  }
  .slide-timeline-v .tl-item::before {
    content: ''; position: absolute; left: -30px; top: 6px;
    width: 14px; height: 14px; border-radius: 50%;
    background: #6366f1; border: 3px solid #fff; box-shadow: 0 0 0 2px #c7d2fe;
  }
  .slide-timeline-v .tl-item .year {
    font-family: 'Space Mono', monospace; font-size: 11px;
    color: #6366f1; margin-bottom: 4px;
  }
  .slide-timeline-v .tl-item h4 {
    font-family: 'Outfit', sans-serif; font-size: 16px; font-weight: 600;
    color: #1e1b4b; margin-bottom: 3px;
  }
  .slide-timeline-v .tl-item p { font-size: 12px; color: #64748b; line-height: 1.5; }

  /* ========== SLIDE 13: Process Flow ========== */
  .slide-process {
    background: linear-gradient(160deg, #0c4a6e, #075985);
    padding: 50px 60px; display: flex; flex-direction: column;
  }
  .slide-process h2 {
    font-family: 'Outfit', sans-serif; font-size: 28px; font-weight: 700;
    color: #fff; text-align: center; margin-bottom: 40px;
  }
  .slide-process .steps {
    display: flex; align-items: center; justify-content: center; gap: 0; flex: 1;
  }
  .slide-process .step {
    background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12);
    border-radius: 16px; padding: 24px 20px; text-align: center;
    width: 160px;
  }
  .slide-process .step-num {
    font-family: 'Outfit'; font-size: 32px; font-weight: 800;
    background: linear-gradient(135deg, #38bdf8, #0ea5e9);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    margin-bottom: 8px;
  }
  .slide-process .step h4 {
    font-family: 'Outfit'; font-size: 14px; font-weight: 600;
    color: #fff; margin-bottom: 6px;
  }
  .slide-process .step p { font-size: 11px; color: #7dd3fc; line-height: 1.5; }
  .slide-process .arrow {
    font-size: 24px; color: rgba(255,255,255,0.3); margin: 0 8px;
  }

  /* ========== SLIDE 14: KPI Dashboard ========== */
  .slide-kpi {
    background: #18181b; padding: 50px 60px;
    display: flex; flex-direction: column;
  }
  .slide-kpi h2 {
    font-family: 'Outfit', sans-serif; font-size: 26px; font-weight: 700;
    color: #fff; margin-bottom: 30px;
  }
  .slide-kpi .metrics { display: flex; gap: 20px; margin-bottom: 24px; }
  .slide-kpi .metric {
    flex: 1; background: #27272a; border-radius: 12px; padding: 24px;
    border: 1px solid #3f3f46;
  }
  .slide-kpi .metric .label {
    font-size: 12px; color: #71717a; margin-bottom: 8px; text-transform: uppercase;
    letter-spacing: 1px;
  }
  .slide-kpi .metric .value {
    font-family: 'Outfit'; font-size: 36px; font-weight: 800; margin-bottom: 4px;
  }
  .slide-kpi .metric .change {
    font-size: 13px; font-weight: 600;
  }
  .slide-kpi .metric:nth-child(1) .value { color: #34d399; }
  .slide-kpi .metric:nth-child(2) .value { color: #60a5fa; }
  .slide-kpi .metric:nth-child(3) .value { color: #fbbf24; }
  .slide-kpi .metric:nth-child(4) .value { color: #f472b6; }
  .slide-kpi .change.up { color: #34d399; }
  .slide-kpi .change.up::before { content: '↑ '; }

  /* ========== SLIDE 15: Comparison / Vs ========== */
  .slide-vs {
    background: #faf5ff; display: flex; height: 100%;
  }
  .slide-vs .half {
    flex: 1; padding: 50px 40px;
    display: flex; flex-direction: column; justify-content: center;
  }
  .slide-vs .half.left { background: #faf5ff; }
  .slide-vs .half.right { background: #f0fdf4; }
  .slide-vs .vs-badge {
    position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%);
    width: 48px; height: 48px; border-radius: 50%; background: #1e1b4b;
    color: #fff; display: flex; align-items: center; justify-content: center;
    font-family: 'Outfit'; font-weight: 800; font-size: 14px;
    z-index: 2; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  }
  .slide-vs h3 {
    font-family: 'Outfit'; font-size: 22px; font-weight: 700;
    margin-bottom: 16px;
  }
  .slide-vs .half.left h3 { color: #6b21a8; }
  .slide-vs .half.right h3 { color: #166534; }
  .slide-vs .vs-list { list-style: none; }
  .slide-vs .vs-list li {
    font-size: 14px; margin-bottom: 12px; padding-left: 20px; position: relative;
    line-height: 1.5;
  }
  .slide-vs .half.left .vs-list li { color: #581c87; }
  .slide-vs .half.right .vs-list li { color: #14532d; }
  .slide-vs .vs-list li::before {
    content: '→'; position: absolute; left: 0; font-weight: 700;
  }

  /* ========== SLIDE 16: Pricing Table ========== */
  .slide-pricing {
    background: #0f172a; padding: 40px 50px;
    display: flex; flex-direction: column;
  }
  .slide-pricing h2 {
    font-family: 'Outfit'; font-size: 28px; font-weight: 700;
    color: #fff; text-align: center; margin-bottom: 30px;
  }
  .slide-pricing .tiers { display: flex; gap: 20px; flex: 1; align-items: stretch; }
  .slide-pricing .tier {
    flex: 1; border-radius: 16px; padding: 28px;
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
    display: flex; flex-direction: column;
  }
  .slide-pricing .tier.featured {
    background: linear-gradient(160deg, rgba(99,102,241,0.15), rgba(139,92,246,0.1));
    border-color: #6366f1;
  }
  .slide-pricing .tier-name {
    font-family: 'Outfit'; font-size: 16px; font-weight: 600; color: #94a3b8;
    margin-bottom: 8px;
  }
  .slide-pricing .tier-price {
    font-family: 'Outfit'; font-size: 38px; font-weight: 800; color: #fff;
    margin-bottom: 4px;
  }
  .slide-pricing .tier-price span { font-size: 14px; font-weight: 400; color: #64748b; }
  .slide-pricing .tier-desc { font-size: 12px; color: #64748b; margin-bottom: 20px; }
  .slide-pricing .tier-features { list-style: none; flex: 1; }
  .slide-pricing .tier-features li {
    font-size: 13px; color: #cbd5e1; padding: 6px 0; padding-left: 20px; position: relative;
  }
  .slide-pricing .tier-features li::before {
    content: '✓'; position: absolute; left: 0; color: #34d399; font-weight: 700;
  }

  /* ========== SLIDE 17: Team Grid ========== */
  .slide-team {
    background: #fff; padding: 50px 60px;
    display: flex; flex-direction: column;
  }
  .slide-team h2 {
    font-family: 'Playfair Display', serif; font-size: 30px;
    color: #1e1b4b; text-align: center; margin-bottom: 36px;
  }
  .slide-team .grid {
    display: flex; gap: 24px; justify-content: center; flex: 1; align-items: center;
  }
  .slide-team .member { text-align: center; width: 140px; }
  .slide-team .avatar {
    width: 80px; height: 80px; border-radius: 50%; margin: 0 auto 12px;
    display: flex; align-items: center; justify-content: center;
    font-size: 28px;
  }
  .slide-team .member:nth-child(1) .avatar { background: #ede9fe; }
  .slide-team .member:nth-child(2) .avatar { background: #fef3c7; }
  .slide-team .member:nth-child(3) .avatar { background: #dcfce7; }
  .slide-team .member:nth-child(4) .avatar { background: #fce7f3; }
  .slide-team .member h4 {
    font-family: 'Outfit'; font-size: 15px; font-weight: 600; color: #1e1b4b;
    margin-bottom: 2px;
  }
  .slide-team .member .role { font-size: 12px; color: #6366f1; margin-bottom: 4px; }
  .slide-team .member .bio { font-size: 11px; color: #94a3b8; line-height: 1.4; }

  /* ========== SLIDE 18: Image + Text (Simulated) ========== */
  .slide-imgtext {
    background: #fff; display: flex;
  }
  .slide-imgtext .img-side {
    width: 45%;
    background: linear-gradient(160deg, #312e81, #6366f1);
    display: flex; align-items: center; justify-content: center;
    position: relative; overflow: hidden;
  }
  .slide-imgtext .img-side .deco1 {
    width: 200px; height: 200px; border-radius: 50%;
    border: 2px solid rgba(255,255,255,0.1);
    position: absolute; top: -40px; right: -40px;
  }
  .slide-imgtext .img-side .deco2 {
    width: 140px; height: 140px; border-radius: 50%;
    background: rgba(255,255,255,0.05);
    position: absolute; bottom: -20px; left: -20px;
  }
  .slide-imgtext .img-side .icon-big {
    font-size: 80px; position: relative; z-index: 1;
    filter: drop-shadow(0 10px 20px rgba(0,0,0,0.3));
  }
  .slide-imgtext .text-side {
    width: 55%; padding: 50px;
    display: flex; flex-direction: column; justify-content: center;
  }
  .slide-imgtext .text-side h2 {
    font-family: 'Outfit'; font-size: 28px; font-weight: 700;
    color: #1e1b4b; margin-bottom: 16px; line-height: 1.3;
  }
  .slide-imgtext .text-side p {
    font-size: 14px; color: #64748b; line-height: 1.7; margin-bottom: 20px;
  }
  .slide-imgtext .text-side .cta {
    display: inline-block; background: #6366f1; color: #fff;
    padding: 10px 24px; border-radius: 8px; font-size: 13px; font-weight: 600;
    text-decoration: none; width: fit-content;
  }

  /* ========== SLIDE 19: Funnel ========== */
  .slide-funnel {
    background: linear-gradient(160deg, #0c0a1a, #1a1145);
    padding: 50px 60px; display: flex; align-items: center;
  }
  .slide-funnel .info { width: 40%; }
  .slide-funnel h2 {
    font-family: 'Outfit'; font-size: 28px; font-weight: 700;
    color: #fff; margin-bottom: 10px;
  }
  .slide-funnel .desc { font-size: 14px; color: #94a3b8; line-height: 1.6; }
  .slide-funnel .funnel-chart {
    width: 60%; display: flex; flex-direction: column; align-items: center; gap: 6px;
  }
  .slide-funnel .funnel-step {
    height: 52px; border-radius: 8px; display: flex;
    align-items: center; justify-content: space-between;
    padding: 0 24px; color: #fff; font-size: 14px; font-weight: 500;
    position: relative;
  }
  .slide-funnel .funnel-step .f-val {
    font-family: 'Outfit'; font-weight: 800; font-size: 18px;
  }

  /* ========== SLIDE 20: Thank You / CTA ========== */
  .slide-thankyou {
    background: linear-gradient(160deg, #1e1b4b, #312e81);
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    text-align: center; padding: 60px;
    position: relative; overflow: hidden;
  }
  .slide-thankyou::before {
    content: '';
    position: absolute; width: 600px; height: 600px;
    background: radial-gradient(circle, rgba(168,85,247,0.12), transparent 70%);
    top: -200px; left: 50%; transform: translateX(-50%);
  }
  .slide-thankyou::after {
    content: '';
    position: absolute; width: 400px; height: 400px;
    background: radial-gradient(circle, rgba(99,102,241,0.1), transparent 70%);
    bottom: -200px; right: -100px;
  }
  .slide-thankyou .emoji { font-size: 48px; margin-bottom: 20px; position: relative; z-index: 1; }
  .slide-thankyou h2 {
    font-family: 'Playfair Display', serif; font-size: 48px;
    color: #fff; margin-bottom: 12px; position: relative; z-index: 1;
  }
  .slide-thankyou .msg {
    font-size: 16px; color: #a5b4fc; max-width: 500px; line-height: 1.6;
    margin-bottom: 30px; position: relative; z-index: 1;
  }
  .slide-thankyou .contact-row {
    display: flex; gap: 24px; position: relative; z-index: 1;
  }
  .slide-thankyou .contact-item {
    font-size: 13px; color: #c7d2fe;
    background: rgba(255,255,255,0.06); padding: 8px 20px;
    border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);
  }

  /* Responsive */
  @media (max-width: 700px) {
    :root { --scale: 0.38; }
    .slide-wrapper {
      width: calc(var(--slide-w) * 0.38);
      height: calc(var(--slide-h) * 0.38);
    }
    .page-header h1 { font-size: 2rem; }
  }
</style>
</head>
<body>

<div class="page-header">
  <div class="badge">Slide Template Gallery</div>
  <h1>The Future of AI Coworkers</h1>
  <p>20 production-ready slide templates across different layouts, chart types, and visual styles — all themed around the AI-powered workplace.</p>
</div>

<!-- ===== SLIDE 1: Title Slide — Dark Gradient ===== -->
<div class="slide-section">
  <div class="section-label">01 / Title Slide</div>
  <div class="section-title">Dark Gradient Title</div>
  <div class="section-desc">Hero opening slide with gradient text and atmospheric glow</div>
  <div class="slide-wrapper">
    <div class="slide-frame slide-title-dark">
      <div class="overline">Keynote 2026</div>
      <h1>The Future of<br>AI Coworkers</h1>
      <div class="subtitle">How intelligent agents are transforming collaboration, creativity, and the way teams build together.</div>
    </div>
  </div>
</div>

<!-- ===== SLIDE 2: Title Slide — Light Minimal ===== -->
<div class="slide-section">
  <div class="section-label">02 / Title Slide</div>
  <div class="section-title">Light Editorial Title</div>
  <div class="section-desc">Clean, warm title slide with serif typography and an editorial feel</div>
  <div class="slide-wrapper">
    <div class="slide-frame slide-title-light">
      <div class="tag">Industry Report 2026</div>
      <h1>Working Alongside AI</h1>
      <div class="subtitle">A comprehensive look at how AI coworkers are augmenting human potential across every industry, from startups to the Fortune 500.</div>
    </div>
  </div>
</div>

<!-- ===== SLIDE 3: Section Divider ===== -->
<div class="slide-section">
  <div class="section-label">03 / Section Divider</div>
  <div class="section-title">Chapter Break</div>
  <div class="section-desc">Dramatic section separator with oversized background number</div>
  <div class="slide-wrapper">
    <div class="slide-frame slide-divider">
      <div class="big-num">01</div>
      <div class="content">
        <div class="section-num">Section One</div>
        <h2>The Rise of Intelligent Collaboration</h2>
        <div class="line"></div>
      </div>
    </div>
  </div>
</div>

<!-- ===== SLIDE 4: Big Statement ===== -->
<div class="slide-section">
  <div class="section-label">04 / Quote / Statement</div>
  <div class="section-title">Big Statement Slide</div>
  <div class="section-desc">Full-color background with a bold quote or key takeaway</div>
  <div class="slide-wrapper">
    <div class="slide-frame slide-statement">
      <blockquote>AI coworkers don't replace human creativity — they amplify it, handling the routine so teams can focus on the extraordinary.</blockquote>
      <div class="attr">— Annual Workplace Intelligence Report, 2026</div>
    </div>
  </div>
</div>

<!-- ===== SLIDE 5: Bullet List ===== -->
<div class="slide-section">
  <div class="section-label">05 / Bullet List</div>
  <div class="section-title">Split Panel with Bullets</div>
  <div class="section-desc">Dark sidebar with title, light content area with icon-accented bullets</div>
  <div class="slide-wrapper">
    <div class="slide-frame slide-bullets">
      <div class="left">
        <div class="accent"></div>
        <h2>Key Benefits of AI Coworkers</h2>
      </div>
      <div class="right">
        <div class="bullet-item">
          <div class="bullet-icon">⚡</div>
          <div class="bullet-text">
            <h4>10x Faster Research</h4>
            <p>AI agents synthesize thousands of documents in seconds, surfacing insights that would take humans weeks.</p>
          </div>
        </div>
        <div class="bullet-item">
          <div class="bullet-icon">🎯</div>
          <div class="bullet-text">
            <h4>Proactive Task Management</h4>
            <p>Intelligent assistants anticipate next steps, draft follow-ups, and keep projects on track automatically.</p>
          </div>
        </div>
        <div class="bullet-item">
          <div class="bullet-icon">🤝</div>
          <div class="bullet-text">
            <h4>Always-On Collaboration</h4>
            <p>AI coworkers bridge time zones, summarize meetings, and ensure no team member is ever out of the loop.</p>
          </div>
        </div>
        <div class="bullet-item">
          <div class="bullet-icon">📈</div>
          <div class="bullet-text">
            <h4>Continuous Learning</h4>
            <p>Each interaction makes the AI smarter — building a compounding knowledge base for your entire organization.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ===== SLIDE 6: Two Columns ===== -->
<div class="slide-section">
  <div class="section-label">06 / Two Columns</div>
  <div class="section-title">Warm Two-Column Layout</div>
  <div class="section-desc">Side-by-side content cards on a warm yellow background</div>
  <div class="slide-wrapper">
    <div class="slide-frame slide-2col">
      <div class="top-bar">
        <h2>Two Modes of AI Collaboration</h2>
        <div class="pill">Framework</div>
      </div>
      <div class="cols">
        <div class="col">
          <h3>🧠 Thinking Partner</h3>
          <p>AI coworkers serve as brainstorming partners that challenge assumptions, offer alternative perspectives, and help teams explore ideas they wouldn't have considered alone. They bring pattern recognition across vast datasets to creative problem-solving sessions.</p>
        </div>
        <div class="col">
          <h3>⚙️ Execution Engine</h3>
          <p>From drafting reports to analyzing data pipelines, AI coworkers handle the heavy lifting of execution. They turn rough outlines into polished deliverables, automate repetitive workflows, and free humans to focus on strategy and relationship building.</p>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ===== SLIDE 7: Three Columns with Icons ===== -->
<div class="slide-section">
  <div class="section-label">07 / Three Columns</div>
  <div class="section-title">Dark Three-Column Feature Cards</div>
  <div class="section-desc">Glassmorphic cards with icon accents on a dark background</div>
  <div class="slide-wrapper">
    <div class="slide-frame slide-3col">
      <h2>Core Capabilities</h2>
      <div class="cols">
        <div class="col">
          <div class="icon-circle">🔍</div>
          <h3>Deep Research</h3>
          <p>Analyze millions of data points across your organization's knowledge base to surface critical insights and connections.</p>
        </div>
        <div class="col">
          <div class="icon-circle">✍️</div>
          <h3>Content Creation</h3>
          <p>Draft, edit, and refine documents, presentations, and communications tailored to your brand voice and standards.</p>
        </div>
        <div class="col">
          <div class="icon-circle">🔗</div>
          <h3>Workflow Orchestration</h3>
          <p>Connect tools, automate handoffs, and ensure seamless execution across your entire tech stack and team.</p>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ===== SLIDE 8: Bar Chart ===== -->
<div class="slide-section">
  <div class="section-label">08 / Bar Chart</div>
  <div class="section-title">Vertical Bar Chart</div>
  <div class="section-desc">Clean data visualization with gradient bars on white</div>
  <div class="slide-wrapper">
    <div class="slide-frame slide-bar">
      <h2>Productivity Gains by Department</h2>
      <div class="sub">Average hours saved per week after AI coworker deployment</div>
      <div class="chart">
        <div class="bar-group">
          <div class="bar" style="height:180px;background:linear-gradient(180deg,#6366f1,#818cf8);">
            <div class="bar-val">18h</div>
          </div>
          <div class="bar-label">Engineering</div>
        </div>
        <div class="bar-group">
          <div class="bar" style="height:150px;background:linear-gradient(180deg,#8b5cf6,#a78bfa);">
            <div class="bar-val">15h</div>
          </div>
          <div class="bar-label">Marketing</div>
        </div>
        <div class="bar-group">
          <div class="bar" style="height:220px;background:linear-gradient(180deg,#6366f1,#818cf8);">
            <div class="bar-val">22h</div>
          </div>
          <div class="bar-label">Sales</div>
        </div>
        <div class="bar-group">
          <div class="bar" style="height:130px;background:linear-gradient(180deg,#a78bfa,#c4b5fd);">
            <div class="bar-val">13h</div>
          </div>
          <div class="bar-label">Design</div>
        </div>
        <div class="bar-group">
          <div class="bar" style="height:200px;background:linear-gradient(180deg,#6366f1,#818cf8);">
            <div class="bar-val">20h</div>
          </div>
          <div class="bar-label">Operations</div>
        </div>
        <div class="bar-group">
          <div class="bar" style="height:160px;background:linear-gradient(180deg,#8b5cf6,#a78bfa);">
            <div class="bar-val">16h</div>
          </div>
          <div class="bar-label">Finance</div>
        </div>
        <div class="bar-group">
          <div class="bar" style="height:140px;background:linear-gradient(180deg,#a78bfa,#c4b5fd);">
            <div class="bar-val">14h</div>
          </div>
          <div class="bar-label">HR</div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ===== SLIDE 9: Donut Chart ===== -->
<div class="slide-section">
  <div class="section-label">09 / Donut Chart</div>
  <div class="section-title">Donut Chart with Legend</div>
  <div class="section-desc">Dark split layout with donut visualization and data legend</div>
  <div class="slide-wrapper">
    <div class="slide-frame slide-donut">
      <div class="info">
        <h2>How Teams Use AI Coworkers</h2>
        <div class="desc">Survey of 5,000+ professionals on their primary use cases for AI collaboration in the workplace.</div>
        <div class="legend">
          <div class="legend-item"><div class="legend-dot" style="background:#6366f1;"></div>Research & Analysis — 42%</div>
          <div class="legend-item"><div class="legend-dot" style="background:#a78bfa;"></div>Content Drafting — 26%</div>
          <div class="legend-item"><div class="legend-dot" style="background:#c4b5fd;"></div>Code & Engineering — 17%</div>
          <div class="legend-item"><div class="legend-dot" style="background:#312e81;"></div>Meeting Summaries — 15%</div>
        </div>
      </div>
      <div class="chart-area">
        <div class="donut-ring"></div>
        <div class="donut-center">
          <div class="big">5K+</div>
          <div class="small">respondents</div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ===== SLIDE 10: Line Chart ===== -->
<div class="slide-section">
  <div class="section-label">10 / Line Chart</div>
  <div class="section-title">Trend Line Chart</div>
  <div class="section-desc">Light green theme with SVG line chart showing growth trajectory</div>
  <div class="slide-wrapper">
    <div class="slide-frame slide-line">
      <h2>AI Coworker Adoption Rate</h2>
      <div class="sub">Percentage of Fortune 500 companies with deployed AI agents, 2022–2026</div>
      <svg viewBox="0 0 840 320" style="flex:1;padding:10px 0;">
        <!-- Grid lines -->
        <line x1="60" y1="20" x2="60" y2="280" stroke="#d1fae5" stroke-width="1"/>
        <line x1="60" y1="280" x2="800" y2="280" stroke="#d1fae5" stroke-width="1"/>
        <line x1="60" y1="215" x2="800" y2="215" stroke="#d1fae5" stroke-width="0.5" stroke-dasharray="4"/>
        <line x1="60" y1="150" x2="800" y2="150" stroke="#d1fae5" stroke-width="0.5" stroke-dasharray="4"/>
        <line x1="60" y1="85" x2="800" y2="85" stroke="#d1fae5" stroke-width="0.5" stroke-dasharray="4"/>
        <line x1="60" y1="20" x2="800" y2="20" stroke="#d1fae5" stroke-width="0.5" stroke-dasharray="4"/>
        <!-- Y-axis labels -->
        <text x="50" y="284" text-anchor="end" fill="#6b7280" font-size="11" font-family="DM Sans">0%</text>
        <text x="50" y="219" text-anchor="end" fill="#6b7280" font-size="11" font-family="DM Sans">25%</text>
        <text x="50" y="154" text-anchor="end" fill="#6b7280" font-size="11" font-family="DM Sans">50%</text>
        <text x="50" y="89" text-anchor="end" fill="#6b7280" font-size="11" font-family="DM Sans">75%</text>
        <text x="50" y="24" text-anchor="end" fill="#6b7280" font-size="11" font-family="DM Sans">100%</text>
        <!-- Area fill -->
        <path d="M 60,280 L 208,254 L 356,215 L 504,150 L 652,85 L 800,32 L 800,280 Z" fill="url(#greenGrad)" opacity="0.3"/>
        <defs>
          <linearGradient id="greenGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#16a34a" stop-opacity="0.4"/>
            <stop offset="100%" stop-color="#16a34a" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <!-- Line -->
        <polyline points="60,254 208,230 356,189 504,124 652,62 800,22" fill="none" stroke="#16a34a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <!-- Dots -->
        <circle cx="60" cy="254" r="5" fill="#16a34a"/>
        <circle cx="208" cy="230" r="5" fill="#16a34a"/>
        <circle cx="356" cy="189" r="5" fill="#16a34a"/>
        <circle cx="504" cy="124" r="5" fill="#16a34a"/>
        <circle cx="652" cy="62" r="5" fill="#16a34a"/>
        <circle cx="800" cy="22" r="6" fill="#fff" stroke="#16a34a" stroke-width="3"/>
        <!-- X-axis labels -->
        <text x="60" y="300" text-anchor="middle" fill="#6b7280" font-size="12" font-family="DM Sans">2021</text>
        <text x="208" y="300" text-anchor="middle" fill="#6b7280" font-size="12" font-family="DM Sans">2022</text>
        <text x="356" y="300" text-anchor="middle" fill="#6b7280" font-size="12" font-family="DM Sans">2023</text>
        <text x="504" y="300" text-anchor="middle" fill="#6b7280" font-size="12" font-family="DM Sans">2024</text>
        <text x="652" y="300" text-anchor="middle" fill="#6b7280" font-size="12" font-family="DM Sans">2025</text>
        <text x="800" y="300" text-anchor="middle" fill="#16a34a" font-size="12" font-weight="700" font-family="DM Sans">2026</text>
        <!-- Data labels -->
        <text x="60" y="244" text-anchor="middle" fill="#14532d" font-size="11" font-weight="700" font-family="DM Sans">10%</text>
        <text x="208" y="220" text-anchor="middle" fill="#14532d" font-size="11" font-weight="700" font-family="DM Sans">19%</text>
        <text x="356" y="179" text-anchor="middle" fill="#14532d" font-size="11" font-weight="700" font-family="DM Sans">35%</text>
        <text x="504" y="114" text-anchor="middle" fill="#14532d" font-size="11" font-weight="700" font-family="DM Sans">60%</text>
        <text x="652" y="52" text-anchor="middle" fill="#14532d" font-size="11" font-weight="700" font-family="DM Sans">84%</text>
        <text x="800" y="14" text-anchor="middle" fill="#16a34a" font-size="12" font-weight="700" font-family="DM Sans">99%</text>
      </svg>
    </div>
  </div>
</div>

<!-- ===== SLIDE 11: Horizontal Timeline ===== -->
<div class="slide-section">
  <div class="section-label">11 / Horizontal Timeline</div>
  <div class="section-title">Evolution Timeline</div>
  <div class="section-desc">Dark purple with connected milestone dots and descriptions</div>
  <div class="slide-wrapper">
    <div class="slide-frame slide-timeline-h">
      <h2>The Evolution of AI Coworkers</h2>
      <div class="timeline">
        <div class="t-item">
          <div class="t-year">2020</div>
          <div class="t-dot"></div>
          <div class="t-title">Basic Chatbots</div>
          <div class="t-desc">Simple Q&A bots handling repetitive customer queries</div>
        </div>
        <div class="t-item">
          <div class="t-year">2022</div>
          <div class="t-dot"></div>
          <div class="t-title">LLM Assistants</div>
          <div class="t-desc">General-purpose AI for writing, analysis, and coding tasks</div>
        </div>
        <div class="t-item">
          <div class="t-year">2024</div>
          <div class="t-dot"></div>
          <div class="t-title">AI Agents</div>
          <div class="t-desc">Autonomous agents that plan, execute, and iterate on complex workflows</div>
        </div>
        <div class="t-item">
          <div class="t-year">2026</div>
          <div class="t-dot" style="background:#fbbf24;"></div>
          <div class="t-title">AI Coworkers</div>
          <div class="t-desc">Persistent, context-aware teammates with memory and deep integrations</div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ===== SLIDE 12: Vertical Timeline ===== -->
<div class="slide-section">
  <div class="section-label">12 / Vertical Timeline</div>
  <div class="section-title">Light Vertical Timeline</div>
  <div class="section-desc">Clean white layout with a vertical progression of milestones</div>
  <div class="slide-wrapper">
    <div class="slide-frame slide-timeline-v">
      <div class="side-title">Roadmap</div>
      <div class="tl">
        <div class="tl-item">
          <div class="year">Q1 2026</div>
          <h4>Launch AI Knowledge Graph</h4>
          <p>Persistent memory layer that maps relationships across all work data — emails, meetings, docs.</p>
        </div>
        <div class="tl-item">
          <div class="year">Q2 2026</div>
          <h4>Multi-Agent Orchestration</h4>
          <p>Deploy specialized agents that collaborate — research agent, writing agent, code agent — working in concert.</p>
        </div>
        <div class="tl-item">
          <div class="year">Q3 2026</div>
          <h4>Proactive Insights Engine</h4>
          <p>AI coworker surfaces insights before you ask — flagging risks, opportunities, and action items automatically.</p>
        </div>
        <div class="tl-item">
          <div class="year">Q4 2026</div>
          <h4>Full Workflow Autonomy</h4>
          <p>End-to-end autonomous task completion with human-in-the-loop oversight for critical decisions.</p>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ===== SLIDE 13: Process Flow ===== -->
<div class="slide-section">
  <div class="section-label">13 / Process Flow</div>
  <div class="section-title">Step-by-Step Process</div>
  <div class="section-desc">Ocean blue gradient with connected process steps and arrows</div>
  <div class="slide-wrapper">
    <div class="slide-frame slide-process">
      <h2>How AI Coworkers Learn Your Workflow</h2>
      <div class="steps">
        <div class="step">
          <div class="step-num">01</div>
          <h4>Connect</h4>
          <p>Integrate with your tools — email, calendar, Slack, docs</p>
        </div>
        <div class="arrow">→</div>
        <div class="step">
          <div class="step-num">02</div>
          <h4>Observe</h4>
          <p>AI maps your workflows, relationships, and patterns</p>
        </div>
        <div class="arrow">→</div>
        <div class="step">
          <div class="step-num">03</div>
          <h4>Assist</h4>
          <p>Proactively suggests actions and drafts deliverables</p>
        </div>
        <div class="arrow">→</div>
        <div class="step">
          <div class="step-num">04</div>
          <h4>Evolve</h4>
          <p>Gets smarter with every interaction, compounding value</p>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ===== SLIDE 14: KPI Dashboard ===== -->
<div class="slide-section">
  <div class="section-label">14 / KPI Dashboard</div>
  <div class="section-title">Metrics Dashboard</div>
  <div class="section-desc">Dark zinc theme with color-coded metric cards</div>
  <div class="slide-wrapper">
    <div class="slide-frame slide-kpi">
      <h2>Impact Metrics — Q4 2026</h2>
      <div class="metrics">
        <div class="metric">
          <div class="label">Tasks Automated</div>
          <div class="value">12.4K</div>
          <div class="change up">34% vs Q3</div>
        </div>
        <div class="metric">
          <div class="label">Hours Saved / Week</div>
          <div class="value">847</div>
          <div class="change up">22% vs Q3</div>
        </div>
        <div class="metric">
          <div class="label">Team Satisfaction</div>
          <div class="value">94%</div>
          <div class="change up">8pts vs Q3</div>
        </div>
        <div class="metric">
          <div class="label">ROI Multiple</div>
          <div class="value">11.2x</div>
          <div class="change up">2.1x vs Q3</div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ===== SLIDE 15: Comparison / Vs ===== -->
<div class="slide-section">
  <div class="section-label">15 / Comparison</div>
  <div class="section-title">Side-by-Side Comparison</div>
  <div class="section-desc">Split layout with contrasting colors for before/after or A vs B</div>
  <div class="slide-wrapper">
    <div class="slide-frame slide-vs">
      <div class="half left">
        <h3>Traditional Workflow</h3>
        <ul class="vs-list">
          <li>Manual research across scattered sources</li>
          <li>Hours spent formatting reports and decks</li>
          <li>Context lost between meetings and tools</li>
          <li>Repetitive tasks drain creative energy</li>
          <li>Knowledge silos across the org</li>
        </ul>
      </div>
      <div class="vs-badge">VS</div>
      <div class="half right">
        <h3>With AI Coworkers</h3>
        <ul class="vs-list">
          <li>Instant synthesis from all data sources</li>
          <li>Auto-generated first drafts in seconds</li>
          <li>Persistent memory across every interaction</li>
          <li>Automation frees focus for high-impact work</li>
          <li>Shared intelligence for the entire team</li>
        </ul>
      </div>
    </div>
  </div>
</div>

<!-- ===== SLIDE 16: Pricing Table ===== -->
<div class="slide-section">
  <div class="section-label">16 / Pricing Table</div>
  <div class="section-title">Tiered Pricing</div>
  <div class="section-desc">Dark theme with featured tier highlight</div>
  <div class="slide-wrapper">
    <div class="slide-frame slide-pricing">
      <h2>Choose Your AI Coworker Plan</h2>
      <div class="tiers">
        <div class="tier">
          <div class="tier-name">Starter</div>
          <div class="tier-price">$29<span>/mo</span></div>
          <div class="tier-desc">For individuals getting started</div>
          <ul class="tier-features">
            <li>1 AI coworker agent</li>
            <li>5 tool integrations</li>
            <li>10K messages / month</li>
            <li>7-day memory window</li>
          </ul>
        </div>
        <div class="tier featured">
          <div class="tier-name">Team ⭐</div>
          <div class="tier-price">$99<span>/mo</span></div>
          <div class="tier-desc">For growing teams</div>
          <ul class="tier-features">
            <li>5 AI coworker agents</li>
            <li>Unlimited integrations</li>
            <li>Unlimited messages</li>
            <li>Persistent memory</li>
            <li>Knowledge graph</li>
          </ul>
        </div>
        <div class="tier">
          <div class="tier-name">Enterprise</div>
          <div class="tier-price">Custom</div>
          <div class="tier-desc">For large organizations</div>
          <ul class="tier-features">
            <li>Unlimited agents</li>
            <li>Custom model training</li>
            <li>SSO & compliance</li>
            <li>Dedicated support</li>
            <li>On-premise option</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ===== SLIDE 17: Team Grid ===== -->
<div class="slide-section">
  <div class="section-label">17 / Team Grid</div>
  <div class="section-title">Team Members</div>
  <div class="section-desc">Light layout with avatar circles and role descriptions</div>
  <div class="slide-wrapper">
    <div class="slide-frame slide-team">
      <h2>Meet Your AI Team</h2>
      <div class="grid">
        <div class="member">
          <div class="avatar">🔬</div>
          <h4>Research Agent</h4>
          <div class="role">Deep Analysis</div>
          <div class="bio">Scans thousands of sources to deliver synthesized insights in seconds</div>
        </div>
        <div class="member">
          <div class="avatar">✏️</div>
          <h4>Writing Agent</h4>
          <div class="role">Content Creation</div>
          <div class="bio">Drafts, edits, and polishes documents in your brand voice</div>
        </div>
        <div class="member">
          <div class="avatar">💻</div>
          <h4>Code Agent</h4>
          <div class="role">Engineering</div>
          <div class="bio">Writes, reviews, and debugs code across your entire stack</div>
        </div>
        <div class="member">
          <div class="avatar">📊</div>
          <h4>Data Agent</h4>
          <div class="role">Analytics</div>
          <div class="bio">Transforms raw data into dashboards and actionable reports</div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ===== SLIDE 18: Image + Text ===== -->
<div class="slide-section">
  <div class="section-label">18 / Image + Text</div>
  <div class="section-title">Visual Storytelling Split</div>
  <div class="section-desc">Left visual panel with decorative elements, right content with CTA</div>
  <div class="slide-wrapper">
    <div class="slide-frame slide-imgtext">
      <div class="img-side">
        <div class="deco1"></div>
        <div class="deco2"></div>
        <div class="icon-big">🤖</div>
      </div>
      <div class="text-side">
        <h2>Your AI Coworker Remembers Everything</h2>
        <p>Unlike session-based tools that forget after every chat, AI coworkers build persistent knowledge graphs from your emails, meetings, and documents — compounding intelligence over time.</p>
        <a class="cta" href="#">See It In Action →</a>
      </div>
    </div>
  </div>
</div>

<!-- ===== SLIDE 19: Funnel Diagram ===== -->
<div class="slide-section">
  <div class="section-label">19 / Funnel Diagram</div>
  <div class="section-title">Conversion Funnel</div>
  <div class="section-desc">Dark cosmic theme with tapered funnel stages</div>
  <div class="slide-wrapper">
    <div class="slide-frame slide-funnel">
      <div class="info">
        <h2>AI Coworker Adoption Funnel</h2>
        <div class="desc">From first touch to full deployment — how organizations onboard their AI teammates.</div>
      </div>
      <div class="funnel-chart">
        <div class="funnel-step" style="width:90%;background:linear-gradient(90deg,#6366f1,#818cf8);">
          <span>Discovery & Demo</span><span class="f-val">10,000</span>
        </div>
        <div class="funnel-step" style="width:72%;background:linear-gradient(90deg,#7c3aed,#8b5cf6);">
          <span>Free Trial</span><span class="f-val">6,200</span>
        </div>
        <div class="funnel-step" style="width:54%;background:linear-gradient(90deg,#9333ea,#a855f7);">
          <span>Active Usage</span><span class="f-val">3,800</span>
        </div>
        <div class="funnel-step" style="width:38%;background:linear-gradient(90deg,#a855f7,#c084fc);">
          <span>Paid Conversion</span><span class="f-val">2,100</span>
        </div>
        <div class="funnel-step" style="width:24%;background:linear-gradient(90deg,#c084fc,#d8b4fe);">
          <span>Enterprise Deploy</span><span class="f-val">940</span>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ===== SLIDE 20: Thank You / CTA ===== -->
<div class="slide-section">
  <div class="section-label">20 / Closing Slide</div>
  <div class="section-title">Thank You & CTA</div>
  <div class="section-desc">Atmospheric closing slide with contact details and next steps</div>
  <div class="slide-wrapper">
    <div class="slide-frame slide-thankyou">
      <div class="emoji">🚀</div>
      <h2>Thank You</h2>
      <div class="msg">The future of work isn't about replacing humans — it's about giving every person an incredible AI teammate. Let's build it together.</div>
      <div class="contact-row">
        <div class="contact-item">📧 hello@aico.ai</div>
        <div class="contact-item">🌐 aico.ai</div>
        <div class="contact-item">🐦 @aico_ai</div>
      </div>
    </div>
  </div>
</div>

</body>
</html>

`;

export default skill;