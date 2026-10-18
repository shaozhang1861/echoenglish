# EchoEnglish

> Move English off the page and into situations where you can actually use it.

## Why EchoEnglish exists

You memorize the word. You recite the passage. Then a meeting begins—or someone asks an unexpected question—and the English you know does not arrive in time.

It is not that the studying was wasted. It is that real speech asks for more than recognition: you need to hear the rhythm, understand the situation, notice the speaker's intention, and retrieve the words quickly enough to respond.

Research offers a clue. Adult learners remembered words better when they encountered them in socially situated videos, with higher motivation and lower cognitive load ([Zhang et al., 2023](https://doi.org/10.1016/j.heliyon.2023.e14540)). Another study found that, among five ways of experiencing the same lecture, only video viewing made a statistically significant contribution to gains in meaning recall ([Dang, Lu, and Webb, 2023](https://doi.org/10.1093/applin/amac044)). Across 49 experiments, captions also showed a medium positive effect on incidental vocabulary learning ([Kurokawa et al., 2025](https://doi.org/10.1111/lang.12697)).

Video is not magic, and textbooks still matter. But language becomes easier to carry into life when words are connected to a voice, a moment, and something you want to say. EchoEnglish was built for that bridge: choose a real video, hear it sentence by sentence, and speak the line until it starts to feel like your own.

## What a practice session looks like

### 1. Start with a line you want to make your own

Upload an MP4, MOV, or WebM video. EchoEnglish uses Kimi to preserve the character of real speech and divide the video into timestamped practice sentences.

### 2. Stop wrestling with the timeline

Press the play button beside a sentence to hear only that section. Replay it as often as you need and pay attention to pauses, stress, rhythm, and the small spoken details that polished subtitles often omit—words such as `like`, `um`, and self-corrections.

### 3. Speak, then hear yourself clearly

Record your own version of any sentence. Starting a recording automatically pauses anything currently playing. Starting a new audio clip also stops the previous one, so two recordings never compete for your attention.

### 4. Return without starting over

Videos, sentence timings, and recordings are stored locally. Recent videos lets you reopen past practice material without uploading or transcribing it again.

## What it can do

- Upload and store MP4, MOV, and WebM videos
- Generate sentence-level English transcripts and timestamps with Kimi
- Play individual sections of the original video
- Record, save, and replay your shadowing attempts
- Transcribe your recordings for text comparison
- Reopen earlier sessions from Recent videos
- Keep audio playback mutually exclusive and pause playback when recording begins

An experimental pitch-analysis file remains in `server/pitch_analysis.py`, but it has no active backend route and is not part of the current runtime flow.

## Who it is for

- Learners who want to sound more fluent and natural in English
- People who collect useful expressions from interviews, talks, courses, or short videos
- Learners who prefer shadowing material they personally care about
- Anyone who wants video, sentence playback, and recording in one workspace

EchoEnglish is not currently an accent-scoring system, and it does not decide whether one accent is “better” than another. Its purpose is to create a lower-friction environment for imitation and self-observation.

## Local installation

### Requirements

- Node.js 22.13–25
- npm 10 or later
- A Moonshot AI Kimi API key
- A modern browser with microphone recording support

The project uses Node.js's built-in SQLite API, so Node.js 20 and earlier are not supported.

```bash
git clone https://github.com/shaozhang1861/echoenglish.git
cd echoenglish
npm ci
cp .env.example .env
```

Open `.env` and replace the placeholder with your Kimi API key:

```text
KIMI_API_KEY="your-key-here"
```

Open two terminals:

```bash
# Terminal 1: API, SQLite, video storage, and recording storage
npm run dev:server
```

```bash
# Terminal 2: frontend
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000). The first time you record, allow the browser to use your microphone.

## Checks and builds

```bash
npm run lint
npm run build
```

`npm run preview` previews only the static frontend build; it does not start the API. For normal use, run both the frontend and backend. A production deployment must proxy `/api` to the backend and provide persistent storage for `data/`.

## Where your content is stored

The application creates the following local structure:

```text
data/
├── echoenglish.db
├── videos/
└── recordings/
```

`data/`, `.env`, installed dependencies, and build output are excluded from Git. Deleting `data/` removes the local video list, transcripts, and user recordings.

## Privacy and deployment boundaries

- Videos and recordings are stored on the computer running the backend.
- Media is sent to Moonshot AI when you request transcription.
- The current version has no accounts, administrator role, or per-user data isolation.
- It is intended for personal local use or a trusted private network and should not be exposed directly to the public internet.
- A multi-user deployment still needs authentication, authorization, object storage, upload limits, rate limiting, and database migration planning.

## Troubleshooting

### The page opens, but the video list does not load

Make sure `npm run dev:server` is running and listening on `http://localhost:3001`.

### Start Analysis reports that KIMI_API_KEY is missing

Confirm that `.env` exists in the project root and contains a real key rather than the example placeholder. Restart the backend after changing it.

### Installation reports a Node.js or SQLite error

Run `node --version`. Confirm that the version is at least 22.13 and lower than 26, then run `npm ci` again.

## Project status

The current release can be cloned and run locally by developers. Public multi-user deployment still requires authentication, data isolation, production storage, and rate limiting.
