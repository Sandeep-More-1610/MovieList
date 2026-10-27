-- Fresh database setup. Does not replace or delete existing tables.
CREATE TABLE IF NOT EXISTS credentials (
  email TEXT PRIMARY KEY,
  password TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS watched (
  email TEXT NOT NULL REFERENCES credentials(email),
  movie_name TEXT NOT NULL,
  poster TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (email, movie_name)
);
CREATE TABLE IF NOT EXISTS watch_later (
  email TEXT NOT NULL REFERENCES credentials(email),
  movie_name TEXT NOT NULL,
  poster TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (email, movie_name)
);
CREATE TABLE IF NOT EXISTS friends (
  email_1 TEXT NOT NULL REFERENCES credentials(email),
  email_2 TEXT NOT NULL REFERENCES credentials(email),
  PRIMARY KEY (email_1, email_2),
  CHECK (email_1 <> email_2)
);
CREATE TABLE IF NOT EXISTS friend_request (
  receiver TEXT NOT NULL REFERENCES credentials(email),
  sender TEXT NOT NULL REFERENCES credentials(email),
  PRIMARY KEY (receiver, sender),
  CHECK (receiver <> sender)
);
CREATE TABLE IF NOT EXISTS recommendations (
  movie_name TEXT NOT NULL,
  poster TEXT NOT NULL DEFAULT '',
  receiver TEXT NOT NULL REFERENCES credentials(email),
  sender TEXT NOT NULL REFERENCES credentials(email)
);
