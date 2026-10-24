-- New tables for Tonight's Pick + Where to Stream.
-- Run once against your local database:  psql -d <your_db> -f features/schema.sql
-- Nothing here alters or depends on structural changes to your existing tables.

-- Maps a saved movie (name + poster, exactly as stored in watched / watch_later /
-- recommendations) to its TMDB id and genres, so we only search TMDB once per movie.
CREATE TABLE IF NOT EXISTS movie_meta (
    movie_name   TEXT        NOT NULL,
    poster       TEXT        NOT NULL DEFAULT '',
    tmdb_id      INTEGER,                         -- NULL = TMDB had no match
    genre_ids    INTEGER[]   NOT NULL DEFAULT '{}',
    release_date TEXT,
    fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (movie_name, poster)
);

-- Caches TMDB watch-provider results per movie and region (refreshed after 24h).
CREATE TABLE IF NOT EXISTS watch_providers (
    tmdb_id    INTEGER     NOT NULL,
    region     CHAR(2)     NOT NULL,
    data       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tmdb_id, region)
);
