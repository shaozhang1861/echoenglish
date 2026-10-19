/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, Play, Pause, RotateCcw, CheckCircle2, Loader2, ChevronRight, Volume2, Mic, Square, ArrowLeft, Video, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import * as api from './api';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function displayFilename(value: string) {
  return value.split('?')[0].replace(/video(?=\.[^.]+$)/i, '') || value;
}

// 给每段开头保留少量上下文，避免转写时间戳或关键帧定位误差吞掉第一个词。
const SENTENCE_LEAD_IN_SECONDS = 0;
// Kimi 的句尾时间通常略早；额外播放约 1.5 秒，允许相邻练习段自然重叠。
const SENTENCE_TAIL_OUT_SECONDS = 1.5;

export default function App() {
  const [videoId, setVideoId] = useState<number | null>(null);
  const [videoList, setVideoList] = useState<api.VideoListItem[]>([]);
  const [filename, setFilename] = useState<string>('');
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [sentences, setSentences] = useState<{ text: string; start: number; end: number }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingIndex, setRecordingIndex] = useState<number | null>(null);
  const [recordedUrls, setRecordedUrls] = useState<Record<number, string>>({});
  const [userAudioPlayingIndex, setUserAudioPlayingIndex] = useState<number | null>(null);
  const [reusedMessage, setReusedMessage] = useState<string | null>(null);
  const [transcribedTexts, setTranscribedTexts] = useState<Record<number, string>>({});
  const [transcribeStatus, setTranscribeStatus] = useState<Record<number, 'pending' | 'success' | 'error'>>({});
  const [thumbnailErrors, setThumbnailErrors] = useState<Record<number, boolean>>({});
  // 音高分析暂不接入运行；保留下面的结果视图代码，方便以后恢复。
  const [pitchAnalysis] = useState<api.PitchAnalysisResult | null>(null);
  const [pitchAnalyzingIndex] = useState<number | null>(null);
  const [pitchError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const userAudioRef = useRef<HTMLAudioElement | null>(null);
  const playbackTimerRef = useRef<number | null>(null);
  const playbackRequestRef = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    api.getVideos().then(setVideoList).catch(console.error);
  }, []);

  const uniqueVideoList = useMemo(() => {
    const seen = new Set<string>();
    return videoList.filter((video) => {
      const title = displayFilename(video.filename).trim().toLocaleLowerCase();
      if (seen.has(title)) return false;
      seen.add(title);
      return true;
    });
  }, [videoList]);

  // 文本对比函数：标记与原文不同或缺失的部分
  const compareTexts = (originalText: string, transcribedText: string): { text: string; isDifferent: boolean }[] => {
    // 清理文本：转小写、去除标点和多余空格
    const cleanOriginal = originalText.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    const cleanTranscribed = transcribedText.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();

    const originalWords = cleanOriginal.split(' ');
    const transcribedWords = cleanTranscribed.split(' ');

    // 标记每个原始单词是否缺失
    const result: { text: string; isDifferent: boolean }[] = [];

    // 简单的单词级别对比
    originalWords.forEach((word) => {
      // 检查该词是否在转写文本中
      const isMissing = !transcribedWords.includes(word);
      result.push({ text: word, isDifferent: isMissing });
    });

    return result;
  };

  const openVideo = async (id: number) => {
    setError(null);
    setReusedMessage(null);
    try {
      const detail = await api.getVideo(id);
      setVideoId(detail.id);
      setFilename(detail.filename);
      setFileSize(null);
      setVideoUrl(api.getVideoFileUrl(detail.id));
      setSentences(detail.sentences);
      setRecordedUrls(Object.fromEntries(detail.recordingIndices.map((i) => [i, api.getRecordingUrl(detail.id, i)])) as Record<number, string>);
      setTranscribedTexts(detail.transcribedTexts || {});
      setTranscribeStatus({});

      // 根据转写结果设置初始状态
      const initialStatus: Record<number, 'pending' | 'success' | 'error'> = {};
      Object.keys(detail.transcribedTexts || {}).forEach((key) => {
        initialStatus[Number(key)] = 'success';
      });
      setTranscribeStatus(initialStatus);

      setCurrentSentenceIndex(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load video');
    }
  };

  const pauseVideoPlayback = () => {
    playbackRequestRef.current += 1;
    if (playbackTimerRef.current) {
      window.clearTimeout(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    videoRef.current?.pause();
    setIsPlaying(false);
  };

  const pauseUserAudio = () => {
    if (userAudioRef.current) {
      userAudioRef.current.pause();
      userAudioRef.current = null;
    }
    setUserAudioPlayingIndex(null);
  };

  const backToList = () => {
    pauseVideoPlayback();
    pauseUserAudio();
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    if (videoUrl?.startsWith('blob:')) URL.revokeObjectURL(videoUrl);
    Object.values(recordedUrls).forEach((url) => {
      const u = url as string;
      if (u.startsWith('blob:')) URL.revokeObjectURL(u);
    });
    setVideoId(null);
    setFilename('');
    setFileSize(null);
    setVideoUrl(null);
    setSentences([]);
    setRecordedUrls({});
    setTranscribedTexts({});
    setCurrentSentenceIndex(null);
    setIsRecording(false);
    setRecordingIndex(null);
    setReusedMessage(null);
    setError(null);
    api.getVideos().then(setVideoList).catch(console.error);
  };

  const onDrop = async (acceptedFiles: File[]) => {
    const selectedFile = acceptedFiles[0];
    if (!selectedFile) return;
    setError(null);
    setReusedMessage(null);
    setIsLoading(true);
    try {
      const res = await api.uploadVideo(selectedFile);
      setVideoId(res.id);
      setFilename(res.filename);
      setFileSize(selectedFile.size);
      setVideoUrl(api.getVideoFileUrl(res.id));

      // 处理复用消息
      if (res.message || res.reused) {
        setReusedMessage(res.message || 'Reusing previous analysis');
        // 如果已解析，延迟显示句子列表
        if (res.transcribed) {
          setTimeout(async () => {
            const sentences = await api.getSentences(res.id);
            setSentences(sentences);
            setRecordedUrls({});
            setTranscribedTexts({});
          }, 100);
        }
      } else {
        setSentences([]);
        setRecordedUrls({});
        setTranscribedTexts({});
      }

      setCurrentSentenceIndex(null);
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setIsLoading(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'video/*': [] },
    multiple: false,
    disabled: isLoading || api.isDemoMode,
  } as any);

  const handleTranscribe = async () => {
    if (videoId == null) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await api.transcribeVideo(videoId);
      setSentences(result);
    } catch (err: any) {
      setError(err.message || 'Failed to process video');
    } finally {
      setIsLoading(false);
    }
  };

  const togglePlaySentence = async (index: number) => {
    if (!videoRef.current || !sentences[index]) return;

    const video = videoRef.current;
    const sentence = sentences[index];

    // If clicking the same sentence that is currently playing, pause it
    if (currentSentenceIndex === index && isPlaying) {
      pauseVideoPlayback();
      return;
    }

    // 原视频与用户录音互斥：开始原视频前先停止用户录音回放。
    pauseUserAudio();
    pauseVideoPlayback();

    const requestId = playbackRequestRef.current;
    const startTime = Math.max(0, sentence.start - SENTENCE_LEAD_IN_SECONDS);

    try {
      // 等待浏览器完成精确定位后再播放，避免从上一个关键帧或旧时间点起播。
      if (video.readyState === 0) {
        await new Promise<void>((resolve, reject) => {
          video.addEventListener('loadedmetadata', () => resolve(), { once: true });
          video.addEventListener('error', () => reject(new Error('Video metadata failed to load')), { once: true });
        });
      }

      if (Math.abs(video.currentTime - startTime) > 0.01) {
        await new Promise<void>((resolve) => {
          const finishSeek = () => {
            window.clearTimeout(seekFallback);
            video.removeEventListener('seeked', finishSeek);
            resolve();
          };
          const seekFallback = window.setTimeout(finishSeek, 1000);
          video.addEventListener('seeked', finishSeek);
          video.currentTime = startTime;
        });
      } else {
        video.currentTime = startTime;
      }

      if (requestId !== playbackRequestRef.current) return;

      setCurrentSentenceIndex(index);
      await video.play();
      if (requestId !== playbackRequestRef.current) {
        video.pause();
        return;
      }
      setIsPlaying(true);

      // Clear existing timer
      if (playbackTimerRef.current) {
        window.clearTimeout(playbackTimerRef.current);
      }

      // 使用该句自身的结束时间，并保留少量尾音缓冲。
      const endTime = sentence.end + SENTENCE_TAIL_OUT_SECONDS;

      // Set timer to stop at the end of the sentence
      const remainingTime = (endTime - video.currentTime) * 1000;
      playbackTimerRef.current = window.setTimeout(() => {
        if (videoRef.current && requestId === playbackRequestRef.current) {
          videoRef.current.pause();
          setIsPlaying(false);
        }
      }, Math.max(remainingTime, 0));
    } catch (err) {
      // Interrupted by pause or other issue
      console.warn("Playback interrupted or failed:", err);
    }
  };

  const startRecording = async (index: number) => {
    // 开始录音前暂停页面内所有正在播放的原视频或用户录音。
    pauseVideoPlayback();
    pauseUserAudio();

    // If already recording a different sentence, stop it first
    if (isRecording && recordingIndex !== index) {
      stopRecording();
      // Wait a bit for the stop to complete before starting new recording
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/mp4' });
        if (videoId != null && !api.isDemoMode) {
          // Upload to server when we have a video ID
          api.uploadRecording(videoId, index, audioBlob).then(() => {
            // 加时间戳破坏浏览器缓存，确保播放最新录音
            setRecordedUrls((prev) => ({ ...prev, [index]: api.getRecordingPlayUrl(videoId, index, String(Date.now())) }));
            // 同时清除该句的转写结果，因为新录音需要重新转写
            setTranscribedTexts((prev) => {
              const next = { ...prev };
              delete next[index];
              return next;
            });
            setTranscribeStatus((prev) => {
              const next = { ...prev };
              delete next[index];
              return next;
            });
            console.log(`Recording saved for sentence ${index}`);
          }).catch((err) => {
            console.error(`Failed to upload recording for sentence ${index}:`, err);
          });
        } else {
          // Create blob URL when no video ID (local preview)
          const audioUrl = URL.createObjectURL(audioBlob);
          setRecordedUrls((prev) => {
            // Revoke old blob URL if exists
            if (prev[index]?.startsWith('blob:')) {
              URL.revokeObjectURL(prev[index]);
            }
            return { ...prev, [index]: audioUrl };
          });
          console.log(`Recording saved locally for sentence ${index}`);
        }
        // Stop the audio stream tracks and cleanup
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingIndex(index);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      setError("Could not access microphone. Please check permissions.");
    }
  };

  const togglePlayUserAudio = async (index: number) => {
    const url = recordedUrls[index];
    if (!url) {
      console.log(`No recording found for sentence ${index}`);
      return;
    }

    // If clicking the same playing audio, pause it
    if (userAudioPlayingIndex === index) {
      console.log(`Pausing audio for sentence ${index}`);
      pauseUserAudio();
      return;
    }

    // 用户录音与原视频互斥，并停止之前播放的另一条用户录音。
    pauseVideoPlayback();
    pauseUserAudio();

    console.log(`Playing recording for sentence ${index}, URL:`, url);
    const audio = new Audio(url);
    userAudioRef.current = audio;
    setUserAudioPlayingIndex(index);

    audio.onended = () => {
      console.log(`Audio ended for sentence ${index}`);
      setUserAudioPlayingIndex(null);
    };

    audio.onerror = (e) => {
      console.error('Audio playback error:', e);
      setUserAudioPlayingIndex(null);
    };

    try {
      await audio.play();
    } catch (err) {
      console.warn("User audio playback interrupted or failed:", err);
      setUserAudioPlayingIndex(null);
    }

    // 暂停自动转写功能（需要时取消注释即可恢复）
    // if (!transcribedTexts[index] && videoId != null && transcribeStatus[index] !== 'pending') {
    //   console.log(`Starting transcription for sentence ${index} on playback...`);
    //   setTranscribeStatus((prev) => ({ ...prev, [index]: 'pending' }));
    //
    //   api.transcribeRecording(videoId, index)
    //     .then((transcribedText) => {
    //       console.log(`Transcription completed for sentence ${index}:`, transcribedText);
    //       setTranscribedTexts((prev) => ({ ...prev, [index]: transcribedText }));
    //       setTranscribeStatus((prev) => ({ ...prev, [index]: 'success' }));
    //     })
    //     .catch((err) => {
    //       console.error(`Transcription failed for sentence ${index}:`, err);
    //       setTranscribeStatus((prev) => ({ ...prev, [index]: 'error' }));
    //     });
    // }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      console.log('Stopping recording for sentence:', recordingIndex);
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setRecordingIndex(null);
      mediaRecorderRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (playbackTimerRef.current) {
        window.clearTimeout(playbackTimerRef.current);
      }
      if (videoUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(videoUrl);
      }
      Object.values(recordedUrls).forEach((url) => {
        const u = url as string | undefined;
        if (u?.startsWith('blob:')) URL.revokeObjectURL(u);
      });
    };
  }, [videoUrl, recordedUrls]);

  return (
    <div className="min-h-screen bg-white text-[#37352f] font-sans selection:bg-[#e7e7e5] selection:text-[#37352f]">
      <header className="bg-white/95 border-b border-[#e9e9e7] sticky top-0 z-10 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-12 flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              if (videoUrl) backToList();
            }}
            disabled={!videoUrl}
            aria-label={videoUrl ? 'Back to video list' : 'EchoEnglish home'}
            className={cn(
              'flex items-center gap-2 rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#37352f] focus-visible:ring-offset-2',
              videoUrl && 'cursor-pointer hover:bg-[#f1f1ef] px-1.5 py-1 -ml-1.5 transition-colors'
            )}
          >
            <div className="w-7 h-7 bg-[#37352f] rounded-[5px] flex items-center justify-center text-white">
              <Volume2 size={16} />
            </div>
            <h1 className="text-sm font-semibold tracking-[-0.01em]">EchoEnglish</h1>
          </button>
          <div className="text-sm text-[#787774]">
            Speaking workspace
          </div>
        </div>
      </header>

      <main className={cn('mx-auto px-4 sm:px-6 py-8 sm:py-10', videoUrl ? 'max-w-[1536px]' : 'max-w-7xl')}>
        <div className={cn(videoUrl ? 'grid grid-cols-1 lg:grid-cols-[minmax(0,680px)_minmax(360px,768px)] gap-8 lg:gap-10 lg:justify-center' : 'max-w-3xl mx-auto')}>
          {/* Left Column: Video Upload & Display */}
          <div className="space-y-6">
            <section>
              <div className="mb-5">
                <h2 className="text-xl font-semibold tracking-[-0.02em]">{videoUrl ? 'Video' : 'Your videos'}</h2>
                {!videoUrl && <p className="mt-1 text-sm text-[#787774]">{api.isDemoMode ? 'Explore a pre-analyzed video in this public demo.' : 'Upload a video or continue from your recent practice.'}</p>}
              </div>

              {videoUrl ? (
                /* Video Display */
                <div className="border border-[#e9e9e7] rounded-lg overflow-hidden">
                  <div className="aspect-video bg-black overflow-hidden relative group">
                    <video
                      ref={videoRef}
                      src={videoUrl}
                      className="w-full h-full"
                      onPlay={() => {
                        pauseUserAudio();
                        setIsPlaying(true);
                      }}
                      onPause={() => setIsPlaying(false)}
                    />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 pointer-events-none">
                      {isPlaying ? <Pause className="text-white" size={48} /> : <Play className="text-white" size={48} />}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-3 py-3 border-t border-[#e9e9e7]">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 bg-[#f1f1ef] rounded-[5px] flex items-center justify-center text-[#787774]">
                        <Video size={15} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate max-w-[190px]">{displayFilename(filename)}</p>
                        {fileSize != null && <p className="text-xs text-[#9b9a97]">{(fileSize / (1024 * 1024)).toFixed(1)} MB</p>}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={backToList}
                      className="shrink-0 h-8 text-sm text-[#787774] hover:text-[#37352f] hover:bg-[#f1f1ef] px-2 rounded-[4px] transition-colors flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#37352f]"
                    >
                      <ArrowLeft size={14} /> Change Video
                    </button>
                  </div>
                </div>
              ) : (
                /* Upload Guide */
                <div className="space-y-10">
                  {/* Video History */}
                  {uniqueVideoList.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium">Recent</h3>
                        <span className="text-xs text-[#9b9a97]">{uniqueVideoList.length} videos</span>
                      </div>
                      <ul className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-6">
                        {uniqueVideoList.map((v) => (
                          <li key={v.id} className="min-w-0">
                            <button
                              type="button"
                              onClick={() => openVideo(v.id)}
                              className="w-full text-left group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#37352f] focus-visible:ring-offset-2 rounded-[4px]"
                            >
                              <div className="relative aspect-video overflow-hidden rounded-[4px] border border-[#e9e9e7] bg-[#f1f1ef] group-hover:border-[#c7c7c5] transition-colors">
                                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[#9b9a97] bg-[linear-gradient(135deg,#f7f7f5,#e9e9e7)]">
                                  <Video size={20} />
                                  <span className="text-xs">No preview</span>
                                </div>
                                {!thumbnailErrors[v.id] && (
                                  <video
                                    src={api.getVideoFileUrl(v.id)}
                                    muted
                                    playsInline
                                    preload="metadata"
                                    aria-hidden="true"
                                    tabIndex={-1}
                                    className="absolute inset-0 w-full h-full object-cover bg-[#f1f1ef]"
                                    onLoadedMetadata={(event) => {
                                      const preview = event.currentTarget;
                                      if (Number.isFinite(preview.duration) && preview.duration > 0) {
                                        preview.currentTime = Math.min(0.1, preview.duration / 2);
                                      }
                                    }}
                                    onError={() => setThumbnailErrors((current) => ({ ...current, [v.id]: true }))}
                                  />
                                )}
                              </div>
                              <div className="mt-2 min-w-0">
                                <p className="text-sm font-medium truncate group-hover:underline underline-offset-2">{displayFilename(v.filename)}</p>
                                <p className="mt-0.5 text-xs text-[#9b9a97]">{v.hasSentences ? 'Ready to practice' : 'Needs analysis'}</p>
                              </div>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div>
                    <h3 className="text-sm font-medium mb-3">{api.isDemoMode ? 'Try your own video' : 'Add a video'}</h3>
                    <div
                      {...getRootProps()}
                      className={cn(
                        'border border-dashed rounded-lg px-6 py-8 flex flex-col items-center justify-center transition-colors focus-within:ring-2 focus-within:ring-[#37352f] focus-within:ring-offset-2',
                        api.isDemoMode
                          ? 'border-[#d3d3d1] bg-[#fafafa] cursor-default'
                          : isDragActive ? 'border-[#37352f] bg-[#f1f1ef] cursor-pointer' : 'border-[#c7c7c5] bg-white hover:bg-[#fafafa] hover:border-[#9b9a97] cursor-pointer'
                      )}
                    >
                      <input {...getInputProps()} />
                      <div className="w-9 h-9 bg-[#f1f1ef] rounded-[4px] flex items-center justify-center text-[#37352f] mb-3">
                        <Upload size={18} />
                      </div>
                      <p className="text-sm font-medium text-center mb-1">{api.isDemoMode ? 'Upload and AI analysis run locally' : 'Upload a video'}</p>
                      <p className="text-sm text-[#787774] text-center max-w-sm">
                        {api.isDemoMode
                          ? 'Download the project from GitHub and add your own Kimi API key to analyze private videos.'
                          : 'Drop a file here or click to browse. Supports MP4, MOV and WebM.'}
                      </p>
                    </div>
                  </div>

                  <details className="group border-t border-[#e9e9e7] pt-4 text-sm">
                    <summary className="cursor-pointer list-none flex items-center justify-between text-[#787774] hover:text-[#37352f]">
                      <span>Tips for better results</span>
                      <ChevronRight size={14} className="transition-transform group-open:rotate-90" />
                    </summary>
                    <div className="pt-3 text-xs text-[#787774]">
                      <ul className="list-disc space-y-1.5 ml-4">
                        <li>Use clear English audio with minimal background noise</li>
                        <li>Optimal video length: 30 seconds to 5 minutes</li>
                        <li>The video will be stored for repeated practice</li>
                      </ul>
                    </div>
                  </details>
                </div>
              )}
            </section>

            {videoUrl && sentences.length === 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-start gap-2"
              >
                <button
                  onClick={handleTranscribe}
                  disabled={isLoading}
                  className="w-full h-8 px-3 bg-[#37352f] hover:bg-[#2f2e2b] active:bg-[#22211f] disabled:bg-[#c7c7c5] text-white rounded-[4px] text-sm font-medium transition-colors flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#37352f] focus-visible:ring-offset-2"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="animate-spin" size={20} />
                      Analyzing Audio...
                    </>
                  ) : (
                    <>
                      <RotateCcw size={20} />
                      Start Analysis
                    </>
                  )}
                </button>
                <p className="text-xs text-[#787774]">
                  Kimi will transcribe the video and split it into sentences for practice.
                </p>
              </motion.div>
            )}

            {error && (
              <div className="p-3 bg-[#fdf3f2] border border-[#f1c6c2] rounded-md text-[#9f2f28] text-sm flex items-start gap-3">
                <X className="mt-0.5 shrink-0" size={15} />
                <p>{error}</p>
              </div>
            )}
          </div>

          {/* Right Column: Sentences List */}
          {videoUrl && (
          <div className="space-y-8 min-w-0">
            <section className="h-full flex flex-col">
              <div className="mb-5 flex items-end justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold tracking-[-0.02em]">Practice</h2>
                  <p className="mt-1 text-sm text-[#787774]">Listen, repeat and compare each sentence.</p>
                </div>
                {sentences.length > 0 && <span className="text-xs text-[#9b9a97] shrink-0">{sentences.length} sentences</span>}
              </div>
              
              <div className="flex-1 min-h-[320px] border-y border-[#e9e9e7] overflow-hidden flex flex-col">
                {sentences.length > 0 ? (
                  <div className="divide-y divide-[#e9e9e7] overflow-y-auto max-h-[70vh] scrollbar-hide">
                    <AnimatePresence mode="popLayout">
                      {sentences.map((sentence, index) => (
                        <motion.div
                          key={index}
                          initial={false}
                          className={cn(
                            "px-2 py-4 flex items-start gap-3 transition-colors group cursor-pointer",
                            currentSentenceIndex === index ? "bg-[#f7f7f5]" : "hover:bg-[#fafafa]"
                          )}
                        >
                          <div className="flex flex-col gap-2 shrink-0 items-center w-8">
                            <span className="text-xs tabular-nums text-[#9b9a97] h-5 flex items-center">{String(index + 1).padStart(2, '0')}</span>
                            <button 
                              type="button"
                              aria-label={`${currentSentenceIndex === index && isPlaying ? 'Pause' : 'Play'} sentence ${index + 1}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePlaySentence(index);
                              }}
                              className={cn(
                                "w-7 h-7 rounded-[4px] flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#37352f]",
                                currentSentenceIndex === index 
                                  ? "bg-[#37352f] text-white"
                                  : "text-[#9b9a97] hover:bg-[#e7e7e5] hover:text-[#37352f]"
                              )}
                            >
                              {currentSentenceIndex === index && isPlaying ? (
                                <Pause size={14} fill="currentColor" />
                              ) : (
                                <Play size={14} fill={currentSentenceIndex === index ? "currentColor" : "none"} />
                              )}
                            </button>

                            {/* 录音按钮 + 动效（水平排列） */}
                            <div className="flex items-center gap-2">
                              <button
                              type="button"
                              aria-label={`${isRecording && recordingIndex === index ? 'Stop recording' : 'Record'} sentence ${index + 1}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isRecording && recordingIndex === index) {
                                  stopRecording();
                                } else {
                                  startRecording(index);
                                }
                              }}
                              className={cn(
                                "w-7 h-7 rounded-[4px] flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#37352f]",
                                isRecording && recordingIndex === index
                                  ? "bg-[#d44c47] text-white"
                                  : "text-[#9b9a97] hover:bg-[#f1f1ef] hover:text-[#37352f]"
                                )}
                            >
                              {isRecording && recordingIndex === index ? (
                                <Square size={14} fill="currentColor" />
                              ) : (
                                <Mic size={14} />
                              )}
                            </button>

                            {/* 录音动效 */}
                            {isRecording && recordingIndex === index && (
                              <div className="flex items-center gap-1">
                                {[0, 1, 2].map((i) => (
                                  <motion.div
                                    key={i}
                                    className="w-0.5 bg-[#d44c47] rounded-full"
                                    animate={{
                                      height: ['5px', '12px', '5px'],
                                      opacity: [0.5, 1, 0.5],
                                    }}
                                    transition={{
                                      duration: 1,
                                      repeat: Infinity,
                                      ease: 'easeInOut',
                                      delay: i * 0.15,
                                    }}
                                  />
                                ))}
                              </div>
                            )}
                            </div>
                          </div>

                          <div className="flex-1 min-w-0 space-y-3 pt-5" onClick={() => togglePlaySentence(index)}>
                            {transcribedTexts[index] ? (
                              <div className={cn(
                                "text-[17px] leading-7 transition-colors space-y-2",
                                currentSentenceIndex === index ? "text-[#37352f]" : "text-[#4f4e49]"
                              )}>
                                <p className="text-xs text-[#9b9a97] mb-1">Original</p>
                                <p>
                                  {compareTexts(sentence.text, transcribedTexts[index]).map((item, i) => (
                                    <span key={i} className={item.isDifferent ? 'bg-red-100 text-red-700 px-1 rounded' : ''}>
                                      {item.text}{' '}
                                    </span>
                                  ))}
                                </p>
                                <div className="text-xs mt-2 text-[#787774] border-l-2 border-[#d3d3d1] pl-2">
                                  <span className="font-medium">Your recording:</span> {transcribedTexts[index]}
                                </div>
                              </div>
                            ) : (
                              <p className={cn(
                                "text-[17px] leading-7 transition-colors",
                                currentSentenceIndex === index ? "text-[#37352f]" : "text-[#4f4e49]"
                              )}>
                                {sentence.text}
                              </p>
                            )}

                            {recordedUrls[index] && (
                              <div className="flex items-center gap-3 pt-1">
                                <button
                                  type="button"
                                  aria-label={`${userAudioPlayingIndex === index ? 'Stop' : 'Play'} your recording for sentence ${index + 1}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    togglePlayUserAudio(index);
                                  }}
                                  className={cn(
                                    "h-8 flex items-center gap-1.5 px-2.5 rounded-[4px] text-sm transition-colors border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#37352f]",
                                    userAudioPlayingIndex === index
                                      ? "bg-[#37352f] text-white border-[#37352f]"
                                      : "bg-white text-[#575650] border-[#d3d3d1] hover:bg-[#f1f1ef]"
                                  )}
                                >
                                  {userAudioPlayingIndex === index ? (
                                    <>
                                      <Pause size={12} fill="currentColor" />
                                      Stop My Recording
                                    </>
                                  ) : (
                                    <>
                                      <Play size={12} fill="currentColor" />
                                      Play My Recording
                                    </>
                                  )}
                                </button>

                                {/* 转写状态图标 */}
                                {transcribeStatus[index] === 'pending' && (
                                  <Loader2 className="animate-spin text-[#787774]" size={14} />
                                )}
                                {transcribeStatus[index] === 'success' && (
                                  <CheckCircle2 className="text-[#787774]" size={14} />
                                )}

                                {transcribeStatus[index] === 'error' && (
                                  <button type="button" aria-label={`Retry transcription for sentence ${index + 1}`} className="w-7 h-7 flex items-center justify-center text-[#9f2f28] cursor-pointer hover:bg-[#fdf3f2] rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#37352f]" onClick={(e) => {
                                    e.stopPropagation();
                                    setTranscribeStatus((prev) => ({ ...prev, [index]: 'pending' }));
                                    if (videoId != null) {
                                      api.transcribeRecording(videoId, index)
                                        .then((transcribedText) => {
                                          setTranscribedTexts((prev) => ({ ...prev, [index]: transcribedText }));
                                          setTranscribeStatus((prev) => ({ ...prev, [index]: 'success' }));
                                        })
                                        .catch((err) => {
                                          console.error(`Transcription failed for sentence ${index}:`, err);
                                          setTranscribeStatus((prev) => ({ ...prev, [index]: 'error' }));
                                        });
                                    }
                                  }}>
                                    <X size={14} />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center p-10 text-center">
                    <div className="w-8 h-8 bg-[#f1f1ef] rounded-md flex items-center justify-center text-[#9b9a97] mb-3">
                      <Volume2 size={16} />
                    </div>
                    <p className="text-sm text-[#787774]">
                      {isLoading ? "Analyzing your video..." : "Upload a video and start analysis to see practice sentences"}
                    </p>
                  </div>
                )}
              </div>
            </section>

            {/* Pitch Analysis Results */}
            {false && (pitchAnalysis || pitchError || pitchAnalyzingIndex !== null) && (
              <section>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-black/40 mb-4">Pitch Analysis</h2>
                <div className="bg-white rounded-3xl border border-black/5 shadow-sm p-6">
                  {pitchAnalyzingIndex !== null && sentences[pitchAnalyzingIndex] && (
                    <div className="mb-4">
                      <p className="text-xs text-black/40 mb-1">Analyzing sentence:</p>
                      <p className="text-sm font-medium text-gray-700">{sentences[pitchAnalyzingIndex].text}</p>
                    </div>
                  )}
                  {pitchError && (
                    <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 text-sm">
                      {pitchError}
                    </div>
                  )}
                  {pitchAnalysis && (
                    <div className="space-y-6">
                      {/* Stats comparison */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-blue-50 rounded-2xl p-4">
                          <p className="text-xs font-semibold uppercase tracking-wider text-blue-400 mb-3">Original Audio</p>
                          <div className="space-y-1">
                            <div className="flex justify-between">
                              <span className="text-xs text-blue-500">Mean F0</span>
                              <span className="text-xs font-semibold text-blue-700">
                                {pitchAnalysis.original.stats.mean != null ? `${pitchAnalysis.original.stats.mean.toFixed(1)} Hz` : 'N/A'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-xs text-blue-500">Min F0</span>
                              <span className="text-xs font-semibold text-blue-700">
                                {pitchAnalysis.original.stats.min != null ? `${pitchAnalysis.original.stats.min.toFixed(1)} Hz` : 'N/A'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-xs text-blue-500">Max F0</span>
                              <span className="text-xs font-semibold text-blue-700">
                                {pitchAnalysis.original.stats.max != null ? `${pitchAnalysis.original.stats.max.toFixed(1)} Hz` : 'N/A'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-xs text-blue-500">Range</span>
                              <span className="text-xs font-semibold text-blue-700">
                                {pitchAnalysis.original.stats.range != null ? `${pitchAnalysis.original.stats.range.toFixed(1)} Hz` : 'N/A'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-xs text-blue-500">Voicing Ratio</span>
                              <span className="text-xs font-semibold text-blue-700">
                                {pitchAnalysis.original.stats.voicing_ratio != null ? `${(pitchAnalysis.original.stats.voicing_ratio * 100).toFixed(0)}%` : 'N/A'}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="bg-emerald-50 rounded-2xl p-4">
                          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400 mb-3">Your Recording</p>
                          <div className="space-y-1">
                            <div className="flex justify-between">
                              <span className="text-xs text-emerald-500">Mean F0</span>
                              <span className="text-xs font-semibold text-emerald-700">
                                {pitchAnalysis.recording.stats.mean != null ? `${pitchAnalysis.recording.stats.mean.toFixed(1)} Hz` : 'N/A'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-xs text-emerald-500">Min F0</span>
                              <span className="text-xs font-semibold text-emerald-700">
                                {pitchAnalysis.recording.stats.min != null ? `${pitchAnalysis.recording.stats.min.toFixed(1)} Hz` : 'N/A'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-xs text-emerald-500">Max F0</span>
                              <span className="text-xs font-semibold text-emerald-700">
                                {pitchAnalysis.recording.stats.max != null ? `${pitchAnalysis.recording.stats.max.toFixed(1)} Hz` : 'N/A'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-xs text-emerald-500">Range</span>
                              <span className="text-xs font-semibold text-emerald-700">
                                {pitchAnalysis.recording.stats.range != null ? `${pitchAnalysis.recording.stats.range.toFixed(1)} Hz` : 'N/A'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-xs text-emerald-500">Voicing Ratio</span>
                              <span className="text-xs font-semibold text-emerald-700">
                                {pitchAnalysis.recording.stats.voicing_ratio != null ? `${(pitchAnalysis.recording.stats.voicing_ratio * 100).toFixed(0)}%` : 'N/A'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Pitch curve visualization */}
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-black/40 mb-3">Pitch Curves</p>
                        <div className="relative h-40 bg-gray-50 rounded-2xl overflow-hidden">
                          <svg width="100%" height="100%" viewBox="0 0 600 160" preserveAspectRatio="none" className="w-full h-full">
                            {/* Y axis labels */}
                            <text x="4" y="12" fontSize="9" fill="#9ca3af">500</text>
                            <text x="4" y="48" fontSize="9" fill="#9ca3af">350</text>
                            <text x="4" y="84" fontSize="9" fill="#9ca3af">200</text>
                            <text x="4" y="120" fontSize="9" fill="#9ca3af">100</text>
                            <text x="4" y="156" fontSize="9" fill="#9ca3af">0</text>

                            {/* Horizontal grid lines */}
                            <line x1="20" y1="10" x2="600" y2="10" stroke="#e5e7eb" strokeWidth="0.5" />
                            <line x1="20" y1="46" x2="600" y2="46" stroke="#e5e7eb" strokeWidth="0.5" />
                            <line x1="20" y1="82" x2="600" y2="82" stroke="#e5e7eb" strokeWidth="0.5" />
                            <line x1="20" y1="118" x2="600" y2="118" stroke="#e5e7eb" strokeWidth="0.5" />

                            {/* Original pitch curve */}
                            <polyline
                              points={pitchAnalysis.original.pitch_curve.map(([t, f]) => {
                                const x = 20 + ((t - pitchAnalysis.sentence.start) / (pitchAnalysis.sentence.end - pitchAnalysis.sentence.start)) * 575;
                                const y = f != null ? 150 - ((f - 60) / 500) * 145 : null;
                                return y != null ? `${x},${y}` : '';
                              }).filter(Boolean).join(' ')}
                              fill="none"
                              stroke="#3b82f6"
                              strokeWidth="1.5"
                              strokeLinejoin="round"
                              strokeLinecap="round"
                            />

                            {/* Recording pitch curve */}
                            <polyline
                              points={pitchAnalysis.recording.pitch_curve.map(([t, f]) => {
                                const x = 20 + (t / (pitchAnalysis.sentence.end - pitchAnalysis.sentence.start)) * 575;
                                const y = f != null ? 150 - ((f - 60) / 500) * 145 : null;
                                return y != null ? `${x},${y}` : '';
                              }).filter(Boolean).join(' ')}
                              fill="none"
                              stroke="#10b981"
                              strokeWidth="1.5"
                              strokeLinejoin="round"
                              strokeLinecap="round"
                              strokeDasharray="4 2"
                            />
                          </svg>
                          {/* Legend */}
                          <div className="absolute top-2 right-3 flex items-center gap-3">
                            <div className="flex items-center gap-1">
                              <div className="w-3 h-0.5 bg-blue-500" />
                              <span className="text-[9px] text-gray-400">Original</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <div className="w-3 h-0.5 bg-emerald-500 border-dashed border-t" style={{borderStyle: 'dashed'}} />
                              <span className="text-[9px] text-gray-400">Yours</span>
                            </div>
                          </div>
                          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[9px] text-gray-400">
                            Time (s)
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
          )}
        </div>
      </main>

      <footer className="max-w-6xl mx-auto px-4 sm:px-6 py-6 border-t border-[#e9e9e7] mt-10">
        <div className="flex items-center gap-2 text-xs text-[#9b9a97]">
          <Volume2 size={13} />
          <span>EchoEnglish</span>
        </div>
      </footer>
    </div>
  );
}
