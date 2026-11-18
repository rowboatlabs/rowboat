# Rowboat Labs company site

A static page about the company: the team and a timeline of our Hacker News launches, with how each was received and what people posted on X. No build step and no third-party scripts. Open `index.html` in a browser, or serve the folder with `python3 -m http.server`.

## Where the numbers come from

The numbers are a snapshot from 2026-11-18, written into the HTML by hand.

- **Launches, points and comments:** `https://hn.algolia.com/api/v1/search_by_date?tags=story,author_segmenta`. Only Rowboat posts are on the timeline; the account's other submissions are left out.
- **Reception:** each launch's comment tree from `https://hn.algolia.com/api/v1/items/<id>`. The bullets summarize the most-replied threads.
- **Posts on X:** every post was checked with `https://api.fxtwitter.com/status/<id>`, including its text, date, likes and views.
- **Company facts:** the [YC profile](https://www.ycombinator.com/companies/rowboat-labs) and the Show HN posts.

To add a launch, add an `<article class="event">` to the timeline and update the totals in the hero.
