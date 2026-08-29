CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin')),
  coins INTEGER NOT NULL DEFAULT 0,
  storage_level INTEGER NOT NULL DEFAULT 1,
  shop_level INTEGER NOT NULL DEFAULT 1,
  auction_level INTEGER NOT NULL DEFAULT 1,
  highest_region INTEGER NOT NULL DEFAULT 0,
  guild_id TEXT,
  muted_until INTEGER,
  banned_until INTEGER,
  ban_reason TEXT,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS password_resets (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  class TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  xp INTEGER NOT NULL DEFAULT 0,
  region INTEGER NOT NULL DEFAULT 1,
  round INTEGER NOT NULL DEFAULT 1,
  depth INTEGER NOT NULL DEFAULT 0,
  map_state TEXT,
  hp INTEGER NOT NULL,
  max_hp INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ALIVE' CHECK (status IN ('ALIVE', 'DEAD')),
  location TEXT NOT NULL DEFAULT 'WILD' CHECK (location IN ('WILD', 'CITY')),
  skill_pending INTEGER NOT NULL DEFAULT 0,
  skill_offers TEXT,
  loot_pending TEXT,
  talent_points INTEGER NOT NULL DEFAULT 0,
  talent_tree TEXT,
  enemies_defeated INTEGER NOT NULL DEFAULT 0,
  gold_earned INTEGER NOT NULL DEFAULT 0,
  best_item_name TEXT,
  best_item_rarity TEXT,
  loot_value INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  died_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_characters_user ON characters(user_id);
CREATE INDEX IF NOT EXISTS idx_characters_status ON characters(user_id, status);

CREATE TABLE IF NOT EXISTS item_sets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  flavor TEXT NOT NULL,
  bonus_2 TEXT NOT NULL,
  bonus_3 TEXT NOT NULL,
  bonus_4 TEXT NOT NULL,
  bonus_5 TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS item_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  slot TEXT,
  rarity_min TEXT NOT NULL,
  base_level INTEGER NOT NULL,
  required_level INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  stackable INTEGER NOT NULL DEFAULT 0,
  max_stack INTEGER NOT NULL DEFAULT 1,
  base_stats TEXT NOT NULL,
  affix_pool TEXT NOT NULL,
  set_id TEXT REFERENCES item_sets(id),
  glyph TEXT NOT NULL,
  flavor TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  sell_mult REAL NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS item_instances (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL REFERENCES item_definitions(id),
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  owner_character_id TEXT REFERENCES characters(id),
  location TEXT NOT NULL CHECK (location IN ('INVENTORY', 'EQUIPMENT', 'STORAGE', 'AUCTION', 'SHOP', 'GROUND', 'DESTROYED')),
  rarity TEXT NOT NULL,
  item_level INTEGER NOT NULL,
  required_level INTEGER NOT NULL,
  stats TEXT NOT NULL,
  affixes TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  rotated INTEGER NOT NULL DEFAULT 0,
  stack INTEGER NOT NULL DEFAULT 1,
  grid_x INTEGER,
  grid_y INTEGER,
  equip_slot TEXT,
  created_at INTEGER NOT NULL,
  destroyed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_items_owner ON item_instances(owner_user_id, location);
CREATE INDEX IF NOT EXISTS idx_items_char ON item_instances(owner_character_id, location);

CREATE TABLE IF NOT EXISTS regions (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  theme TEXT NOT NULL,
  description TEXT NOT NULL,
  min_level INTEGER NOT NULL,
  enemy_pool TEXT NOT NULL,
  elite_pool TEXT NOT NULL,
  boss_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS enemies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('normal', 'elite', 'boss')),
  hp INTEGER NOT NULL,
  damage INTEGER NOT NULL,
  armor INTEGER NOT NULL,
  crit_chance REAL NOT NULL DEFAULT 0.05,
  attack_speed REAL NOT NULL DEFAULT 1,
  dodge REAL NOT NULL DEFAULT 0,
  abilities TEXT NOT NULL,
  loot_table TEXT NOT NULL,
  region INTEGER,
  glyph TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  stats TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS character_skills (
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id),
  picked_at INTEGER NOT NULL,
  PRIMARY KEY (character_id, skill_id, picked_at)
);

CREATE TABLE IF NOT EXISTS shop_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instance_id TEXT NOT NULL REFERENCES item_instances(id),
  price INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  generated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auction_listings (
  id TEXT PRIMARY KEY,
  seller_user_id TEXT NOT NULL REFERENCES users(id),
  seller_name TEXT NOT NULL,
  instance_id TEXT NOT NULL UNIQUE REFERENCES item_instances(id),
  price INTEGER NOT NULL,
  fee_paid INTEGER NOT NULL,
  duration_hours INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'SOLD', 'EXPIRED', 'CANCELLED'))
);

CREATE INDEX IF NOT EXISTS idx_auction_open ON auction_listings(status, expires_at);

CREATE TABLE IF NOT EXISTS auction_history (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  seller_user_id TEXT NOT NULL,
  buyer_user_id TEXT,
  instance_id TEXT NOT NULL,
  price INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS guilds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  tag TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  emblem TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  leader_user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS guild_members (
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rank TEXT NOT NULL DEFAULT 'member',
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS guild_upgrades (
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  upgrade_key TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (guild_id, upgrade_key)
);

CREATE TABLE IF NOT EXISTS guild_logs (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('GLOBAL', 'REGION', 'GUILD')),
  region INTEGER,
  guild_id TEXT,
  user_id TEXT NOT NULL REFERENCES users(id),
  username TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_channel ON chat_messages(channel, created_at);

CREATE TABLE IF NOT EXISTS private_messages (
  id TEXT PRIMARY KEY,
  from_user_id TEXT NOT NULL REFERENCES users(id),
  to_user_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  read_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_blocks (
  user_id TEXT NOT NULL REFERENCES users(id),
  blocked_user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, blocked_user_id)
);

CREATE TABLE IF NOT EXISTS chat_reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id),
  target_id TEXT NOT NULL REFERENCES users(id),
  message_id TEXT,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS item_links (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  source TEXT NOT NULL,
  meta TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, created_at);

CREATE TABLE IF NOT EXISTS deaths (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  character_id TEXT NOT NULL,
  character_name TEXT NOT NULL,
  class TEXT NOT NULL,
  level INTEGER NOT NULL,
  region INTEGER NOT NULL,
  round INTEGER NOT NULL,
  enemies_defeated INTEGER NOT NULL,
  gold_earned INTEGER NOT NULL,
  best_item TEXT,
  loot_value INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS achievements (
  user_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS user_mutes (
  user_id TEXT NOT NULL REFERENCES users(id),
  muted_user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, muted_user_id)
);

CREATE TABLE IF NOT EXISTS game_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ground_loot (
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  instance_id TEXT NOT NULL REFERENCES item_instances(id),
  PRIMARY KEY (character_id, instance_id)
);

CREATE TABLE IF NOT EXISTS world_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
