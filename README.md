# MovieList

Requires Node.js 20+ and PostgreSQL. TMDB search and streaming information need a TMDB API read access token.

## Local setup

1. Run `npm ci`.
2. Copy `.env.example` to `.env` and fill in PostgreSQL credentials, a session secret and your TMDB token. The old USER/HOST/DATABASE/PASSWORD variables are also supported, or use DATABASE_URL.
3. Create the PostgreSQL database, then run `psql -U postgres -d movielist -f schema.sql` and `psql -U postgres -d movielist -f features/schema.sql` from this folder. For an existing database, review its schema first: CREATE TABLE IF NOT EXISTS does not migrate existing definitions.
4. Run `npm start` and open http://localhost:3000.

Register two accounts to test friend requests, recommendations and Watch Party. Each account can search movies, add to Watch Later, move to Watched and remove movies.

## Verification

Run `npm test`. Tests use an isolated in-memory PostgreSQL emulator and stub TMDB responses; they do not touch your own database or account. Real PostgreSQL transactions and live TMDB responses must also be checked after configuration. Sessions use memory storage and are lost on server restart; use persistent session storage before deploying to production.

## Origin and changes

This is a fork of [SekiroHamada/MovieList](https://github.com/SekiroHamada/MovieList). The original author and commit history are preserved.

This fork adds AI-assisted fixes for registration/login errors, transaction isolation, friend-request validation, empty-list notifications, special characters in recommendation buttons, and encoded movie searches. It includes 16 automated regression tests, fresh-database setup scripts and environment documentation.

The tests use pg-mem and mocked TMDB responses. Live PostgreSQL and TMDB verification has not yet been completed in the local environment.
