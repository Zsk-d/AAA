import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';


const dataDir = './data';
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'aaa_data.db');

export async function initDB() {
    const db = new Database(dbPath);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS players (
            id TEXT PRIMARY KEY,
            name TEXT,
            chips INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS game_records (
            id TEXT PRIMARY KEY,
            roomId TEXT,
            result TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    return db;
}