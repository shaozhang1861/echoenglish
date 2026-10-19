/**
 * 前端请求后端 API：视频列表、上传、转写、分句与录音的读写
 * 使用相对路径 /api，由 Vite 代理到后端，便于同源与联调
 */

const API = '/api';

export const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';
const demoAsset = (name: string) => `${import.meta.env.BASE_URL}demo/${name}`;

export type VideoListItem = {
  id: number;
  filename: string;
  mimeType: string;
  createdAt: string;
  hasSentences: boolean;
};

export type VideoDetail = {
  id: number;
  filename: string;
  mimeType: string;
  createdAt: string;
  sentences: { text: string; start: number; end: number }[];
  recordingIndices: number[];
  transcribedTexts: Record<number, string>;
  transcribed?: boolean;
  reusedMessage?: string;
};

export async function getVideos(): Promise<VideoListItem[]> {
  if (isDemoMode) {
    return [{ id: 1, filename: 'test1.MP4', mimeType: 'video/mp4', createdAt: '2026-10-18T00:00:00.000Z', hasSentences: true }];
  }
  const res = await fetch(`${API}/videos`);
  if (!res.ok) throw new Error('Failed to fetch videos');
  const videos = await res.json();
  // 添加 hasSentences 字段
  return videos.map((v: any) => ({
    ...v,
    hasSentences: v.hasSentences ?? false
  }));
}

export async function getVideo(id: number): Promise<VideoDetail> {
  if (isDemoMode) {
    if (id !== 1) throw new Error('Demo video not found');
    const res = await fetch(demoAsset('test1-analysis.json'));
    if (!res.ok) throw new Error('Failed to load demo analysis');
    return res.json();
  }
  const res = await fetch(`${API}/videos/${id}`);
  if (!res.ok) throw new Error('Failed to fetch video');
  return res.json();
}

export function getVideoFileUrl(id: number): string {
  if (isDemoMode && id === 1) return demoAsset('test1.mp4');
  return `${API}/videos/${id}/file`;
}

export function getRecordingUrl(videoId: number, sentenceIndex: number): string {
  return `${API}/videos/${videoId}/recordings/${sentenceIndex}`;
}

// 获取带缓存破坏参数的录音 URL（用于播放）
export function getRecordingPlayUrl(videoId: number, sentenceIndex: number, cacheBuster?: string): string {
  const base = `${API}/videos/${videoId}/recordings/${sentenceIndex}`;
  return cacheBuster ? `${base}?t=${cacheBuster}` : base;
}

export async function uploadVideo(file: File): Promise<{
  id: number;
  filename: string;
  mimeType: string;
  transcribed?: boolean;
  reused?: boolean;
  message?: string;
}> {
  if (isDemoMode) throw new Error('Uploading and AI analysis are available in the local version.');
  const form = new FormData();
  form.append('video', file);
  const res = await fetch(`${API}/videos`, { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Upload failed');
  }
  return res.json();
}

export async function getSentences(id: number): Promise<{ text: string; start: number; end: number }[]> {
  const res = await fetch(`${API}/videos/${id}`);
  if (!res.ok) throw new Error('Failed to fetch video sentences');
  const detail = await res.json();
  return detail.sentences ?? [];
}

export async function transcribeVideo(id: number): Promise<{ text: string; start: number; end: number }[]> {
  const res = await fetch(`${API}/videos/${id}/transcribe`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Transcribe failed');
  }
  return res.json();
}

export async function uploadRecording(videoId: number, sentenceIndex: number, blob: Blob): Promise<void> {
  const form = new FormData();
  form.append('recording', blob, 'recording.mp4');
  const res = await fetch(`${API}/videos/${videoId}/recordings/${sentenceIndex}`, { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to save recording');
  }
}

export async function transcribeRecording(videoId: number, sentenceIndex: number): Promise<string> {
  const res = await fetch(`${API}/videos/${videoId}/recordings/${sentenceIndex}/transcribe`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to transcribe recording');
  }
  const data = await res.json();
  return data.text;
}

// 暂存的音高分析结果结构；功能目前不接入运行。
export type PitchAnalysisResult = {
  sentence: { text: string; start: number; end: number };
  original: {
    stats: Record<string, number | null>;
    pitch_curve: [number, number | null][];
  };
  recording: {
    stats: Record<string, number | null>;
    pitch_curve: [number, number | null][];
  };
};
