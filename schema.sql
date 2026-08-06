CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  status INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  phone TEXT,
  number TEXT NOT NULL,
  amount INTEGER NOT NULL,
  bet_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  result_time TEXT NOT NULL UNIQUE,
  result_number TEXT NOT NULL DEFAULT '--',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO results (result_time, result_number) VALUES
('5:00 PM', '--'),
('6:00 PM', '--'),
('7:00 PM', '--'),
('8:00 PM', '--'),
('9:00 PM', '--'),
('10:00 PM', '--'),
('11:00 PM', '--'),
('12:00 AM', '--');
