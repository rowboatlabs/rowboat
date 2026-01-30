export const skill = String.raw`
# PDF Presentation Generator Skill

## When to Use

Activate when the user wants to create presentations, slide decks, or pitch decks.

## Workflow

1. Check ~/.rowboat/knowledge/ for relevant context about the company, product, team, etc.
2. Ensure Playwright is installed: 'npm install playwright && npx playwright install chromium'
3. Create an HTML file (e.g., /tmp/presentation.html) with slides (1280x720px each)
4. Create a Node.js script to convert HTML to PDF:

~~~javascript
// save as /tmp/convert.js
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file:///tmp/presentation.html', { waitUntil: 'networkidle' });
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

5. Run it: 'node /tmp/convert.js'
6. Tell the user: "Your presentation is ready at ~/Desktop/presentation.pdf"

Do NOT show HTML code to the user. Do NOT explain how to export. Just create the PDF and deliver it.

## PDF Export Rules

**These rules prevent rendering issues in PDF. Violating them causes overlapping rectangles and broken layouts.**

1. **No layered elements** - Never create separate elements for backgrounds or shadows. Style content elements directly.
2. **No box-shadow** - Use borders instead: \`border: 1px solid #e5e7eb\`
3. **Bullets via CSS only** - Use \`li::before\` pseudo-elements, not separate DOM elements
4. **Content must fit** - Slides are 1280x720px with 60px padding. Safe area is 1160x600px. Use \`overflow: hidden\`.

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
`;

export default skill;