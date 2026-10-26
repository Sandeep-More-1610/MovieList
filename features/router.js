// Tonight's Pick (watch-party picker) + Where to Stream.
// Self-contained Express router; uses the same tables and TMDB token as index.js
// plus the two new tables in features/schema.sql.

import express from "express";
import fs from "fs";

const TMDB = "https://api.themoviedb.org/3";
const REGION = (process.env.WATCH_REGION || "IN").toUpperCase();
const PROVIDER_TTL = "24 hours";
const NO_MATCH_RETRY = "7 days";
const MAX_PICKS = 20;
const MAX_FALLBACK = 12;

const GENRES = JSON.parse(fs.readFileSync(new URL("../genres.json", import.meta.url), "utf8"));

async function tmdb(path, params = {}) {
  const url = new URL(TMDB + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.TMDB_TOKEN}`, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`TMDB ${r.status} on ${path}`);
  return r.json();
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx]); } catch (e) { console.log(e); out[idx] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

const byPopularity = (a, b) => (b.popularity || 0) - (a.popularity || 0);

function pickRandom(list, last) {
  const pool = list.length > 1 ? list.filter((m) => m.movie_name !== last) : list;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function createFeaturesRouter(db) {
  const router = express.Router();

  async function resolveMeta(name, poster) {
    poster = poster || "";
    const cached = await db.query(
      `SELECT tmdb_id, genre_ids FROM movie_meta
       WHERE movie_name=$1 AND poster=$2
         AND (tmdb_id IS NOT NULL OR fetched_at > NOW() - INTERVAL '${NO_MATCH_RETRY}')`,
      [name, poster]
    );
    if (cached.rows.length > 0) return cached.rows[0];

    const data = await tmdb("/search/movie", { query: name, include_adult: "false" });
    const results = (data.results || []).slice();
    const match =
      (poster && results.find((r) => r.poster_path === poster)) ||
      results.filter((r) => r.original_title === name).sort(byPopularity)[0] ||
      results.sort(byPopularity)[0] ||
      null;

    const row = {
      tmdb_id: match ? match.id : null,
      genre_ids: match ? match.genre_ids || [] : [],
    };
    await db.query(
      `INSERT INTO movie_meta (movie_name, poster, tmdb_id, genre_ids, release_date, fetched_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (movie_name, poster) DO UPDATE
         SET tmdb_id=EXCLUDED.tmdb_id, genre_ids=EXCLUDED.genre_ids,
             release_date=EXCLUDED.release_date, fetched_at=NOW()`,
      [name, poster, row.tmdb_id, row.genre_ids, match ? match.release_date || null : null]
    );
    return row;
  }

  async function getProviders(tmdbId) {
    const cached = await db.query(
      `SELECT data FROM watch_providers
       WHERE tmdb_id=$1 AND region=$2 AND fetched_at > NOW() - INTERVAL '${PROVIDER_TTL}'`,
      [tmdbId, REGION]
    );
    let regionData;
    if (cached.rows.length > 0) {
      regionData = cached.rows[0].data;
    } else {
      const data = await tmdb(`/movie/${tmdbId}/watch/providers`);
      regionData = (data.results && data.results[REGION]) || {};
      await db.query(
        `INSERT INTO watch_providers (tmdb_id, region, data, fetched_at)
         VALUES ($1,$2,$3,NOW())
         ON CONFLICT (tmdb_id, region) DO UPDATE SET data=EXCLUDED.data, fetched_at=NOW()`,
        [tmdbId, REGION, JSON.stringify(regionData)]
      );
    }
    return summarizeProviders(regionData);
  }

  function summarizeProviders(r) {
    const uniq = (list) => {
      const seen = new Set();
      return list
        .filter((p) => p && !seen.has(p.provider_id) && seen.add(p.provider_id))
        .sort((a, b) => (a.display_priority || 0) - (b.display_priority || 0))
        .map((p) => ({ name: p.provider_name, logo: p.logo_path }));
    };
    const stream = uniq([...(r.flatrate || []), ...(r.free || []), ...(r.ads || [])]);
    if (stream.length) return { kind: "stream", providers: stream, link: r.link || null };
    const rent = uniq([...(r.rent || []), ...(r.buy || [])]);
    if (rent.length) return { kind: "rent", providers: rent, link: r.link || null };
    return { kind: "none", providers: [], link: r.link || null };
  }


  function requireAuth(req, res, next) {
    if (req.isAuthenticated && req.isAuthenticated()) return next();
    if (req.path.startsWith("/api/")) return res.status(401).json({ status: "unauthenticated" });
    return res.redirect("/");
  }

  async function friendsOf(email) {
    const r = await db.query(
      "SELECT DISTINCT email_2 AS email FROM friends WHERE email_1=$1 ORDER BY email_2",
      [email]
    );
    return r.rows.map((x) => x.email);
  }

  // Movies that 2+ party members want and nobody in the party has watched.
  async function overlapPicks(party) {
    const r = await db.query(
      `SELECT wl.movie_name,
              MAX(wl.poster) AS poster,
              COUNT(DISTINCT wl.email)::int AS wanted_by,
              ARRAY_AGG(DISTINCT wl.email) AS who
       FROM watch_later wl
       WHERE wl.email = ANY($1)
         AND NOT EXISTS (
           SELECT 1 FROM watched w
           WHERE w.movie_name = wl.movie_name AND w.email = ANY($1)
         )
       GROUP BY wl.movie_name
       HAVING COUNT(DISTINCT wl.email) >= 2
       ORDER BY wanted_by DESC, wl.movie_name
       LIMIT ${MAX_PICKS}`,
      [party]
    );
    return r.rows;
  }

  // No overlap: suggest popular TMDB movies in the party's most common genres.
  async function fallbackPicks(party) {
    const lib = await db.query(
      `SELECT movie_name, MAX(poster) AS poster, COUNT(*)::int AS weight
       FROM (
         SELECT movie_name, poster FROM watched WHERE email = ANY($1)
         UNION ALL
         SELECT movie_name, poster FROM watch_later WHERE email = ANY($1)
       ) t
       GROUP BY movie_name
       ORDER BY weight DESC, movie_name
       LIMIT 40`,
      [party]
    );
    const watched = await db.query(
      "SELECT DISTINCT movie_name FROM watched WHERE email = ANY($1)",
      [party]
    );
    const seenNames = new Set(watched.rows.map((x) => x.movie_name));

    const metas = await mapLimit(lib.rows, 5, (m) => resolveMeta(m.movie_name, m.poster));
    const tally = {};
    metas.forEach((meta, i) => {
      if (!meta) return;
      for (const g of meta.genre_ids || []) tally[g] = (tally[g] || 0) + lib.rows[i].weight;
    });
    const topGenres = Object.entries(tally)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([id]) => id);

    const data = topGenres.length
      ? await tmdb("/discover/movie", {
          with_genres: topGenres.join("|"),
          sort_by: "popularity.desc",
          "vote_count.gte": 300,
          include_adult: "false",
        })
      : await tmdb("/trending/movie/week");

    const movies = (data.results || [])
      .filter((m) => m.poster_path && !seenNames.has(m.original_title))
      .slice(0, MAX_FALLBACK)
      .map((m) => ({ movie_name: m.original_title, poster: m.poster_path, tmdb_id: m.id }));

    return { movies, genres: topGenres.map((id) => GENRES[id]).filter(Boolean) };
  }

  // ── Routes ────────────────────────────────────────────────────────────────

  router.get("/tonights_pick", requireAuth, async (req, res) => {
    try {
      const friends = await friendsOf(req.user.email);
      res.render("tonights_pick.ejs", { friends, selected: [] });
    } catch (err) {
      console.log(err);
      res.redirect("/");
    }
  });

  router.post("/tonights_pick", requireAuth, async (req, res) => {
    const me = req.user.email;
    try {
      const friends = await friendsOf(me);
      let picked = req.body.friends || [];
      if (!Array.isArray(picked)) picked = [picked];
      const selected = picked.filter((f) => friends.includes(f));

      if (selected.length === 0) {
        return res.render("tonights_pick.ejs", {
          friends, selected, error: "Pick at least one friend for the party!",
        });
      }

      const party = [me, ...selected];
      const last = (req.body.last || "").toString();

      // Random pick, but only among the movies the MOST party members want.
      const overlap = await overlapPicks(party);
      if (overlap.length > 0) {
        const top = overlap[0].wanted_by;
        const tier = overlap.filter((m) => m.wanted_by === top);
        const pick = pickRandom(tier, last);
        return res.render("tonights_pick.ejs", {
          friends, selected, partySize: party.length, mode: "overlap",
          movies: [pick], poolSize: tier.length, last: pick.movie_name,
        });
      }

      const fb = await fallbackPicks(party);
      const pick = fb.movies.length ? pickRandom(fb.movies, last) : null;
      res.render("tonights_pick.ejs", {
        friends, selected, partySize: party.length, mode: "fallback",
        movies: pick ? [pick] : [], poolSize: fb.movies.length, genres: fb.genres,
        last: pick ? pick.movie_name : "",
      });
    } catch (err) {
      console.log(err);
      res.render("tonights_pick.ejs", {
        friends: [], selected: [], error: "OOPS! Nothing to Show HERE!",
      });
    }
  });

  // Where to Stream for one movie: ?id=<tmdb id>  or  ?name=<movie_name>&poster=<poster>
  router.get("/api/where_to_watch", requireAuth, async (req, res) => {
    try {
      let tmdbId = parseInt(req.query.id, 10);
      if (!tmdbId) {
        const name = (req.query.name || "").toString();
        if (!name) return res.json({ status: "error" });
        const meta = await resolveMeta(name, (req.query.poster || "").toString());
        tmdbId = meta && meta.tmdb_id;
      }
      if (!tmdbId) return res.json({ status: "done", region: REGION, kind: "none", providers: [], link: null });
      const summary = await getProviders(tmdbId);
      res.json({ status: "done", region: REGION, ...summary });
    } catch (err) {
      console.log(err);
      res.json({ status: "error" });
    }
  });

  return router;
}
