import { initDB } from './db.js';

const db = await initDB();

export class GameLogic {

    static ranks = {
        2: 2, 3: 3, 4: 4, 5: 5, 6: 6,
        7: 7, 8: 8, 9: 9, 10: 10,
        J: 11, Q: 12, K: 13, A: 14
    };

    // ===== 洗牌 =====
    static createDeck() {
        const suits = ['♠', '♥', '♣', '♦'];
        const ranks = Object.keys(this.ranks);
        const deck = [];

        for (let s of suits) {
            for (let r of ranks) {
                deck.push({ suit: s, rank: r });
            }
        }

        // 按照点数排序
        deck.sort((a, b) => this.ranks[a.rank] - this.ranks[b.rank]);

        return this.shuffle(deck);
    }

    static shuffle(deck) {
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        return deck;
    }

    // ===== 发牌 =====
    static dealCards(room) {
        const deck = this.createDeck();

        room.players.forEach(player => {
            player.cards = [deck.pop(), deck.pop(), deck.pop()];
            player.folded = false;
            player.seen = false;
            player.isBetBase = false;
        });

        room.pot = 0;
        room.menBet = room.baseBet;
        room.currentBet = room.baseBet;
        room.turnIndex = room.bankerIndex;

        room.msg = '下底阶段'
    }

    // ===== 牌型识别 =====
    static evaluateHand(cards) {
        const values = cards.map(c => this.ranks[c.rank]).sort((a, b) => a - b);
        const suits = cards.map(c => c.suit);

        const isFlush = suits.every(s => s === suits[0]);
        const isStraight =
            values[1] === values[0] + 1 &&
            values[2] === values[1] + 1;

        const countMap = {};
        values.forEach(v => countMap[v] = (countMap[v] || 0) + 1);
        const counts = Object.values(countMap);

        if (counts.includes(3)) return { type: 6, values };
        if (isStraight && isFlush) return { type: 5, values };
        if (isFlush) return { type: 4, values };
        if (isStraight) return { type: 3, values };
        if (counts.includes(2)) return { type: 2, values };
        return { type: 1, values };
    }

    // ===== 比牌 =====
    static compareHands(handA, handB) {
        if (handA.type !== handB.type) {
            return handA.type - handB.type;
        }

        for (let i = handA.values.length - 1; i >= 0; i--) {
            if (handA.values[i] !== handB.values[i]) {
                return handA.values[i] - handB.values[i];
            }
        }

        return 0;
    }

    // ===== 下注 =====
    static bet(room, player, actionAmount) {
        if (!actionAmount) return [false, '请输入下注筹码'];

        if (player.chips < actionAmount) return [false, '筹码不够, 请重新下注'];

        if (player.seen) {
            // 如果看了, 则跟着room走
            if (actionAmount < room.currentBet) {
                return [false, `下注筹码不够, 最低为${room.currentBet}, 请重新下注`]
            }

            room.currentBet = actionAmount
        } else {
            // 如果没看, room的筹码则修改未不能小于player的两倍
            if (actionAmount < room.menBet) {
                return [false, `闷注筹码不够, 至少为${room.menBet}, 请重新闷注`]
            }
            room.currentBet = Math.max(room.currentBet, actionAmount * 2)
            room.menBet = actionAmount
        }

        // 结算筹码
        player.chips -= actionAmount;
        room.pot += actionAmount;

        return [true, ''];
    }
    static betBase(room, player) {
        player.chips -= room.baseBet;
        room.pot += room.baseBet;
        player.isBetBase = true
        // 检查本局是否所有玩家都下底了

        if (room.players.every(i => i.isBetBase)) {
            room.msg = ' 开始下注'
            room.betBaseOk = true
        }
        return true;
    }

    // ===== 借筹码 =====
    static transferChips(fromPlayer, toPlayer, amount) {
        if (fromPlayer.chips < amount) return false;

        fromPlayer.chips -= amount;
        toPlayer.chips += amount;

        return true;
    }

    // ===== 看牌 =====
    static seeCards(player) {
        player.seen = true;
    }

    // ===== 弃牌 =====
    static fold(player) {
        player.folded = true;
    }

    // ===== 获取剩余玩家 =====
    static activePlayers(room) {
        return room.players.filter(p => !p.folded && !p.offline);
    }

    // ===== 推进回合 =====
    static nextTurn(room) {
        const total = room.players.length;
        let next = room.turnIndex;

        do {
            next = (next + 1) % total;
        } while (room.players[next].folded || room.players[next].offline);

        room.turnIndex = next;
        room.msg = ' 开始下注'
    }

    // ===== 判断胜负 =====
    static settle(room) {
        const active = this.activePlayers(room);

        if (active.length === 1) {
            active[0].chips += room.pot;
            return { ...active[0], resultPot: room.pot };
        }

        let winner = active[0];
        let bestHand = this.evaluateHand(winner.cards);

        for (let i = 1; i < active.length; i++) {
            const hand = this.evaluateHand(active[i].cards);
            if (this.compareHands(hand, bestHand) > 0) {
                winner = active[i];
                bestHand = hand;
            }
        }
        let resultPot = room.pot
        winner.chips += resultPot;

        db.run(
            "INSERT INTO game_records (id, roomId, result) VALUES (?, ?, ?)",
            uuidv4(),
            room.id,
            JSON.stringify(room.players.map(p => ({
                name: p.name,
                chips: p.chips
            })))
        );
        // 写入数据库
        return { ...winner, resultPot };
    }

    // ===== 庄家轮转 =====
    static nextBanker(room, winnerId) {
        // 两种流转方式, 1赢家当庄, 2逆时针, 当前为 赢家当庄

        // 逆时针
        // room.bankerIndex = (room.bankerIndex + 1) % room.players.length;
        // 赢家当庄
        room.bankerIndex = room.players.findIndex(p => p.id === winnerId);

        room.turnIndex = room.bankerIndex
    }
}