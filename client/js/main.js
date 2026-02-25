

let app;
let myId = null;
let playerMap = new Map();

let tableLayer;
let chipLayer;
let cardLayer;
let effectLayer;
let uiLayer;

let turnTimerGraphic;

const TURN_TIME = 20; // 20秒

////////////////////////////////////////////////////////
// 初始化
////////////////////////////////////////////////////////


// 比牌结果
socket.on("compareResult", data => {
    animateCompare(data.fromId, data.toId, data.loserId);
});

////////////////////////////////////////////////////////
// 初始化舞台
////////////////////////////////////////////////////////


////////////////////////////////////////////////////////
// 绘制牌桌（渐变质感）
////////////////////////////////////////////////////////

function drawTable() {

    tableLayer.removeChildren();

    const table = new PIXI.Graphics();

    table.beginFill(0x0b5e3c);
    table.drawRoundedRect(
        app.screen.width * 0.08,
        app.screen.height * 0.08,
        app.screen.width * 0.84,
        app.screen.height * 0.84,
        220
    );
    table.endFill();

    tableLayer.addChild(table);
}

////////////////////////////////////////////////////////
// 渲染玩家
////////////////////////////////////////////////////////

function renderTable(room) {

    playerMap.clear();

    const centerX = app.screen.width / 2;
    const centerY = app.screen.height / 2;
    const radius = Math.min(centerX, centerY) * 0.7;

    const players = room.players;
    const total = players.length;

    players.forEach(player => {

        let angle;

        if (player.id === myId) {
            angle = Math.PI / 2;
        } else {
            const others = players.filter(p => p.id !== myId);
            const idx = others.findIndex(p => p.id === player.id);
            angle = (Math.PI * 2 / (total - 1)) * idx - Math.PI / 2;
        }

        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);

        const container = new PIXI.Container();
        container.x = x;
        container.y = y;

        const circle = new PIXI.Graphics();
        circle.beginFill(player.id === room.players[room.bankerIndex]?.id ? 0xffd700 : 0xffffff);
        circle.drawCircle(0, 0, 45);
        circle.endFill();

        const text = new PIXI.Text(
            player.name + "\n筹码:" + player.chips,
            { fill: 0x000000, fontSize: 14, align: "center" }
        );
        text.anchor.set(0.5);

        container.addChild(circle);
        container.addChild(text);

        tableLayer.addChild(container);

        playerMap.set(player.id, { x, y });
    });
}
