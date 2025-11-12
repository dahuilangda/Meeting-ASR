# Meeting ASR Backend

The backend service for the Meeting ASR (Automatic Speech Recognition) application. This is a FastAPI-based server that processes audio files, performs speaker diarization, and generates optimized meeting transcripts with additional features like summarization.

## Overview

The backend provides:
- User authentication and management
- Audio file upload and processing
- Automatic speech recognition with FunASR
- Speaker diarization using Pyannote.audio
- LLM-powered transcript optimization
- Meeting summarization
- Copilot-style chat assistance for meeting follow-up

## Features

- **Authentication**: JWT-based authentication with user registration and login
- **File Processing**: Upload audio/video files for transcription
- **ASR & Diarization**: Speech-to-text conversion with speaker identification
- **Transcript Optimization**: LLM-powered transcript enhancement
- **Post-Processing**: Meeting summarization capabilities
- **Copilot Assistant**: Conversational endpoint to answer questions about transcripts and summaries
- **Job Management**: Track processing status and results
- **Transcript Persistence**: Edited transcripts are mirrored to structured JSON/text files for rapid reloads

## Tech Stack

- **Framework**: FastAPI
- **Database**: SQLite (with SQLAlchemy ORM)
- **Authentication**: JWT tokens with OAuth2
- **ASR Engine**: FunASR (Paraformer)
- **Speaker Diarization**: Pyannote.audio
- **Audio Processing**: FFMPEG for format conversion
- **LLM Integration**: OpenAI-compatible API for transcript optimization and summarization

## Installation

1. **Clone the repository** (if you haven't already):
   ```bash
   git clone <repository-url>
   cd Meeting-ASR/backend
   ```

2. **Create a virtual environment** (recommended):
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Set up environment variables**:
   - Copy the `.env` file and customize it:
     ```bash
     cp .env.example .env
     ```
   - Edit the `.env` file with your specific configuration, including:
     - Secret keys for JWT
     - OpenAI API key and base URL
     - Hugging Face token for Pyannote models
     - Model names and other settings

5. **Install additional requirements**:
   - Install FFMPEG:
     ```bash
     # Ubuntu/Debian
     sudo apt update
     sudo apt install ffmpeg

     # macOS
     brew install ffmpeg

     # Windows (using Chocolatey)
     choco install ffmpeg
     ```

## Environment Variables

Create a `.env` file in the backend directory with the following variables:

```env
SECRET_KEY=your-super-secret-key-here
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
OPENAI_API_KEY=your-openai-api-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL_NAME=gpt-3.5-turbo
HF_TOKEN=your-huggingface-token
HF_ENDPOINT=https://hf-mirror.com
DATABASE_URL=sqlite:///./sqlite.db
# Queue concurrency controls (optional)
JOB_QUEUE_MAX_CONCURRENT=3
JOB_QUEUE_MAX_SIZE=50
JOB_QUEUE_MAX_PER_USER=2
# Optional: point the services to pre-downloaded model caches
# HF_HOME=/abs/path/to/models/huggingface
# MODELSCOPE_CACHE=/abs/path/to/models/modelscope
```

If you mirror models locally, make sure the paths you set in `.env` exist on disk before starting the server.

## Model Downloads

The backend pulls several large models from Hugging Face and ModelScope on first run. To avoid downloading them at runtime or to prepare an offline deployment, you can fetch them manually and point the backend to the local caches.

### Pyannote Speaker Diarization (Hugging Face)

1. Install the Hugging Face CLI (already available if `huggingface-hub` is installed):
   ```bash
   pip install --upgrade huggingface-hub
   ```
2. Authenticate with a token that has access to `pyannote/speaker-diarization-3.1`:
   ```bash
   hf auth login --token "$HF_TOKEN"
   # Older hubs also accept: huggingface-cli login --token "$HF_TOKEN"
   ```
3. Download the model to a local directory (example path shown):
   ```bash
   hf download pyannote/speaker-diarization-3.1 \
     --local-dir ./models/huggingface/pyannote/speaker-diarization-3.1 \
     --local-dir-use-symlinks False
   ```
4. Point the backend to the cache by adding the absolute path to `.env`:
   ```env
   HF_HOME=/abs/path/to/models/huggingface
   ```

### FunASR ASR / VAD / Punctuation (ModelScope)

1. Ensure the ModelScope CLI is available (it is installed alongside `funasr`, but you can upgrade explicitly):
   ```bash
   pip install --upgrade modelscope
   ```
2. Download the required models to a shared local cache directory:
   ```bash
   modelscope download --model iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch \
     --revision v2.0.4 --local_dir ./models/modelscope/funasr/paraformer-large

   modelscope download --model iic/speech_fsmn_vad_zh-cn-16k-common-pytorch \
     --revision v2.0.4 --local_dir ./models/modelscope/funasr/fsmn-vad

   modelscope download --model iic/punc_ct-transformer_zh-cn-common-vocab272727-pytorch \
     --revision v2.0.4 --local_dir ./models/modelscope/funasr/ct-punc
   ```
3. Expose the cache location to the backend via `.env` so `AutoModel` can reuse it:
   ```env
   MODELSCOPE_CACHE=/abs/path/to/models/modelscope
   ```

With these caches in place, the backend will reuse the local files instead of hitting the remote hubs at startup.

Override the queue settings as needed; restart the backend for changes to take effect.

## Running the Server

1. **Start the FastAPI server**:
   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8040
   ```

2. The API will be available at `http://localhost:8000`
3. The API documentation will be available at `http://localhost:8000/docs`

## API Endpoints

### Authentication
- `POST /register` - Register a new user
- `POST /token` - Login and get access token

### File Processing
- `POST /upload` - Upload audio file for processing (requires auth)
- `GET /jobs` - Get all jobs for current user (requires auth)
- `GET /jobs/{job_id}` - Get details of a specific job (requires auth)
- `DELETE /jobs/{job_id}` - Delete a job (requires auth)

### Post-Processing
- `POST /jobs/{job_id}/summarize` - Generate summary for a transcript (requires auth)
- `POST /jobs/{job_id}/optimize` - Optimize transcript using LLM (requires auth)
- `POST /jobs/{job_id}/transcript` - Persist transcript edits and timing metadata (requires auth)
- `POST /jobs/{job_id}/update_summary` - Save manual summary edits (requires auth)
- `POST /assistant/chat` - Ask the meeting copilot questions about transcripts or summaries (requires auth)

## Architecture

The backend follows a standard FastAPI structure with:
- **Main app** (`main.py`): Contains all API routes and business logic
- **Database** (`database/`): SQLAlchemy models, CRUD operations, and database connection
- **Security** (`security.py`): Authentication and authorization utilities
- **Uploads** (`uploads/`): Temporary storage for uploaded files

### Processing Pipeline

1. User uploads an audio/video file
2. File is converted to compatible format using FFMPEG
3. FunASR processes audio for speech-to-text conversion
4. Pyannote.audio performs speaker diarization
5. Results are aligned and formatted into speaker-tagged transcript
6. LLM optimizes transcript for readability and accuracy
7. Result is stored in the database and made available to the user

## Error Handling

The application handles various error conditions:
- Invalid file uploads
- Authentication failures
- Processing failures
- Missing environment variables
- Database connection issues

## Security

- JWT-based authentication for all protected endpoints
- Password hashing with Argon2
- Input validation with Pydantic schemas
- CORS middleware configured for development

## Database Models

- **User**: Stores user information (username, hashed password)
- **Job**: Tracks processing jobs (filename, status, transcript, summary, etc.)

## Deployment

For production deployment:
1. Use a production database (PostgreSQL recommended)
2. Set up a reverse proxy (nginx)
3. Use a WSGI/ASGI server (Gunicorn/Uvicorn)
4. Secure all environment variables
5. Set up proper logging
6. Implement monitoring and health checks

## Troubleshooting

Common issues and solutions:

- **FFMPEG not found**: Install FFMPEG using your system's package manager
- **GPU memory issues**: Set CUDA_VISIBLE_DEVICES to limit GPU usage
- **Model download issues**: Check HF_TOKEN and HF_ENDPOINT settings
- **Authentication errors**: Verify SECRET_KEY is properly set

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

[Add your license information here]
