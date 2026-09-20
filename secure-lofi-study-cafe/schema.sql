-- Secure Lo-Fi Study Café
-- Security Engineering v4.1 production schema.
-- The running application performs compatible migrations for older databases.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS roles (
    name TEXT PRIMARY KEY,
    description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS permissions (
    name TEXT PRIMARY KEY,
    description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_name TEXT NOT NULL,
    permission_name TEXT NOT NULL,
    PRIMARY KEY (role_name, permission_name),
    FOREIGN KEY (role_name) REFERENCES roles(name) ON DELETE CASCADE,
    FOREIGN KEY (permission_name) REFERENCES permissions(name) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    avatar_image TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_profiles (
    user_id INTEGER PRIMARY KEY,
    display_name TEXT,
    avatar_style TEXT NOT NULL DEFAULT 'latte',
    availability_status TEXT NOT NULL DEFAULT 'studying',
    last_seen_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS room_memberships (
    room_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_joined_at DATETIME,
    last_left_at DATETIME,
    PRIMARY KEY (room_id, user_id),
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL DEFAULT 1,
    user_id INTEGER NOT NULL,
    message_text TEXT NOT NULL,
    reply_to_message_id INTEGER,
    deleted_at DATETIME,
    deleted_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (reply_to_message_id) REFERENCES messages(id) ON DELETE SET NULL,
    FOREIGN KEY (deleted_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS message_reactions (
    message_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    emoji TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id, user_id, emoji),
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS music_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL DEFAULT 1,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    video_id TEXT NOT NULL,
    start_seconds INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS music_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL DEFAULT 1,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    video_id TEXT NOT NULL,
    start_seconds INTEGER NOT NULL DEFAULT 0,
    requested_by INTEGER,
    approved_by INTEGER,
    position INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'queued',
    started_at INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (requested_by) REFERENCES users(id),
    FOREIGN KEY (approved_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS presence_sessions (
    id TEXT PRIMARY KEY,
    socket_ref TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    room_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'online',
    connected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    disconnected_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    event_type TEXT NOT NULL DEFAULT 'legacy',
    target_user_id INTEGER,
    action TEXT NOT NULL,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (target_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS security_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_uuid TEXT UNIQUE NOT NULL,
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'INFO',
    actor_user_id INTEGER,
    username_snapshot TEXT,
    target_user_id INTEGER,
    outcome TEXT NOT NULL DEFAULT 'success',
    http_method TEXT,
    route TEXT,
    request_id TEXT,
    session_ref TEXT,
    client_ip TEXT,
    user_agent TEXT,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (actor_user_id) REFERENCES users(id),
    FOREIGN KEY (target_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
    ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_presence_room_status
    ON presence_sessions(room_id, status, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_presence_user_status
    ON presence_sessions(user_id, status, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_room_memberships_user
    ON room_memberships(user_id, room_id);
CREATE INDEX IF NOT EXISTS idx_messages_room_created
    ON messages(room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_security_events_created_at
    ON security_events(created_at);
CREATE INDEX IF NOT EXISTS idx_security_events_type
    ON security_events(event_type);
CREATE INDEX IF NOT EXISTS idx_security_events_actor
    ON security_events(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_security_events_client_ip
    ON security_events(client_ip, created_at);
CREATE INDEX IF NOT EXISTS idx_security_events_severity_outcome
    ON security_events(severity, outcome);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
    ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_user_created
    ON messages(user_id, created_at);

INSERT OR IGNORE INTO roles (name, description) VALUES
    ('admin', 'Permanent administrator'),
    ('mod', 'Moderator'),
    ('user', 'Regular user');

INSERT OR IGNORE INTO permissions (name, description) VALUES
    ('room.use', 'Use normal room features'),
    ('room.moderate', 'Moderate room content'),
    ('admin.console', 'Open the administrator console'),
    ('admin.users.read', 'Read administrative user data'),
    ('admin.users.write', 'Change user roles');

INSERT OR IGNORE INTO role_permissions (role_name, permission_name) VALUES
    ('user', 'room.use'),
    ('mod', 'room.use'),
    ('mod', 'room.moderate'),
    ('admin', 'room.use'),
    ('admin', 'room.moderate'),
    ('admin', 'admin.console'),
    ('admin', 'admin.users.read'),
    ('admin', 'admin.users.write');

INSERT OR IGNORE INTO rooms (id, slug, name, created_by)
    VALUES (1, 'main', 'Main Study Café', NULL);


CREATE INDEX IF NOT EXISTS idx_message_reactions_message
    ON message_reactions(message_id, created_at);
