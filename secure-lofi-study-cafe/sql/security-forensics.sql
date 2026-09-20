-- Secure Lo-Fi Study Cafe
-- Security Engineering v4.2
-- Self-hosted SQLite forensic and operational queries.
--
-- These queries target the local SQLite database owned by the self-hosted application.
-- They avoid password hashes, session tokens, CSRF tokens, and profile-image data.

PRAGMA foreign_keys = ON;

-- 1. Recent high-severity security events.
SELECT
    created_at,
    event_type,
    severity,
    outcome,
    COALESCE(username_snapshot, 'anonymous') AS actor,
    http_method,
    route,
    request_id,
    session_ref,
    client_ip,
    user_agent,
    metadata
FROM security_events
WHERE severity = 'HIGH'
ORDER BY created_at DESC
LIMIT 100;

-- 2. Failed or blocked security events in the last 24 hours.
SELECT
    created_at,
    event_type,
    severity,
    outcome,
    COALESCE(username_snapshot, 'anonymous') AS actor,
    route,
    request_id,
    session_ref,
    client_ip,
    user_agent
FROM security_events
WHERE outcome IN ('failed', 'blocked')
  AND created_at >= datetime('now', '-24 hours')
ORDER BY created_at DESC;

-- 3. Authentication failure frequency by username snapshot.
SELECT
    COALESCE(username_snapshot, 'anonymous') AS attempted_user,
    client_ip,
    COUNT(*) AS failure_count,
    MIN(created_at) AS first_failure,
    MAX(created_at) AS last_failure
FROM security_events
WHERE event_type = 'auth.login_failed'
  AND created_at >= datetime('now', '-24 hours')
GROUP BY COALESCE(username_snapshot, 'anonymous'), client_ip
ORDER BY failure_count DESC, last_failure DESC;

-- 4. Authorization denials.
SELECT
    created_at,
    event_type,
    COALESCE(username_snapshot, 'anonymous') AS actor,
    outcome,
    route,
    request_id,
    session_ref,
    client_ip
FROM security_events
WHERE event_type LIKE 'authorization.%'
ORDER BY created_at DESC;

-- 5. CSRF failures.
SELECT
    created_at,
    COALESCE(username_snapshot, 'anonymous') AS actor,
    http_method,
    route,
    request_id,
    session_ref,
    client_ip,
    user_agent,
    metadata
FROM security_events
WHERE event_type = 'csrf.validation_failed'
ORDER BY created_at DESC;

-- 6. Correlate one session without storing the real session token.
-- Replace the placeholder with a session_ref shown in the admin console.
SELECT
    created_at,
    event_type,
    severity,
    outcome,
    username_snapshot,
    http_method,
    route,
    request_id,
    client_ip,
    user_agent,
    metadata
FROM security_events
WHERE session_ref = 'REPLACE_WITH_SESSION_REF'
ORDER BY created_at ASC;

-- 7. Security event volume by type.
SELECT
    event_type,
    severity,
    outcome,
    COUNT(*) AS event_count,
    MIN(created_at) AS first_seen,
    MAX(created_at) AS last_seen
FROM security_events
GROUP BY event_type, severity, outcome
ORDER BY event_count DESC, event_type ASC;

-- 8. Daily security event summary.
SELECT
    date(created_at) AS event_date,
    severity,
    outcome,
    COUNT(*) AS event_count
FROM security_events
GROUP BY date(created_at), severity, outcome
ORDER BY event_date DESC, severity ASC;

-- 9. Privileged administrative actions from the application audit trail.
SELECT
    audit_logs.created_at,
    actor.username AS actor,
    target.username AS target,
    audit_logs.event_type,
    audit_logs.action,
    audit_logs.details
FROM audit_logs
LEFT JOIN users AS actor
    ON audit_logs.user_id = actor.id
LEFT JOIN users AS target
    ON audit_logs.target_user_id = target.id
WHERE audit_logs.event_type LIKE 'admin.%'
   OR audit_logs.event_type LIKE 'chat.delete%'
   OR audit_logs.event_type LIKE 'music.approve%'
   OR audit_logs.event_type LIKE 'music.reject%'
ORDER BY audit_logs.created_at DESC;

-- 10. Moderated chat evidence, including who removed the message.
SELECT
    messages.created_at AS message_created,
    messages.deleted_at,
    author.username AS author,
    author.role AS author_role,
    messages.message_text,
    deleter.username AS deleted_by
FROM messages
JOIN users AS author
    ON messages.user_id = author.id
LEFT JOIN users AS deleter
    ON messages.deleted_by = deleter.id
WHERE messages.deleted_at IS NOT NULL
ORDER BY messages.deleted_at DESC;

-- 11. Account registration and message activity.
SELECT
    users.username,
    users.role,
    users.created_at AS registered_at,
    COUNT(messages.id) AS message_count,
    MAX(messages.created_at) AS latest_message_at
FROM users
LEFT JOIN messages
    ON messages.user_id = users.id
GROUP BY users.id
ORDER BY users.created_at ASC;

-- 12. Music moderation trail.
SELECT
    music_requests.created_at,
    users.username,
    music_requests.title,
    music_requests.video_id,
    music_requests.status
FROM music_requests
JOIN users
    ON music_requests.user_id = users.id
ORDER BY music_requests.created_at DESC;

-- 13. Unified incident timeline.
SELECT
    created_at,
    'security' AS source,
    event_type,
    COALESCE(username_snapshot, 'anonymous') AS actor,
    outcome AS result,
    route AS detail
FROM security_events

UNION ALL

SELECT
    audit_logs.created_at,
    'audit' AS source,
    audit_logs.event_type,
    COALESCE(users.username, 'system') AS actor,
    'recorded' AS result,
    audit_logs.action AS detail
FROM audit_logs
LEFT JOIN users
    ON audit_logs.user_id = users.id

ORDER BY created_at DESC
LIMIT 500;

-- 14. Verify that the main security indexes exist.
SELECT
    name,
    tbl_name,
    sql
FROM sqlite_master
WHERE type = 'index'
  AND name LIKE 'idx_%'
ORDER BY tbl_name, name;

-- 15. Query-plan check for a common incident-response query.
EXPLAIN QUERY PLAN
SELECT created_at, event_type, severity, outcome
FROM security_events
WHERE severity = 'HIGH'
ORDER BY created_at DESC
LIMIT 100;


-- 16. Recent activity by client IP.
SELECT
    client_ip,
    COUNT(*) AS event_count,
    COUNT(DISTINCT COALESCE(username_snapshot, 'anonymous')) AS actor_count,
    MIN(created_at) AS first_seen,
    MAX(created_at) AS last_seen
FROM security_events
WHERE client_ip IS NOT NULL
GROUP BY client_ip
ORDER BY last_seen DESC, event_count DESC
LIMIT 100;

-- 17. Socket connect/disconnect history with network context.
SELECT
    created_at,
    event_type,
    COALESCE(username_snapshot, 'anonymous') AS actor,
    client_ip,
    user_agent,
    session_ref,
    metadata
FROM security_events
WHERE event_type IN ('socket.connected', 'socket.disconnected')
ORDER BY created_at DESC
LIMIT 200;
