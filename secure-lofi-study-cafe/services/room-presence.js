"use strict";

const crypto = require("crypto");

class RoomPresence {
  constructor({ db, io, defaultRoomId = 1 }) {
    this.db = db;
    this.io = io;
    this.defaultRoomId = defaultRoomId;
    this.rooms = new Map();
    this.socketIndex = new Map();
  }

  channel(roomId) {
    return `room:${Number(roomId)}`;
  }

  roomMap(roomId) {
    const id = Number(roomId);

    if (!this.rooms.has(id)) {
      this.rooms.set(id, new Map());
    }

    return this.rooms.get(id);
  }

  socketRef(socketId) {
    return crypto
      .createHash("sha256")
      .update(String(socketId))
      .digest("hex")
      .slice(0, 32);
  }

  async ensureMembership(roomId, userId) {
    await this.db.run(
      `
      INSERT INTO room_memberships (
        room_id,
        user_id,
        last_joined_at
      )
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(room_id, user_id) DO UPDATE SET
        last_joined_at = CURRENT_TIMESTAMP
      `,
      [roomId, userId]
    );
  }

  async join(socket, user, profile = {}, requestedRoomId = this.defaultRoomId) {
    const roomId = Number(requestedRoomId);

    await this.ensureMembership(roomId, user.id);

    await this.db.run(
      `
      INSERT INTO user_profiles (user_id, display_name, last_seen_at, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        display_name = COALESCE(user_profiles.display_name, excluded.display_name),
        last_seen_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      `,
      [user.id, user.username]
    );

    const connectionId = crypto.randomUUID();
    const socketRef = this.socketRef(socket.id);

    await this.db.run(
      `
      INSERT INTO presence_sessions (
        id,
        socket_ref,
        user_id,
        room_id,
        status,
        connected_at,
        last_seen_at
      )
      VALUES (?, ?, ?, ?, 'online', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
      [connectionId, socketRef, user.id, roomId]
    );

    const room = this.roomMap(roomId);
    const existing = room.get(user.id);
    const becameOnline = !existing;

    if (existing) {
      existing.socketIds.add(socket.id);
      existing.connectionCount = existing.socketIds.size;
      existing.lastSeenAt = new Date().toISOString();
      existing.updatedAt = Date.now();
    } else {
      room.set(user.id, {
        id: user.id,
        username: user.username,
        role: user.role,
        socketIds: new Set([socket.id]),
        connectionCount: 1,
        playbackStatus: "Online",
        trackTitle: "Not playing",
        followingRoom: true,
        currentSeconds: 0,
        isPlaying: false,
        avatarStyle: profile.avatarStyle || "latte",
        availabilityStatus: profile.availabilityStatus || "studying",
        avatarX: Number(profile.avatarX || 50),
        avatarY: Number(profile.avatarY || 50),
        hasAvatarImage: Boolean(profile.avatarImage),
        avatarImageVersion: Date.now(),
        lastSeenAt: new Date().toISOString(),
        updatedAt: Date.now()
      });
    }

    socket.join(this.channel(roomId));

    this.socketIndex.set(socket.id, {
      connectionId,
      roomId,
      userId: user.id
    });

    return {
      roomId,
      becameOnline,
      member: room.get(user.id)
    };
  }

  async heartbeat(socketId) {
    const indexed = this.socketIndex.get(socketId);

    if (!indexed) {
      return;
    }

    await this.db.run(
      `
      UPDATE presence_sessions
      SET last_seen_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'online'
      `,
      [indexed.connectionId]
    );

    await this.db.run(
      `
      UPDATE user_profiles
      SET last_seen_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
      `,
      [indexed.userId]
    );

    const member = this.roomMap(indexed.roomId).get(indexed.userId);
    if (member) {
      member.lastSeenAt = new Date().toISOString();
      member.updatedAt = Date.now();
    }
  }

  async leave(socket) {
    const indexed = this.socketIndex.get(socket.id);

    if (!indexed) {
      return {
        roomId: this.defaultRoomId,
        userId: null,
        becameOffline: false
      };
    }

    this.socketIndex.delete(socket.id);

    await this.db.run(
      `
      UPDATE presence_sessions
      SET status = 'offline',
          last_seen_at = CURRENT_TIMESTAMP,
          disconnected_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [indexed.connectionId]
    );

    const room = this.roomMap(indexed.roomId);
    const member = room.get(indexed.userId);

    if (!member) {
      return {
        roomId: indexed.roomId,
        userId: indexed.userId,
        becameOffline: false
      };
    }

    member.socketIds.delete(socket.id);
    member.connectionCount = member.socketIds.size;
    member.lastSeenAt = new Date().toISOString();

    const becameOffline = member.socketIds.size === 0;

    if (becameOffline) {
      room.delete(indexed.userId);

      await this.db.run(
        `
        UPDATE user_profiles
        SET last_seen_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
        `,
        [indexed.userId]
      );

      await this.db.run(
        `
        UPDATE room_memberships
        SET last_left_at = CURRENT_TIMESTAMP
        WHERE room_id = ? AND user_id = ?
        `,
        [indexed.roomId, indexed.userId]
      );
    }

    return {
      roomId: indexed.roomId,
      userId: indexed.userId,
      becameOffline
    };
  }

  getMember(roomId, userId) {
    return this.roomMap(roomId).get(Number(userId)) || null;
  }

  updateMember(roomId, userId, updater) {
    const member = this.getMember(roomId, userId);

    if (!member) {
      return null;
    }

    updater(member);
    member.updatedAt = Date.now();
    return member;
  }

  getMembers(roomId, {
    controllerUserId = null,
    tempModeratorIds = new Set()
  } = {}) {
    const room = this.roomMap(roomId);

    return Array.from(room.values())
      .map((member) => ({
        id: member.id,
        username: member.username,
        role: member.role,
        online: true,
        roomId: Number(roomId),
        connectionCount: member.socketIds.size,
        isTempAdmin: tempModeratorIds.has(member.id),
        isController: controllerUserId === member.id,
        playbackStatus: member.playbackStatus,
        trackTitle: member.trackTitle,
        followingRoom: member.followingRoom,
        currentSeconds: member.currentSeconds,
        isPlaying: member.isPlaying,
        avatarStyle: member.avatarStyle,
        availabilityStatus: member.availabilityStatus || "studying",
        avatarX: member.avatarX,
        avatarY: member.avatarY,
        avatarImageUrl: member.hasAvatarImage
          ? `/profile-image/${member.id}?v=${member.avatarImageVersion}`
          : null,
        lastSeenAt: member.lastSeenAt
      }))
      .sort((a, b) => a.id - b.id);
  }

  async getMembershipState(roomId) {
    const active = new Map(
      this.getMembers(roomId).map((member) => [member.id, member])
    );

    const rows = await this.db.all(
      `
      SELECT users.id,
             users.username,
             users.role,
             user_profiles.display_name,
             user_profiles.last_seen_at,
             room_memberships.joined_at,
             room_memberships.last_joined_at,
             room_memberships.last_left_at
      FROM room_memberships
      JOIN users ON users.id = room_memberships.user_id
      LEFT JOIN user_profiles ON user_profiles.user_id = users.id
      WHERE room_memberships.room_id = ?
      ORDER BY users.username COLLATE NOCASE ASC
      `,
      [roomId]
    );

    return rows.map((row) => {
      const live = active.get(row.id);

      return {
        id: row.id,
        username: row.username,
        displayName: row.display_name || row.username,
        role: row.role,
        online: Boolean(live),
        connectionCount: live ? live.connectionCount : 0,
        connectedToRoom: Boolean(live),
        lastSeenAt: live ? live.lastSeenAt : row.last_seen_at,
        joinedAt: row.joined_at,
        lastJoinedAt: row.last_joined_at,
        lastLeftAt: row.last_left_at
      };
    });
  }
}

module.exports = RoomPresence;
