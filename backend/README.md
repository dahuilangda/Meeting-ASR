# Meeting ASR Backend

FastAPI service that powers Meeting ASR processing. It accepts user uploads, runs the FunASR + Pyannote pipeline, stores transcripts, and surfaces AI tooling for meeting follow-up.

## Responsibilities
- Authenticate users (password + Google OAuth) and guard protected endpoints
- Orchestrate ASR, diarization, and large-language-model post-processing jobs
- Persist jobs and transcript artifacts to SQLite (or another SQL backend)
- Stream job status updates to the frontend via WebSockets
- Expose an admin surface and helper scripts for operating the system

## Service Layout
- `main.py` FastAPI application, routers, and WebSocket handlers
- `job_queue.py` async worker that sequences long-running ASR jobs
- `database/` SQLAlchemy models, CRUD helpers, and session management
- `security.py` token, password, and OAuth utilities
- `uploads/` raw media, intermediate artifacts, and exported transcripts
- `create_super_admin.py` helper script for first-run bootstrap

## Stack
- FastAPI + Uvicorn
- SQLAlchemy on SQLite by default (PostgreSQL/MySQL ready)
- JWT (OAuth2 Password grant) + Argon2 password hashing
- FunASR (ModelScope) for Mandarin speech recognition
- Pyannote.audio for speaker diarization
- OpenAI-compatible LLM endpoint for transcript polishing and summaries
- FFmpeg for media normalization

## Prerequisites
- Python 3.10+
- `pip` / `venv`
- FFmpeg available on `PATH`
- Hugging Face access token for Pyannote models
- (Optional) ModelScope CLI cache directory for offline FunASR models

## Quick Start
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Create a `.env` file (see template below) before starting the server.

## Environment Configuration
Create `backend/.env` with the variables you need. Values marked as optional can be omitted.

```env
# Security & tokens
SECRET_KEY=replace-with-a-long-random-string
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60

# Database (SQLite local file by default)
DATABASE_URL=sqlite:///./sqlite.db

# OpenAI-compatible LLM endpoint
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL_NAME=gpt-4o-mini

# Hugging Face / ModelScope assets
HF_TOKEN=hf_...
HF_ENDPOINT=https://hf-mirror.com
HF_HOME=/abs/path/to/models/huggingface          # optional, enables local cache reuse
MODELSCOPE_CACHE=/abs/path/to/models/modelscope  # optional

# Frontend integration
CORS_ORIGINS=http://localhost:3030

# Google OAuth (optional)
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_IDS=comma,separated,extra,ids

# Background job tuning (optional defaults shown)
JOB_QUEUE_MAX_CONCURRENT=3
JOB_QUEUE_MAX_PER_USER=2
JOB_QUEUE_MAX_SIZE=50
```

Restart the server whenever `.env` changes so new settings are loaded.

## Running Locally
- `./start_backend.sh` (auto-installs deps and runs Uvicorn on port 8000)
- or run manually:
  ```bash
  uvicorn main:app --reload --host 0.0.0.0 --port 8000
  ```
- Interactive docs: `http://localhost:8000/docs`

## Processing Pipeline
1. Upload media via `POST /upload`
2. Normalize audio with FFmpeg and enqueue a job
3. FunASR performs Mandarin ASR while Pyannote.audio diarizes speakers
4. Transcript segments merge into timing-aligned JSON
5. Optional LLM pass polishes the transcript and drafts summaries
6. Results persist to the database and mirrored text/JSON files under `uploads/transcripts`
7. WebSocket pushes progress updates back to each authenticated user

## Operating the Service
- **Create an admin**: `python create_super_admin.py` (prompts for credentials)
- **Job queue**: defaults to in-process workers; adjust queue limits in `.env`
- **Uploads directory**: ensure disk space and periodic cleanup of stale items
- **Database upgrades**: automatic index/column checks run on startup; migrate to a managed SQL instance for production
- **Logging**: standard Python logging; override `logging.basicConfig` for structured output

## Model Assets
Download heavy models ahead of time for air-gapped or deterministic deployments.

### Pyannote (Hugging Face)
```bash
pip install --upgrade huggingface-hub
hf auth login --token "$HF_TOKEN"
hf download pyannote/speaker-diarization-3.1 \
  --local-dir ./models/huggingface/pyannote/speaker-diarization-3.1 \
  --local-dir-use-symlinks False
```
Set `HF_HOME` to the absolute parent directory so the runtime can reuse it.

### FunASR / ModelScope
```bash
pip install --upgrade modelscope
modelscope download --model iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch \
  --revision v2.0.4 --local_dir ./models/modelscope/funasr/paraformer-large
modelscope download --model iic/speech_fsmn_vad_zh-cn-16k-common-pytorch \
  --revision v2.0.4 --local_dir ./models/modelscope/funasr/fsmn-vad
modelscope download --model iic/punc_ct-transformer_zh-cn-common-vocab272727-pytorch \
  --revision v2.0.4 --local_dir ./models/modelscope/funasr/ct-punc
```
Expose the containing directory via `MODELSCOPE_CACHE`.

## Deployment Notes
- Prefer Gunicorn with Uvicorn workers behind nginx or another reverse proxy
- Swap SQLite for PostgreSQL/MySQL via `DATABASE_URL`
- Configure HTTPS and secure cookie/storage policies
- Set `CORS_ORIGINS` to trusted frontend origins only
- Enable monitoring/alerts on queue latency and ASR failure rates

## Troubleshooting
- **Model downloads hang**: make sure `HF_TOKEN` is valid and mirrors are reachable
- **401 responses**: check `SECRET_KEY`, token expiry, and clock skew
- **CORS errors**: update `CORS_ORIGINS` to include your frontend domain
- **Queue saturation**: increase `JOB_QUEUE_MAX_CONCURRENT` or scale horizontally
- **FFmpeg missing**: install via `apt install ffmpeg`, `brew install ffmpeg`, or Windows package manager

## Contributing
- Fork the repo and create a feature branch
- Add/adjust tests where applicable
- Run formatting and linting tools before opening a pull request
- Document any new environment variables or endpoints

## License
See the project root `LICENSE` file for licensing details.
