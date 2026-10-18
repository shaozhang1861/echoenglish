# EchoEnglish 产品需求文档 (PRD)

## 产品概述

**产品名称**：EchoEnglish

**产品定位**：AI 驱动的英语口语练习助手，帮助用户通过跟读练习提升英语发音和口语能力。

**核心价值**：
- 基于真实视频内容的沉浸式学习
- AI 智能转写和分句
- 实时录音与发音对比
- 简洁高效的用户体验

---

## 功能模块

### 1. 视频管理模块

#### 1.1 视频上传

**功能描述**：用户上传视频文件作为学习材料

**支持格式**：MP4, MOV, WebM

**上传方式**：
- 拖拽上传到上传区域
- 点击上传区域选择文件

**文件存储**：
- 服务器端存储在 `data/videos` 目录
- 使用唯一文件名（时间戳 + 随机数）
- 计算并存储 SHA-256 文件哈希

**数据库记录**：
- videos 表：记录视频元数据
  - id（自增主键）
  - filename（原始文件名）
  - file_path（服务器存储路径）
  - mime_type（MIME 类型）
  - file_size（文件大小）
  - file_hash（SHA-256 哈希）
  - transcribed（是否已解析：0/1）
  - transcribed_at（解析时间）
  - created_at（创建时间）

#### 1.2 视频复用机制

**功能描述**：检测并复用已上传过的相同视频，避免重复处理

**检测逻辑**：
1. 计算上传文件的 SHA-256 哈希
2. 优先通过文件哈希在数据库查找
3. 如未找到，通过文件名查找（兼容旧数据）

**复用规则**：
- 已解析视频（transcribed=1）：直接返回，复用分句结果
- 未解析视频（transcribed=0）：更新文件路径，重新解析
- 新视频：插入新记录，执行解析

**用户体验**：
- 复用时显示提示信息
- 无需等待新的解析过程
- 提高响应速度

#### 1.3 视频历史列表

**功能描述**：显示所有上传过的视频

**排序**：按创建时间倒序

**显示内容**：
- 视频文件名
- 解析状态（✓ Analyzed / Not analyzed）
- 点击打开视频

**滚动支持**：最多显示高度 400px，超出可滚动

---

### 2. AI 转写与分句模块

#### 2.1 视频转写

**功能描述**：使用 AI 将视频语音转写为文本，并智能分句

**AI 模型**：Moonshot Kimi K2.5 多模态模型

**Prompt 要求**：
- 创建较长、有意义的句子（15-40 词/句）
- 将短短语合并为完整句子
- 仅在清晰的句子边界分句（句号、问号、重要停顿）
- 每句 3-8 秒说话时间
- 优先有意义的练习片段

**时间戳要求**：
- START：第一个单词开始发音的时间点
- END：最后一个单词完全发音完成的时间点（包括尾音）
- 额外 0.1-0.2 秒缓冲确保完整

**数据库记录**：
- sentences 表：记录每个句子的分句结果
  - id（自增主键）
  - video_id（关联视频 ID）
  - sentence_index（句子序号）
  - text（句子文本）
  - start（开始时间，秒）
  - end（结束时间，秒）
  - UNIQUE 约束：(video_id, sentence_index)

#### 2.2 分句优化

**目标**：避免句子过短，提供更有价值的练习片段

**分句长度**：
- 每句 15-40 个单词（推荐）
- 每句 3-8 秒语音时长

**对比逻辑**：
- 旧版本：按小短语频繁拆分
- 新版本：合并为完整语法单位

---

### 3. 句子播放模块

#### 3.1 句子播放

**功能描述**：播放视频中特定句子的音频片段

**播放逻辑**：
1. 点击句子播放按钮
2. 视频跳转到句子 start 时间
3. 开始播放
4. 在句子结束时间暂停

**结束时间计算**：
- 非最后一句：使用下一句的 start 时间
- 最后一句：使用当前句子的 end 时间
- 统一额外添加 0.2 秒缓冲

**交互设计**：
- 播放中：显示暂停图标，背景色高亮
- 暂停状态：显示播放图标
- 同一句再次点击：暂停/播放切换
- 切换句子：自动跳转到新句子

**视觉反馈**：
- 当前播放句子：翠绿色高亮背景
- 文字颜色：翠绿色深色 + 加粗
- 非播放句子：灰色，悬停显示浅绿

---

### 4. 录音模块

#### 4.1 录音功能

**功能描述**：用户录制自己的跟读音频

**技术实现**：
- 使用浏览器 MediaRecorder API
- 音频格式：audio/webm
- 采样率和编码由浏览器自动选择

**权限管理**：
- 请求麦克风权限
- 拒绝时显示错误提示

**录音流程**：
1. 点击麦克风按钮开始录音
2. 按钮显示红色脉动效果
3. 显示录音动效（三条跳动的红条，水平排列在按钮右侧）
4. 点击方块按钮停止录音
5. 自动上传到服务器

**文件存储**：
- 服务器端存储在 `data/recordings` 目录
- 文件名格式：`recording-{videoId}-{sentenceIndex}-{timestamp}.webm`

**数据库记录**：
- recordings 表：录音元数据和转写结果
  - id（自增主键）
  - video_id（关联视频 ID）
  - sentence_index（句子序号）
  - file_path（文件路径）
  - mime_type（MIME 类型）
  - transcribed_text（转写文本，可为 NULL）
  - created_at（创建时间）
  - UNIQUE 约束：(video_id, sentence_index)

**重复录音处理**：
- 删除旧录音文件
- 更新数据库记录
- 覆盖前端 URL

#### 4.2 录音 UI 设计

**录音按钮状态**：
- 未录音：灰色背景，麦克风图标
- 录音中：红色背景，脉动动画，方块图标
- 悬停：灰色变浅红，图标变红

**录音动效**：
- 位置：录音按钮右侧，水平排列
- 效果：三条红色竖条，高度 8-24px 循环变化
- 动画：1 秒周期，错落 0.15 秒延迟

---

### 5. 录音转写与对比模块

#### 5.1 自动转写

**功能描述**：录音保存后自动调用 AI 转写为文本

**触发时机**：录音文件上传成功后立即触发

**转写流程**：
1. 前端调用转写 API
2. 后端从数据库读取录音文件路径
3. 调用 Kimi API 转写音频
4. 保存转写结果到数据库
5. 返回转写文本给前端

**API 端点**：
- POST `/api/videos/:videoId/recordings/:sentenceIndex/transcribe`
- 请求参数：videoId, sentenceIndex（路径参数）
- 响应：`{ text: string, cached: boolean }`

**缓存机制**：
- 如果数据库已有转写结果（transcribed_text 不为 NULL）
- 直接返回缓存结果，不调用 AI API
- 响应包含 `cached: true` 标识

**Prompt 要求**：
- 准确转写音频
- 仅返回转写的英文文本
- 不包含任何额外说明或解释

#### 5.2 文本对比

**功能描述**：对比用户转写文本与原文，标出差异

**对比算法**：
1. 清理两个文本：
   - 转换为小写
   - 移除标点符号
   - 移除多余空格
2. 按空格分词
3. 对比每个原始单词：
   - 如果在转写文本中存在：正常显示
   - 如果不存在：标红显示（红色背景）

**对比级别**：单词级别

**视觉表现**：
- 正确单词：正常文字颜色
- 缺失/不同单词：红色背景（bg-red-100），红色文字（text-red-700）

#### 5.3 对比结果展示

**展示时机**：转写完成后自动显示

**展示内容**：
- 标签："Original:"
- 原文：每个单词单独渲染，差异标红
- 分隔行
- "Your recording:" 标签
- 用户转写：完整显示

**转写中状态**：
- 显示加载动画（旋转 Loader2）
- 文本："Analyzing your pronunciation..."

**未转写状态**：
- 显示原文
- 正常播放按钮

**状态持久化**：
- 转写结果保存在 recordings.transcribed_text
- 打开视频时自动加载
- 切换视频时清空

---

## 数据库结构

### 表结构

#### videos 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键，自增 |
| filename | TEXT | 原始文件名 |
| file_path | TEXT | 服务器存储路径 |
| mime_type | TEXT | MIME 类型 |
| file_size | INTEGER | 文件大小（字节） |
| file_hash | TEXT | SHA-256 哈希，用于去重 |
| transcribed | INTEGER | 是否已解析（0/1） |
| transcribed_at | TEXT | 解析时间（ISO 8601） |
| created_at | TEXT | 创建时间 |

#### sentences 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键，自增 |
| video_id | INTEGER | 关联 videos.id |
| sentence_index | INTEGER | 句子序号 |
| text | TEXT | 句子文本 |
| start | REAL | 开始时间（秒） |
| end | REAL | 结束时间（秒） |

#### recordings 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键，自增 |
| video_id | INTEGER | 关联 videos.id |
| sentence_index | INTEGER | 句子序号 |
| file_path | TEXT | 录音文件路径 |
| mime_type | TEXT | MIME 类型 |
| transcribed_text | TEXT | 转写文本（可为 NULL） |
| created_at | TEXT | 创建时间 |

### 索引
- `idx_sentences_video_id`: sentences.video_id
- `idx_recordings_video_id`: recordings.video_id

### 外键约束
- sentences.video_id → videos.id (ON DELETE CASCADE)
- recordings.video_id → videos.id (ON DELETE CASCADE)

---

## API 接口

### 视频管理

#### 获取所有视频
- GET `/api/videos`
- 响应：`[{ id, filename, mimeType, createdAt, hasSentences }]`

#### 获取视频详情
- GET `/api/videos/:id`
- 响应：
  ```json
  {
    "id": 1,
    "filename": "sample.mp4",
    "mimeType": "video/mp4",
    "createdAt": "2024-01-01T00:00:00Z",
    "sentences": [
      { "text": "Hello world", "start": 0.0, "end": 1.5 }
    ],
    "recordingIndices": [0, 1],
    "transcribedTexts": {
      "0": "hello world",
      "1": "goodbye"
    }
  }
  ```

#### 上传视频
- POST `/api/videos`
- Body: multipart/form-data
- 响应：
  ```json
  {
    "id": 1,
    "filename": "sample.mp4",
    "mimeType": "video/mp4",
    "reused": true,
    "message": "Reused previous analysis result"
  }
  ```

#### 获取视频文件
- GET `/api/videos/:id/file`
- 响应：视频文件流

#### 视频转写
- POST `/api/videos/:id/transcribe`
- 响应：`[{ text, start, end }]`

### 录音管理

#### 上传录音
- POST `/api/videos/:videoId/recordings/:sentenceIndex`
- Body: multipart/form-data
- 响应：204 No Content

#### 获取录音文件
- GET `/api/videos/:videoId/recordings/:sentenceIndex`
- 响应：音频文件流

#### 转写录音
- POST `/api/videos/:videoId/recordings/:sentenceIndex/transcribe`
- 响应：
  ```json
  {
    "text": "hello world",
    "cached": false
  }
  ```

---

## 用户交互流程

### 1. 首次使用流程

1. **上传视频**
   - 拖拽或点击上传
   - 等待上传完成

2. **开始分析**
   - 点击 "Start Analysis" 按钮
   - 等待 AI 转写和分句

3. **练习句子**
   - 查看分句列表
   - 点击句子播放原声
   - 听完原声后，点击录音按钮开始录音
   - 跟读句子内容
   - 点击停止录音

4. **查看对比**
   - 等待自动转写完成
   - 查看原文和转写对比
   - 识别发音差异

5. **回放录音**
   - 点击 "Play My Recording" 按钮回放
   - 对比原声和自己的发音

6. **继续练习**
   - 切换到下一句，重复练习

### 2. 重复使用流程

1. **打开视频**
   - 在 "All Videos" 列表中选择视频
   - 系统加载已有的分句和录音

2. **继续练习**
   - 直接开始练习，无需重新上传和分析
   - 已有的录音和转写结果会自动加载

### 3. 上传相同视频

1. **上传相同视频**
   - 上传之前上传过的视频
   - 系统自动检测（通过哈希）

2. **自动复用**
   - 显示 "Reused previous analysis result"
   - 直接加载分句结果
   - 节省分析时间

---

## 技术栈

### 前端
- **框架**：React 19
- **语言**：TypeScript 5.8
- **构建工具**：Vite 6.2
- **UI 框架**：Tailwind CSS 4
- **动画库**：Framer Motion (motion)
- **图标**：Lucide React
- **状态管理**：React Hooks (useState, useRef, useEffect)
- **文件上传**：react-dropzone
- **样式工具**：clsx + tailwind-merge

### 后端
- **运行时**：Node.js
- **框架**：Express 4.21
- **数据库**：better-sqlite3 12.4
- **文件上传**：Multer 2.0
- **AI 服务**：Moonshot Kimi API (Kimi K2.5)
- **环境变量**：dotenv

### 存储
- **视频文件**：`data/videos/`
- **录音文件**：`data/recordings/`
- **数据库文件**：`data/echoenglish.db`

---

## 配置说明

### 环境变量

**必需配置**：
- `KIMI_API_KEY`：Moonshot API 密钥

**可选配置**：
- `PORT`：服务器端口（默认 3001）

### API 配置

**Kimi API 配置**：
- 模型：kimi-k2.5
- 思考模式：disabled（加快响应）
- Content-Type：video_url (支持音频/视频)

### 前端配置

**API 代理**：
- 基础路径：`/api`
- Vite 代理到后端 `http://localhost:3001`

---

## 未来优化方向

### 功能增强
- [ ] 播放速度调节（0.5x, 0.75x, 1x, 1.25x, 1.5x）
- [ ] 句子收藏功能
- [ ] 练习进度跟踪
- [ ] 发音评分（基于文本相似度）
- [ ] 支持更多音频格式
- [ ] 批量导出录音

### 性能优化
- [ ] 录音压缩减小文件大小
- [ ] 前端缓存转写结果
- [ ] 虚拟滚动优化大量句子

### 用户体验
- [ ] 键盘快捷键（空格播放/暂停）
- [ ] 连续播放模式
- [ ] 练习统计面板
- [ ] 错误发音词库

---

## 版本历史

### v1.0 (当前版本)
- ✅ 视频上传与管理
- ✅ AI 转写与智能分句
- ✅ 句子播放（精确时间控制）
- ✅ 录音功能（实时动效）
- ✅ 录音转写（自动触发）
- ✅ 文本对比（单词级别）
- ✅ 视频复用（哈希检测）
- ✅ 转写缓存（避免重复调用）
- ✅ 响应式 UI 设计

---

## 附录

### 错误码

| 错误码 | 说明 |
|--------|------|
| 400 | 请求参数错误 |
| 404 | 资源不存在（视频/录音/文件） |
| 500 | 服务器内部错误 |

### 日志规范

**前端日志**：
- `Recording saved for sentence {index}`
- `Starting transcription for sentence {index}...`
- `Transcription completed for sentence {index}: {text}`
- `Transcription failed for sentence {index}: {error}`

**后端日志**：
- `Found existing video: {filename}, ID: {id}, Hash: {hash}`
- `Video already transcribed, reusing results`
- `Recording {videoId}-{sentenceIndex} already transcribed, returning cached result`
- `Transcription saved for recording {videoId}-{sentenceIndex}`
- `Successfully parsed sentences: {count}`

---

**文档版本**：v1.0
**最后更新**：2026-03-29
**维护者**：产品团队
