/**
 * 服务端转写：读取本地视频文件，调用 Kimi (Moonshot) API 返回分句结果
 * KIMI_API_KEY 由 server/index.ts 启动时从 .env 或 .env.local 加载
 */

import fs from 'fs';
import path from 'path';

export interface Sentence {
  text: string;
  start: number;
  end: number;
}

const TRANSCRIPTION_MODEL = 'kimi-k2.6';
const MIN_SEGMENT_WORDS = 8;
const MAX_SEGMENT_SECONDS = 20.5;

const prompt = `Create a strictly VERBATIM English transcript of the spoken audio in this video, with sentence-level timestamps for language practice.

ACCURACY IS MORE IMPORTANT THAN READABILITY OR SEGMENT LENGTH.

VERBATIM TRANSCRIPTION RULES:
1. Write every audible spoken word exactly once and in the original order.
2. Preserve all discourse markers and filler words, including every audible "like", "so", "um", "uh", "you know", "I mean", and similar expressions.
3. Preserve repetitions, false starts, self-corrections, contractions, and informal grammar.
4. Do not summarize, paraphrase, clean up, rewrite, reorder, or grammatically correct the speaker.
5. Do not infer words that are not clearly audible. Do not remove a word merely because it sounds redundant.

SEGMENTATION RULES:
1. Work in two silent stages: first create one continuous verbatim transcript; then punctuate and divide that unchanged transcript into practice segments.
2. Each segment must contain one complete spoken sentence or one complete independent clause. Keep a multi-clause sentence together unless it exceeds about 55 words.
3. Never output phrase fragments. Except for a genuinely short standalone sentence, every segment must contain at least 8 words and must not end in a determiner, preposition, conjunction, auxiliary verb, or filler word.
4. A speaker change always starts a new segment. Never combine speech from two speakers in one segment.
5. Split only where grammar, intonation, and a pause support the same boundary. Never split a noun phrase, verb phrase, or prepositional phrase.
6. Across adjacent segments, every spoken word must appear exactly once: no omissions, duplicates, or reordered words.

TIMESTAMP RULES:
1. "start" is the exact time in seconds when the first audible sound of the segment's first written word begins.
2. "end" is the exact time in seconds when the final audible sound of the segment's last written word finishes.
3. Do not add leading or trailing buffer to the timestamps; playback padding is handled separately by the application.
4. Use decimal seconds when needed. Timestamps must be non-negative and each end must be greater than its start.

Before returning, silently re-listen to the first two seconds and every segment boundary, then audit the transcript word by word. Pay special attention to opening words, every occurrence of "like", and the first and last word at each segment boundary.

Return only a valid JSON array with this exact structure and no markdown or commentary:
[{ "text": string, "start": number, "end": number }]`;

export async function transcribeVideoFile(filePath: string, mimeType: string): Promise<Sentence[]> {
  const apiKey = process.env.KIMI_API_KEY;
  if (!apiKey) {
    throw new Error('KIMI_API_KEY is not configured');
  }

  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);

  // 读取视频文件
  const buffer = fs.readFileSync(absolutePath);
  const base64Data = buffer.toString('base64');

  // 调用 Kimi API (Moonshot AI)
  // 使用 Kimi K2.5 多模态模型
  const response = await fetch('https://api.moonshot.cn/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: TRANSCRIPTION_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a meticulous verbatim English transcription and sentence-level forced-alignment engine. Never summarize or copy-edit speech.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'video_url', // 使用 video_url 类型上传视频
              video_url: {
                url: `data:${mimeType};base64,${base64Data}`,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
      thinking: { type: 'disabled' },
      max_completion_tokens: 8192,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Kimi API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  // 记录原始返回值（用于调试）
  console.log('Kimi API raw response:', JSON.stringify(data, null, 2));

  // 提取返回的文本
  let text = data.choices?.[0]?.message?.content;

  if (!text) {
    throw new Error('No content returned from Kimi API');
  }

  // 尝试解析 JSON
  try {
    // 清理可能的 markdown 代码块标记
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    const sentences = JSON.parse(text) as Sentence[];
    console.log('Successfully parsed sentences:', sentences);
    return normalizeTimestamps(sentences);
  } catch (parseError) {
    // 如果解析失败，记录错误但尝试其他方式
    console.error('Failed to parse JSON from Kimi response:', parseError);
    console.error('Raw text:', text);

    // 尝试从文本中提取 JSON 数组
    const arrayMatch = text.match(/\[.*\]/s);
    if (arrayMatch) {
      try {
        const sentences = JSON.parse(arrayMatch[0]) as Sentence[];
        console.log('Extracted and parsed sentences:', sentences);
        return normalizeTimestamps(sentences);
      } catch (e) {
        console.error('Failed to parse extracted array:', e);
      }
    }

    // 如果仍然失败，抛出原始错误并返回响应内容
    throw new Error(`Failed to parse Kimi response as JSON. Raw response: ${text}`);
  }
}

/**
 * 转写音频文件为文本
 * 用于用户录音的转写和对比
 */
export async function transcribeAudioFile(filePath: string, mimeType: string): Promise<string> {
  const apiKey = process.env.KIMI_API_KEY;
  if (!apiKey) {
    throw new Error('KIMI_API_KEY is not configured');
  }

  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);

  // 读取音频文件
  const buffer = fs.readFileSync(absolutePath);
  const base64Data = buffer.toString('base64');

  const audioPrompt =
    'Transcribe this audio strictly verbatim. Preserve every audible word, including filler words such as "like", "um", "uh", repetitions, false starts, and self-corrections. Do not summarize, paraphrase, clean up, or correct grammar. Return only the English transcript with no commentary.';

  // 调用 Kimi API
  const response = await fetch('https://api.moonshot.cn/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: TRANSCRIPTION_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'video_url', // Kimi API 使用 video_url 类型支持音频
              video_url: {
                url: `data:${mimeType};base64,${base64Data}`,
              },
            },
            {
              type: 'text',
              text: audioPrompt,
            },
          ],
        },
      ],
      thinking: { type: 'disabled' },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Kimi API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('No content returned from Kimi API');
  }

  // 清理可能的 markdown 代码块标记
  const cleanedText = text.replace(/```[a-z]*\n?/g, '').replace(/```\n?/g, '').trim();
  console.log('Transcribed audio:', cleanedText);
  return cleanedText;
}

// 保留模型给出的原始时间点，只做数值与边界校正。
function normalizeTimestamps(sentences: Sentence[]): Sentence[] {
  const normalized = sentences.map((s) => {
    const start = Math.max(0, Number(s.start));
    return {
      ...s,
      text: String(s.text).trim(),
      start,
      end: Math.max(start, Number(s.end)),
    };
  });

  normalized.forEach((sentence, index) => {
    const duration = sentence.end - sentence.start;
    if (!sentence.text || !Number.isFinite(sentence.start) || !Number.isFinite(sentence.end) || duration <= 0) {
      throw new Error(`Invalid transcription segment ${index + 1}`);
    }
    if (duration > MAX_SEGMENT_SECONDS) {
      throw new Error(`Transcription segment ${index + 1} is too long (${duration.toFixed(2)}s)`);
    }
    const wordCount = sentence.text.split(/\s+/).filter(Boolean).length;
    if (wordCount < MIN_SEGMENT_WORDS && !/[.!?][\"']?$/.test(sentence.text)) {
      throw new Error(`Transcription segment ${index + 1} is an incomplete phrase (${wordCount} words)`);
    }
    if (index > 0 && sentence.start < normalized[index - 1].end - 0.05) {
      throw new Error(`Transcription segments ${index} and ${index + 1} overlap`);
    }
  });

  return normalized;
}
