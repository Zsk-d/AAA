import { v4 as uuidv4 } from 'uuid';

export class RoomManager {
    constructor() {
        this.rooms = new Map(); // roomId -> room
    }

    createRoom(roomId, baseBet, initChips) {
        if (this.rooms.has(roomId)) {
            return this.rooms.get(roomId);
        }

        const room = {
            id: roomId,
            baseBet,
            initChips,
            players: [],
            spectators: [],
            state: "waiting",
            bankerIndex: 0
        };

        this.rooms.set(roomId, room);
        return room;
    }

    getRoom(roomId) {
        return this.rooms.get(roomId);
    }

    removePlayer(roomId, playerId) {
        const room = this.rooms.get(roomId);
        if (!room) return;

        room.players = room.players.filter(p => p.id !== playerId);
        room.spectators = room.spectators.filter(p => p.id !== playerId);

        // 检查房间是否没人了, 没人则直接删除房间 todo
        if (room.players.length === 0) {
            this.rooms.delete(roomId);
            return []
        } else {
            // 剩下多个人, 返回房间内玩家
            return room.players
        }
    }

    offlinePlayer(roomId, playerId) {
        const room = this.rooms.get(roomId);
        if (!room) return;
        room.players.find(p => p.id === playerId).offline = true

        // 检查房间是否没人了, 没人则直接删除房
        if (room.players.filter(p => !p.offline).length === 0) {
            this.rooms.delete(roomId);
            return []
        } else {
            // 剩下多个人, 返回房间内玩家
            return room.players
        }
    }

    closeRoom(roomId) {
        const room = this.rooms.get(roomId);
        if (!room) return;

        let players = room.players

        this.rooms.delete(roomId);
        return players
    }
    resetRoom(roomId) {
        const room = this.rooms.get(roomId);
        if (!room) return;

        this.rooms.set(roomId, {
            id: roomId,
            baseBet: room.baseBet,
            initChips: room.initChips,
            players: room.players,
            spectators: room.spectators,
            state: "waiting",
            bankerIndex: 0
        });
    }
}