# Meeting ASR Backend

The backend service for the Meeting ASR (Automatic Speech Recognition) application. This is a FastAPI-based server that processes audio files, performs speaker diarization, and generates optimized meeting transcripts with additional features like summarization and translation.

## Overview

The backend provides:
- User authentication and management
- Audio file upload and processing
- Automatic speech recognition with Whisper
- Speaker diarization using Pyannote.audio
- LLM-powered transcript optimization
- Meeting summarization
- Transcript translation

## Features

- **Authentication**: JWT-based authentication with user registration and login
- **File Processing**: Upload audio/video files for transcription
- **ASR & Diarization**: Speech-to-text conversion with speaker identification
- **Transcript Optimization**: LLM-powered transcript enhancement
- **Post-Processing**: Meeting summarization and translation capabilities
- **Job Management**: Track processing status and results

## Tech Stack

- **Framework**: FastAPI
- **Database**: SQLite (with SQLAlchemy ORM)
- **Authentication**: JWT tokens with OAuth2
- **ASR Engine**: OpenAI Whisper
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
```

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
- `POST /jobs/{job_id}/translate` - Translate transcript to target language (requires auth)
- `POST /jobs/{job_id}/optimize` - Optimize transcript using LLM (requires auth)

## Architecture

The backend follows a standard FastAPI structure with:
- **Main app** (`main.py`): Contains all API routes and business logic
- **Database** (`database/`): SQLAlchemy models, CRUD operations, and database connection
- **Security** (`security.py`): Authentication and authorization utilities
- **Uploads** (`uploads/`): Temporary storage for uploaded files

### Processing Pipeline

1. User uploads an audio/video file
2. File is converted to compatible format using FFMPEG
3. Whisper processes audio for speech-to-text conversion
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