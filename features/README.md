# Watch Party + Where to Stream

Mostly new files. Existing code changes: 2 lines in `index.js` (import + `app.use`), a "Watch Party" navbar button in `watched`, `watch_later`, `friends` and `search` views, and one `<script>` line in `watch_later.ejs`.

| File | What it is |
|---|---|
| `features/schema.sql` | The two new tables (`movie_meta`, `watch_providers`) |
| `features/router.js` | Routes: `GET/POST /tonights_pick`, `GET /api/where_to_watch` |
| `views/tonights_pick.ejs` | The Tonight's Pick page (same navbar, preloader, cards, buttons) |
| `public/css/tonights_pick.css` | A few small additions on top of `styles.css` / `search.css` |
| `public/js/where_to_watch.js` | Adds "Stream: Netflix · Prime Video" under any movie card |

## Setup

1. Create the tables:
   ```
   psql -U <user> -d <your_db> -f features/schema.sql
   ```
2. Optional: add `WATCH_REGION=IN` to `.env` (defaults to `IN`; any 2-letter country code works).
3. Start as usual with `npm start`, then click **Watch Party** in the navbar.

## How Watch Party works

- Pick friends from your friends list → the page shows **one random movie** from those that **2 or more people in the party** have in Watch Later and **nobody in the party** has already watched.
- The random pick only comes from the movies wanted by the **most** party members ("Perfect Match" = everyone). **Pick Another** re-rolls within that group and never repeats the previous pick back-to-back.
- If there's no overlap, it finds the party's two most common genres (from everyone's Watched + Watch Later) and picks one random popular TMDB movie in those genres that nobody has watched.
- Cards use the site's existing `/put_watched` and `/watch_later_post` endpoints.

## How Where to Stream works

- Uses TMDB's watch-providers data (JustWatch) for your region; results are cached for 24h in `watch_providers`.
- Saved movies are matched to TMDB by name + poster path (cached in `movie_meta`), so remakes don't get mixed up.
