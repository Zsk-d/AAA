import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { initDB } from './db.js';
import { RoomManager } from './roomManager.js';
import { GameLogic } from './gameLogic.js';
import { v4 as uuidv4 } from 'uuid';


const roomManager = new RoomManager();
const notifyRoom = (roomId, room, action) => {
    if (!room) {
        return
    }
    let _room = JSON.parse(JSON.stringify(room))
    _room.players.forEach(p => {
        p.cards = [];
    });
    io.to(roomId).emit(action ? action : "roomUpdate", _room);
}

// 一局结束, 重置牌桌内容
const resetGame = (roomId) => {
    let room = roomManager.getRoom(roomId);

    room.currentBet = room.baseBet;
    room.betBaseOk = false

    room.players.forEach(player => {
        player.ready = false
    });

    room.msg = `等待庄家[${room.players[room.bankerIndex].name}]开局`
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});
const userSocketMap = {}
const db = await initDB();

io.on("connection", (socket) => {

    console.log("用户连接:", socket.id);
    userSocketMap[socket.id] = socket;

    // 创建或加入房间
    socket.on("createOrJoinRoom", ({ roomId, name, baseBet, initChips, spectator }) => {

        if (!roomId) {
            socket.emit("errorMsg", "房间号不能为空");
            return;
        }
        let room = roomManager.getRoom(roomId);

        if (!room && !spectator) {
            room = roomManager.createRoom(roomId, baseBet || 1, initChips || 1000);
        }

        if (!room) {
            socket.emit("errorMsg", "房间不存在");
            return;
        }
        if (room.state !== 'waiting') {
            socket.emit("errorMsg", "房间对局正在进行, 请等待");
            return;
        }

        // 检查name是否存在
        if (room.players.find(p => p.name === name)) {
            socket.emit("errorMsg", "名称已存在");
            return;
        }

        const player = {
            id: socket.id,
            name,
            chips: room.initChips,
            ready: false
        };

        if (spectator) {
            room.spectators.push(player);
        } else {
            if (room.players.length >= 6) {
                socket.emit("errorMsg", "房间已满");
                return;
            }
            room.players.push(player);
        }

        socket.join(roomId);
        socket.roomId = roomId;
        notifyRoom(roomId, room)
    });
    // 下注
    socket.on("bet", ({ amount }) => {
        const room = roomManager.getRoom(socket.roomId);
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player || player.folded) return;

        // 检查是否是当前用户下注
        if (player.id !== room.players[room.turnIndex].id) {
            return;
        }

        let [res, msg] = GameLogic.bet(room, player, amount)
        if (res) {
            GameLogic.nextTurn(room);
        } else {
            room.msg = msg;
        }
        notifyRoom(room.id, room)
    });
    // 下底
    socket.on("betBase", ({ amount }) => {
        const room = roomManager.getRoom(socket.roomId);
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player || player.folded) return;

        if (GameLogic.betBase(room, player)) {
            notifyRoom(room.id, room)
        }
    });
    // 弃牌
    socket.on("fold", () => {
        const room = roomManager.getRoom(socket.roomId);
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        GameLogic.fold(player);

        const active = GameLogic.activePlayers(room);
        if (active.length <= 1) {
            const winner = GameLogic.settle(room);
            if (!winner.seen) {
                // 给 userSocketMap[winner.id] 发送看牌信息
                io.to(winner.id).emit("yourCards", winner.cards);
            }
            GameLogic.nextBanker(room, winner.id);
            room.state = "gameOver";
            resetGame(room.id)
            io.to(room.id).emit("gameOver", { winner, room });
            return;
        }

        GameLogic.nextTurn(room);
        notifyRoom(room.id, room)
    });
    // 看牌
    socket.on("seeCards", () => {
        const room = roomManager.getRoom(socket.roomId);
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        GameLogic.seeCards(player);

        socket.emit("yourCards", player.cards); // 只发给自己
        notifyRoom(room.id, room)
    });
    // 比牌
    socket.on("compare", ({ targetId }) => {
        const room = roomManager.getRoom(socket.roomId);
        if (!room) return;

        const playerA = room.players.find(p => p.id === socket.id);

        // 计算比牌花费
        let cast = playerA.seen ? room.currentBet * 2 : room.menBet * 2
        // 检查筹码是否够翻倍的
        if (playerA.chips < cast) {
            room.msg = '比牌筹码不够, 需要' + cast + ', 请重新操作'
            notifyRoom(room.id, room)
            return;
        }
        const playerB = room.players.find(p => p.id === targetId);

        const handA = GameLogic.evaluateHand(playerA.cards);
        const handB = GameLogic.evaluateHand(playerB.cards);

        const result = GameLogic.compareHands(handA, handB);

        let loser;
        if (result > 0) {
            loser = playerB;
        } else {
            loser = playerA;
        }

        loser.folded = true;
        if (!loser.seen) {
            io.to(loser.id).emit("yourCards", loser.cards);
        }

        // 结算筹码
        playerA.chips -= room.currentBet * 2;
        room.pot += room.currentBet * 2;

        const active = GameLogic.activePlayers(room);
        if (active.length <= 1) {
            const winner = GameLogic.settle(room);
            if (!winner.seen) {
                io.to(winner.id).emit("yourCards", winner.cards);
            }
            GameLogic.nextBanker(room, winner.id);
            room.state = "gameOver";
            resetGame(room.id)
            io.to(room.id).emit("gameOver", { winner, room });
            return;
        }
        GameLogic.nextTurn(room);
        notifyRoom(room.id, room)
    });
    // 玩家准备
    socket.on("ready", () => {
        console.log("用户准备:", socket.id);
        const room = roomManager.getRoom(socket.roomId);
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (player) player.ready = true;

        if (room.players.length >= 2 && room.players.every(p => p.ready)) {
            room.state = "playing";
            GameLogic.dealCards(room);
        }
        notifyRoom(room.id, room, 'gameStart')
    });
    // 取消准备
    socket.on("unready", () => {
        console.log("用户取消准备:", socket.id);
        const room = roomManager.getRoom(socket.roomId);
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (player) player.ready = false;

        notifyRoom(room.id, room)
    });
    // 新对局开始
    socket.on("start", () => {
        console.log("用户开始新对局:", socket.id);
        const room = roomManager.getRoom(socket.roomId);
        if (!room) return;
        room.state = "waiting";
        room.players.forEach(i => {
            i.folded = false
            i.seen = false
        })
        notifyRoom(room.id, room, 'gameStart')
    });
    // 申请借筹码
    socket.on("requestLoan", ({ targetId, amount }) => {
        const room = roomManager.getRoom(socket.roomId);
        if (!room) return;

        const targetPlayer = room.players.find(p => p.id === targetId);

        if (!amount) {
            socket.emit("errorMsg", '请输入要借的筹码');
            return;
        }
        // 检查对方是否够
        if (targetPlayer.chips < amount) {
            socket.emit("errorMsg", '对方筹码不够, 请重新操作');
            return;
        }

        io.to(room.id).emit("loanEvent", {
            status: 'request',
            fromId: socket.id,
            targetId: targetId,
            amount
        });
    });
    // 接受借筹码
    socket.on("acceptLoan", ({ fromId, amount }) => {
        const room = roomManager.getRoom(socket.roomId);
        if (!room) return;

        const lender = room.players.find(p => p.id === socket.id);
        const borrower = room.players.find(p => p.id === fromId);

        if (!lender || !borrower) return;

        if (GameLogic.transferChips(lender, borrower, amount)) {
            notifyRoom(room.id, room)
        }
    });
    socket.on("refuseLoan", ({ targetId, fromId }) => {
        const room = roomManager.getRoom(socket.roomId);
        if (!room) return;

        io.to(room.id).emit("loanEvent", {
            status: 'refuseLoan',
            fromId,
            targetId
        });
    });
    // 自动准备
    socket.on("autoReady", () => {
        const room = roomManager.getRoom(socket.roomId);
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        player.autoReady = true;
    });
    // 断开连接
    socket.on("disconnect", () => {
        const roomId = socket.roomId;
        let room = roomManager.getRoom(roomId)
        if (!roomId) return;

        let players = roomManager.removePlayer(roomId, socket.id);
        if (players.length === 1) {
            roomManager.resetRoom(roomId)
            io.to(players[0].id).emit("roomReset", roomManager.getRoom(roomId));
        } else {
            notifyRoom(roomId, roomManager.getRoom(roomId))
        }

        delete userSocketMap[socket.id];
    });
});

server.listen(3000, () => {
    console.log("服务器启动: http://localhost:3000");
});