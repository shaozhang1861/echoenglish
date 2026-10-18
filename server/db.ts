/**
 * SQLite 数据库初始化与表结构
 * 使用 Node 内置 SQLite 同步 API，表：videos（视频元数据）、sentences（分句）、recordings（用户录音）
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';

const dataDir = path.join(process.cwd(), 'data');
const dbPath = path.join(dataDir, 'echoenglish.db');

export function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const videosDir = path.join(dataDir, 'videos');
  const recordingsDir = path.join(dataDir, 'recordings');
  if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });
  if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir, { recursive: true });
}

export const db = (() => {
  ensureDataDir();
  const d = new DatabaseSync(dbPath);

  // 创建表（如果不存在）
  d.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER,
      file_hash TEXT,
      transcribed INTEGER NOT NULL DEFAULT 0,
      transcribed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sentences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL,
      sentence_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      start REAL NOT NULL,
      end REAL NOT NULL,
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
      UNIQUE(video_id, sentence_index)
    );
    CREATE TABLE IF NOT EXISTS recordings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL,
      sentence_index INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      transcribed_text TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
      UNIQUE(video_id, sentence_index)
    );
    CREATE INDEX IF NOT EXISTS idx_sentences_video_id ON sentences(video_id);
    CREATE INDEX IF NOT EXISTS idx_recordings_video_id ON recordings(video_id);
  `);

  // 自动迁移：为 videos 表添加缺失的列
  const videoColumns = d.prepare('PRAGMA table_info(videos)').all().map((c: any) => c.name);
  const videoMigrations: { col: string; def: string }[] = [
    { col: 'file_size', def: 'INTEGER' },
    { col: 'file_hash', def: 'TEXT' },
    { col: 'transcribed', def: 'INTEGER NOT NULL DEFAULT 0' },
    { col: 'transcribed_at', def: 'TEXT' },
  ];
  for (const m of videoMigrations) {
    if (!videoColumns.includes(m.col)) {
      console.log(`Migrating videos table: adding column ${m.col}`);
      d.exec(`ALTER TABLE videos ADD COLUMN ${m.col} ${m.def}`);
    }
  }

  return d;
})();

export type VideoRow = { id: number; filename: string; file_path: string; mime_type: string; file_size: number | null; file_hash: string | null; transcribed: number; transcribed_at: string | null; created_at: string };
export type SentenceRow = { id: number; video_id: number; sentence_index: number; text: string; start: number; end: number };
export type RecordingRow = { id: number; video_id: number; sentence_index: number; file_path: string; mime_type: string; transcribed_text: string | null; created_at: string };
