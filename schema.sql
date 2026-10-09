CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL, category TEXT NOT NULL, event_date TEXT NOT NULL, time TEXT NOT NULL,
  venue TEXT NOT NULL, club TEXT NOT NULL,
  seats INTEGER NOT NULL CHECK (seats > 0),
  taken INTEGER NOT NULL DEFAULT 0,          -- seats already booked outside this app (demo data)
  description TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id TEXT NOT NULL,
  event_id INTEGER NOT NULL REFERENCES events(id),
  name TEXT NOT NULL, email TEXT NOT NULL, roll_number TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (student_id, event_id)              -- one registration per student per event
);
CREATE TABLE IF NOT EXISTS saved_events (
  student_id TEXT NOT NULL,
  event_id INTEGER NOT NULL REFERENCES events(id),
  PRIMARY KEY (student_id, event_id)
);
