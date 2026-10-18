/**
 * 后端服务器：提供视频管理、转写和录音存储 API
 * 使用 Express + SQLite，支持视频上传、分句转写和用户录音管理
 */

import express from 'express';
import multer from 'multer';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

import { db, type VideoRow, type SentenceRow, type RecordingRow, ensureDataDir } from './db';
import { transcribeVideoFile, transcribeAudioFile } from './transcribe';

// 计算文件哈希（SHA-256）用于检测重复视频
function calculateFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// 查找已存在的视频（通过文件哈希）
function findExistingVideoByHash(fileHash: string): VideoRow | undefined {
  return db.prepare('SELECT * FROM videos WHERE file_hash = ? ORDER BY created_at DESC LIMIT 1').get(fileHash) as VideoRow | undefined;
}

// 查找已存在的视频（通过文件名，用于兼容）
function findExistingVideo(filename: string): VideoRow | undefined {
  return db.prepare('SELECT * FROM videos WHERE filename = ? ORDER BY created_at DESC LIMIT 1').get(filename) as VideoRow | undefined;
}

// 加载环境变量
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// 确保数据目录存在
ensureDataDir();
const dataDir = path.join(process.cwd(), 'data');

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Multer 配置用于文件上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const videosDir = path.join(dataDir, 'videos');
    if (!fs.existsSync(videosDir)) {
      fs.mkdirSync(videosDir, { recursive: true });
    }
    cb(null, videosDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `video-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({ storage });

// 录音存储配置
const recordingStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const recordingsDir = path.join(dataDir, 'recordings');
    if (!fs.existsSync(recordingsDir)) {
      fs.mkdirSync(recordingsDir, { recursive: true });
    }
    cb(null, recordingsDir);
  },
  filename: (req, file, cb) => {
    const { videoId } = req.params;
    const { sentenceIndex } = req.params;
    const uniqueSuffix = Date.now();
    cb(null, `recording-${videoId}-${sentenceIndex}-${uniqueSuffix}.webm`);
  },
});

const uploadRecording = multer({ storage: recordingStorage });

// API 路由

// 获取所有视频列表
app.get('/api/videos', (req, res) => {
  try {
    const videos = db
      .prepare('SELECT id, filename, created_at, mime_type FROM videos ORDER BY created_at DESC')
      .all() as VideoRow[];

    const videoList = videos.map((v) => ({
      id: v.id,
      filename: v.filename,
      mimeType: v.mime_type,
      createdAt: v.created_at,
      hasSentences:
        (db
          .prepare('SELECT COUNT(*) as count FROM sentences WHERE video_id = ?')
          .get(v.id) as { count: number }
        ).count > 0,
    }));

    res.json(videoList);
  } catch (error) {
    console.error('Error fetching videos:', error);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

// 获取单个视频详情
app.get('/api/videos/:id', (req, res) => {
  try {
    const { id } = req.params;
    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(Number(id)) as VideoRow | undefined;

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const sentences = db
      .prepare('SELECT text, start, end FROM sentences WHERE video_id = ? ORDER BY sentence_index')
      .all(Number(id)) as SentenceRow[];

    const recordings = db
      .prepare('SELECT sentence_index, transcribed_text FROM recordings WHERE video_id = ?')
      .all(Number(id)) as RecordingRow[];

    const detail = {
      id: video.id,
      filename: video.filename,
      mimeType: video.mime_type,
      createdAt: video.created_at,
      sentences: sentences.map((s) => ({
        text: s.text,
        start: s.start,
        end: s.end,
      })),
      recordingIndices: recordings.map((r) => r.sentence_index),
      transcribedTexts: recordings.reduce((acc, r) => {
        if (r.transcribed_text) {
          acc[r.sentence_index] = r.transcribed_text;
        }
        return acc;
      }, {} as Record<number, string>),
    };

    res.json(detail);
  } catch (error) {
    console.error('Error fetching video:', error);
    res.status(500).json({ error: 'Failed to fetch video' });
  }
});

// 获取视频文件
app.get('/api/videos/:id/file', (req, res) => {
  try {
    const { id } = req.params;
    const video = db.prepare('SELECT file_path, mime_type FROM videos WHERE id = ?').get(Number(id)) as VideoRow | undefined;

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const filePath = path.isAbsolute(video.file_path) ? video.file_path : path.join(process.cwd(), video.file_path);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Video file not found' });
    }

    res.setHeader('Content-Type', video.mime_type);
    res.sendFile(filePath);
  } catch (error) {
    console.error('Error serving video file:', error);
    res.status(500).json({ error: 'Failed to serve video file' });
  }
});

// 上传视频
app.post('/api/videos', upload.single('video'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filename = file.originalname;
    const fileSize = file.size;

    // 计算文件哈希
    const fileHash = await calculateFileHash(file.path);
    console.log(`Calculated hash for ${filename}: ${fileHash}`);

    // 优先通过文件哈希查找已存在的视频
    let existingVideo = findExistingVideoByHash(fileHash);

    // 如果没有通过哈希找到，尝试通过文件名查找（兼容旧数据）
    if (!existingVideo) {
      existingVideo = findExistingVideo(filename);
    }

    if (existingVideo) {
      console.log(`Found existing video: ${filename}, ID: ${existingVideo.id}, Hash: ${existingVideo.file_hash}`);

      // 如果已解析，直接返回复用
      if (existingVideo.transcribed) {
        console.log(`Video already transcribed, reusing results`);
        // Multer 已经写入了本次临时上传文件；复用旧记录时及时清理，避免产生孤立文件。
        if (file.path !== existingVideo.file_path && fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
        res.json({
          id: existingVideo.id,
          filename: existingVideo.filename,
          mimeType: existingVideo.mime_type,
          transcribed: true,
          reused: true,
          message: 'Reused previous analysis result'
        });
        return;
      }

      // 如果未解析，更新文件信息（可能之前解析失败）
      console.log(`Video found but not transcribed, updating file info`);
      const updatedRelativePath = path.relative(process.cwd(), file.path);
      db.prepare('UPDATE videos SET file_path = ?, file_size = ?, file_hash = ? WHERE id = ?')
        .run(updatedRelativePath, fileSize, fileHash, existingVideo.id);

      // 删除旧文件
      try {
        if (fs.existsSync(existingVideo.file_path)) {
          fs.unlinkSync(existingVideo.file_path);
        }
      } catch (err) {
        console.warn('Failed to delete old video file:', err);
      }

      res.json({
        id: existingVideo.id,
        filename: existingVideo.filename,
        mimeType: existingVideo.mime_type,
        reused: true,
        message: 'Updated existing video file'
      });
      return;
    }

    // 新视频：插入数据库（存储相对路径）
    console.log(`Uploading new video: ${filename}`);

    const relativePath = path.relative(process.cwd(), file.path);
    const result = db
      .prepare(
        'INSERT INTO videos (filename, file_path, mime_type, file_size, file_hash) VALUES (?, ?, ?, ?, ?)'
      )
      .run(filename, relativePath, file.mimetype, fileSize, fileHash);

    res.json({
      id: result.lastInsertRowid,
      filename: filename,
      mimeType: file.mimetype,
    });
  } catch (error) {
    console.error('Error uploading video:', error);
    res.status(500).json({ error: 'Failed to upload video' });
  }
});

// 转写视频
app.post('/api/videos/:id/transcribe', async (req, res) => {
  try {
    const { id } = req.params;
    const video = db.prepare('SELECT file_path, mime_type FROM videos WHERE id = ?').get(Number(id)) as VideoRow | undefined;

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const filePath = path.isAbsolute(video.file_path) ? video.file_path : path.join(process.cwd(), video.file_path);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Video file not found' });
    }

    // 调用转写服务
    const sentences = await transcribeVideoFile(filePath, video.mime_type);

    // 清除旧的句子
    db.prepare('DELETE FROM sentences WHERE video_id = ?').run(Number(id));

    // 插入新的句子
    const insert = db.prepare('INSERT INTO sentences (video_id, sentence_index, text, start, end) VALUES (?, ?, ?, ?, ?)');

    for (const [index, sentence] of sentences.entries()) {
      insert.run(Number(id), index, sentence.text, sentence.start, sentence.end);
    }

    // 更新视频为已转写状态
    db.prepare('UPDATE videos SET transcribed = 1, transcribed_at = ? WHERE id = ?')
      .run(new Date().toISOString(), Number(id));

    console.log(`Transcription completed for video ${id}, ${sentences.length} sentences saved`);

    res.json(sentences);
  } catch (error: any) {
    console.error('Error transcribing video:', error);
    res.status(500).json({ error: error.message || 'Failed to transcribe video' });
  }
});

// 上传录音
app.post('/api/videos/:videoId/recordings/:sentenceIndex', uploadRecording.single('recording'), (req, res) => {
  try {
    const { videoId, sentenceIndex } = req.params;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // 检查视频是否存在
    const video = db.prepare('SELECT id FROM videos WHERE id = ?').get(Number(videoId)) as VideoRow | undefined;
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // 删除旧的录音文件和数据库记录（如果存在）
    const oldRecording = db
      .prepare('SELECT file_path FROM recordings WHERE video_id = ? AND sentence_index = ?')
      .get(Number(videoId), Number(sentenceIndex)) as RecordingRow | undefined;
    if (oldRecording) {
      try {
        const oldPath = path.isAbsolute(oldRecording.file_path)
          ? oldRecording.file_path
          : path.join(process.cwd(), oldRecording.file_path);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      } catch (err) {
        console.warn('Failed to delete old recording file:', err);
      }
    }
    db.prepare('DELETE FROM recordings WHERE video_id = ? AND sentence_index = ?').run(Number(videoId), Number(sentenceIndex));

    // 插入新的录音（存储相对路径）
    const relativePath = path.relative(process.cwd(), file.path);
    db
      .prepare(
        'INSERT INTO recordings (video_id, sentence_index, file_path, mime_type) VALUES (?, ?, ?, ?)'
      )
      .run(Number(videoId), Number(sentenceIndex), relativePath, file.mimetype);

    res.status(204).send();
  } catch (error) {
    console.error('Error uploading recording:', error);
    res.status(500).json({ error: 'Failed to upload recording' });
  }
});

// 获取录音文件
app.get('/api/videos/:videoId/recordings/:sentenceIndex', (req, res) => {
  try {
    const { videoId, sentenceIndex } = req.params;
    const recording = db
      .prepare('SELECT file_path, mime_type FROM recordings WHERE video_id = ? AND sentence_index = ?')
      .get(Number(videoId), Number(sentenceIndex)) as RecordingRow | undefined;

    if (!recording) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    const filePath = path.isAbsolute(recording.file_path) ? recording.file_path : path.join(process.cwd(), recording.file_path);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Recording file not found' });
    }

    res.setHeader('Content-Type', recording.mime_type);
    res.sendFile(filePath);
  } catch (error) {
    console.error('Error serving recording:', error);
    res.status(500).json({ error: 'Failed to serve recording' });
  }
});

// 转写录音
app.post('/api/videos/:videoId/recordings/:sentenceIndex/transcribe', async (req, res) => {
  try {
    const { videoId, sentenceIndex } = req.params;
    const recording = db
      .prepare('SELECT file_path, mime_type, transcribed_text FROM recordings WHERE video_id = ? AND sentence_index = ?')
      .get(Number(videoId), Number(sentenceIndex)) as RecordingRow | undefined;

    if (!recording) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    // 如果已经有转写结果，直接返回
    if (recording.transcribed_text) {
      console.log(`Recording ${videoId}-${sentenceIndex} already transcribed, returning cached result`);
      return res.json({ text: recording.transcribed_text, cached: true });
    }

    const filePath = path.isAbsolute(recording.file_path) ? recording.file_path : path.join(process.cwd(), recording.file_path);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Recording file not found' });
    }

    // 调用转写服务
    const transcribedText = await transcribeAudioFile(filePath, recording.mime_type);

    // 保存转写结果到数据库
    db.prepare('UPDATE recordings SET transcribed_text = ? WHERE video_id = ? AND sentence_index = ?')
      .run(transcribedText, Number(videoId), Number(sentenceIndex));

    console.log(`Transcription saved for recording ${videoId}-${sentenceIndex}`);

    res.json({ text: transcribedText, cached: false });
  } catch (error: any) {
    console.error('Error transcribing recording:', error);
    res.status(500).json({ error: error.message || 'Failed to transcribe recording' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📁 Data directory: ${dataDir}`);
  console.log(`🔑 KIMI_API_KEY: ${process.env.KIMI_API_KEY ? 'configured' : 'NOT configured'}`);
});
