from __future__ import annotations
from datetime import datetime, timedelta

from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    File,
    Header,
    HTTPException,
    Query,
    Response,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.responses import StreamingResponse, FileResponse
from sqlalchemy.orm import Session
from typing import List, Dict, Optional, Union
from contextlib import asynccontextmanager
from pydantic import ConfigDict
import shutil
import os
import json
import re
import asyncio
import logging
import threading
import mimetypes
from pathlib import Path
import secrets
from jose import JWTError, jwt
from dotenv import load_dotenv
from fastapi.staticfiles import StaticFiles
from urllib.parse import quote

from database import crud, models, schemas
from database.database import SessionLocal, engine
import security
from job_queue import job_queue_manager

# Configure logging
logging.basicConfig(level=logging.INFO)

# Suppress warnings from third-party libraries
import warnings
warnings.filterwarnings("ignore", category=SyntaxWarning, module='pyannote.*')
warnings.filterwarnings("ignore", category=UserWarning, module='pydantic._internal.*')
warnings.filterwarnings("ignore", category=UserWarning, message='.*Valid config keys have changed in V2.*')
warnings.filterwarnings("ignore", category=DeprecationWarning, module='pydantic.*')
warnings.filterwarnings("ignore", message='.*allow_population_by_field_name.*')

logger = logging.getLogger(__name__)

# Load environment variables from .env file FIRST
load_dotenv()

# Suppress deprecation warnings globally
import os
os.environ["PYTHONWARNINGS"] = "ignore::UserWarning:pyannote.*,ignore::SyntaxWarning:pyannote.*,ignore::UserWarning:pydantic.*,ignore::DeprecationWarning:pydantic.*"

# HF_ENDPOINT
if not os.getenv("HF_ENDPOINT"):
    os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"

# --- App and DB Setup ---
models.Base.metadata.create_all(bind=engine)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle events"""
    # Startup
    job_queue_manager.set_websocket_manager(manager)
    await job_queue_manager.start()
    logger.info("Meeting ASR Multi-User System started successfully")

    yield

    # Shutdown
    await job_queue_manager.stop()
    logger.info("Meeting ASR Multi-User System shut down")

app = FastAPI(title="Meeting ASR Multi-User System", version="2.0.0", lifespan=lifespan)

# WebSocket connection manager for real-time updates
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[int, List[WebSocket]] = {}  # user_id -> list of connections

    async def connect(self, websocket: WebSocket, user_id: int):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)
        logger.info(f"User {user_id} connected via WebSocket")

    def disconnect(self, websocket: WebSocket, user_id: int):
        if user_id in self.active_connections:
            self.active_connections[user_id].remove(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
        logger.info(f"User {user_id} disconnected from WebSocket")

    async def send_personal_message(self, message: dict, user_id: int):
        if user_id in self.active_connections:
            disconnected = []
            for connection in self.active_connections[user_id]:
                try:
                    await connection.send_json(message)
                except:
                    disconnected.append(connection)
            # Remove dead connections
            for conn in disconnected:
                self.active_connections[user_id].remove(conn)

manager = ConnectionManager()

# Add CORS middleware
from fastapi.middleware.cors import CORSMiddleware

cors_origins_env = os.getenv("CORS_ORIGINS", "")
allowed_origins = [origin.strip() for origin in cors_origins_env.split(",") if origin.strip()]

if not allowed_origins:
    allowed_origins = ["http://localhost:3030"]
    logger.warning("CORS_ORIGINS not set; defaulting to http://localhost:3030")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount the uploads directory to serve audio files
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

TRANSCRIPT_STORAGE_DIR = Path("uploads/transcripts")

def build_download_filename(original_filename: Optional[str], default_stem: str, suffix: str) -> str:
    """Create a human-readable download filename using the original stem when possible."""
    stem = (Path(original_filename).stem if original_filename else "") or default_stem
    return f"{stem}{suffix}"

def build_content_disposition(filename: str) -> str:
    """Generate a Content-Disposition header that gracefully handles unicode filenames."""
    ascii_filename = re.sub(r'[^A-Za-z0-9._-]', '_', filename) or filename
    disposition = f'attachment; filename="{ascii_filename}"'
    if ascii_filename != filename:
        disposition += f"; filename*=UTF-8''{quote(filename)}"
    return disposition

def persist_transcript_to_disk(job_id: int, transcript_text: str, segments: List[dict]) -> None:
    """Persist transcript text and structured segments to disk for realtime access."""
    TRANSCRIPT_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    text_path = TRANSCRIPT_STORAGE_DIR / f"job_{job_id}.txt"
    segments_path = TRANSCRIPT_STORAGE_DIR / f"job_{job_id}.json"
    text_path.write_text(transcript_text, encoding="utf-8")
    segments_path.write_text(json.dumps(segments, ensure_ascii=False, indent=2), encoding="utf-8")

def hydrate_job_transcript_from_disk(job: models.Job) -> None:
    """If transcript artifacts exist on disk, hydrate the job instance before returning."""
    text_path = TRANSCRIPT_STORAGE_DIR / f"job_{job.id}.txt"
    segments_path = TRANSCRIPT_STORAGE_DIR / f"job_{job.id}.json"
    if text_path.exists():
        job.transcript = text_path.read_text(encoding="utf-8")
    if segments_path.exists():
        job.timing_info = segments_path.read_text(encoding="utf-8")


def build_job_share_response(share: models.JobShare) -> schemas.JobShareResponse:
    return schemas.JobShareResponse(
        id=share.id,
        job_id=share.job_id,
        share_token=share.share_token,
        created_at=share.created_at,
        expires_at=share.expires_at,
        last_accessed_at=share.last_accessed_at,
        access_count=share.access_count or 0,
        allow_audio_download=share.allow_audio_download,
        allow_transcript_download=share.allow_transcript_download,
        allow_summary_download=share.allow_summary_download,
        is_active=share.is_active,
        requires_access_code=bool(share.access_code_hash),
    )


def resolve_share_code(header_code: Optional[str], query_code: Optional[str]) -> Optional[str]:
    code = (header_code or query_code or "").strip()
    return code or None


def ensure_share_access(share: models.JobShare, provided_code: Optional[str]) -> None:
    if not share.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found")

    if share.expires_at and share.expires_at <= datetime.utcnow():
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Share link expired")

    if share.access_code_hash:
        if not provided_code:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Share code required")
        if not crud.verify_password(provided_code, share.access_code_hash):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid share code")

def get_db():
    db = SessionLocal()
    try: yield db
    finally: db.close()

# --- Auth & User Management ---
async def get_current_user(token: str = Depends(security.oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Could not validate credentials")
    try:
        payload = jwt.decode(token, security.SECRET_KEY, algorithms=[security.ALGORITHM])
        username: str = payload.get("sub")
        if username is None: raise credentials_exception
        token_data = schemas.TokenData(username=username)
    except JWTError:
        raise credentials_exception
    user = crud.get_user_by_username(db, username=token_data.username)
    if user is None: raise credentials_exception
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User account is deactivated")
    return user

async def get_current_active_user(current_user: schemas.User = Depends(get_current_user)):
    if not current_user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user

async def get_admin_user(current_user: schemas.User = Depends(get_current_active_user)):
    if current_user.role not in [models.UserRole.ADMIN, models.UserRole.SUPER_ADMIN]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")
    return current_user

async def get_super_admin_user(current_user: schemas.User = Depends(get_current_active_user)):
    if current_user.role != models.UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin access required")
    return current_user

@app.post("/register", response_model=schemas.User)
def register_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = crud.get_user_by_username(db, username=user.username)
    if db_user: raise HTTPException(status_code=400, detail="Username already registered")

    if user.email:
        db_email = crud.get_user_by_email(db, email=user.email)
        if db_email: raise HTTPException(status_code=400, detail="Email already registered")

    return crud.create_user(db=db, user=user)

@app.post("/token", response_model=schemas.Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = crud.get_user_by_username(db, username=form_data.username)
    if not user or not crud.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect username or password")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is deactivated")

    # Update last login time
    crud.update_last_login(db, user.id)

    access_token_expires = timedelta(minutes=security.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = security.create_access_token(
        data={"sub": user.username, "role": user.role.value},
        expires_delta=access_token_expires,
    )
    return {"access_token": access_token, "token_type": "bearer"}

# --- File Processing Workflow ---
import torch
from pyannote.audio import Pipeline
import pandas as pd
import subprocess
import tempfile
import librosa

def ensure_audio_format(filepath: str) -> str:
    """
    Ensures the audio file is in a compatible format for processing.
    If necessary, converts the file to WAV format using ffmpeg.
    Returns the path to the converted file, or the original if no conversion was needed.
    """
    # Get the file extension
    _, ext = os.path.splitext(filepath)
    ext = ext.lower()
    
    # If it's already in a common format, we may still want to convert for consistency,
    # but if it's an exotic format, definitely convert it.
    # For simplicity, we'll use ffmpeg to handle any format and convert to WAV for processing.
    # This ensures compatibility with all input formats.
    
    if ext in ['.wav', '.mp3', '.flac', '.m4a', '.aac', '.mp4', '.mov', '.avi', '.mkv', '.m4v']:
        # Create a temporary file for the converted audio
        temp_fd, temp_path = tempfile.mkstemp(suffix='.wav')
        os.close(temp_fd)
        
        try:
            # Convert to WAV using ffmpeg
            result = subprocess.run([
                'ffmpeg', '-i', filepath, 
                '-ar', '16000',  # Set sample rate to 16kHz
                '-ac', '1',      # Set to mono
                '-c:a', 'pcm_s16le',  # Use PCM codec
                temp_path,
                '-y'  # Overwrite output file if it exists
            ], check=True, capture_output=True)
            
            # Return the path to the converted file
            return temp_path
        except subprocess.CalledProcessError as e:
            logger.error(f"Error converting audio file: {e}")
            # If conversion fails, try to proceed with original file
            return filepath
    else:
        # For already compatible format, return as-is
        return filepath

def process_audio_file(job_id: int, filepath: str, db_session_class):
    db = db_session_class()
    converted_file = None  # Track converted file for cleanup
    
    try:
        logger.info(f"[Job {job_id}] Starting transcription & diarization for {filepath}")
        hf_token = os.getenv("HF_TOKEN")
        if not hf_token: raise ValueError("HF_TOKEN not set in .env file")

        # Ensure the audio file is in a compatible format
        converted_file = ensure_audio_format(filepath)
        logger.info(f"[Job {job_id}] Using converted file: {converted_file}")
        
        device = "cuda" if torch.cuda.is_available() else "cpu"
        
        diarization_pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", token=hf_token)
        diarization_pipeline.to(torch.device(device))
        
        logger.info(f"[Job {job_id}] Using device: {device}")
        
        # Run diarization first to identify speakers
        logger.info(f"[Job {job_id}] Running Pyannote diarization...")
        diarization = diarization_pipeline(converted_file)

        
        # Get speaker timestamps - using new pyannote API
        speaker_segments = []
        try:
            # Try the new API first
            if hasattr(diarization, 'speaker_diarization'):
                for turn, speaker in diarization.speaker_diarization:
                    speaker_segments.append([turn.start, turn.end, speaker])
            else:
                # Fallback to older API if available
                for turn, track, speaker in diarization.itertracks(yield_label=True):
                    speaker_segments.append([turn.start, turn.end, speaker])
        except AttributeError as e:
            logger.warning(f"[Job {job_id}] Error extracting speaker segments: {e}")
            # Create a fallback segment if extraction fails
            speaker_segments = [[0.0, 10.0, "SPEAKER_00"]]

        speaker_df = pd.DataFrame(speaker_segments, columns=['start', 'end', 'speaker'])
        
        logger.info(f"[Job {job_id}] Found {len(speaker_segments)} speaker segments: {set([s[2] for s in speaker_segments])}")
        
        # Load the audio file to get its duration for alignment and segment processing
        audio_data, sample_rate = librosa.load(converted_file)
        audio_duration = librosa.get_duration(y=audio_data, sr=sample_rate)
        
        # Initialize the FunASR model once for the entire process
        from funasr import AutoModel
        logger.info(f"[Job {job_id}] Using FunASR for Chinese ASR with punctuation...")
        
        try:
            asr_model = AutoModel(
                model="iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
                model_revision="v2.0.4",
                vad_model="fsmn-vad",
                vad_model_revision="v2.0.4",
                punc_model="ct-punc",  # 标点符号模型
                punc_model_revision="v2.0.4",
                disable_update=True
            )
        except RuntimeError as e:
            if "Sizes of tensors must match" in str(e):
                logger.warning(f"[Job {job_id}] Primary model failed with tensor size error, trying fallback model...")
                asr_model = AutoModel(
                    model="damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
                    model_revision="v2.0.4",
                    punc_model="ct-punc",
                    punc_model_revision="v2.0.4",
                )
            elif "shape" in str(e).lower() or "dimension" in str(e).lower():
                logger.warning(f"[Job {job_id}] Model failed with shape error, trying simpler configuration...")
                asr_model = AutoModel(
                    model="damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
                    punc_model="ct-punc",
                )
            else:
                raise e
        
        # Process each speaker segment individually to ensure alignment
        logger.info(f"[Job {job_id}] Processing {len(speaker_segments)} speaker segments for alignment...")
        
        # Create temporary files for each segment and transcribe individually
        import tempfile
        import soundfile as sf
        
        result_segments = []
        total_coverage = 0
        
        for i, (start_time, end_time, speaker_label) in enumerate(speaker_segments):
            segment_duration = end_time - start_time
            total_coverage += segment_duration
            
                        
            # Extract the audio segment
            segment_start_sample = int(start_time * sample_rate)
            segment_end_sample = int(end_time * sample_rate)
            
            # Ensure we don't go out of bounds
            segment_end_sample = min(segment_end_sample, len(audio_data))
            segment_audio = audio_data[segment_start_sample:segment_end_sample]
            
            # Skip very short segments (less than 0.1 seconds) to avoid processing errors
            if len(segment_audio) < sample_rate * 0.1:  # Less than 0.1 seconds
                continue
            
            # Save the segment temporarily for FunASR processing
            temp_segment_file = None
            try:
                temp_fd, temp_segment_file = tempfile.mkstemp(suffix='.wav')
                os.close(temp_fd)
                
                # Save the segment to the temporary file
                sf.write(temp_segment_file, segment_audio, sample_rate)
                
                # Transcribe just this segment with the model
                segment_res = asr_model.generate(
                    input=temp_segment_file,
                    hotword="",
                    return_raw_dict=True,
                    output_dir=None,
                    batch_size=1,
                    mode="2pass",
                )
                
                # Extract the transcription result for this segment
                segment_text = ""
                segment_timestamps = []
                
                # Handle different result formats
                if isinstance(segment_res, list):
                    for item in segment_res:
                        if 'text' in item:
                            segment_text += item['text'] + " "
                        elif 'nbest' in item:  # Some models return results in 'nbest' field
                            if isinstance(item['nbest'], list) and len(item['nbest']) > 0:
                                segment_text += item['nbest'][0]['sentence'] + " "
                                # Also check for timestamps in nbest results
                                if 'timestamp' in item['nbest'][0]:
                                    segment_timestamps.extend(item['nbest'][0]['timestamp'])
                        elif 'sentence' in item:  # Some models return results in 'sentence' field
                            segment_text += item['sentence'] + " "
                        # Check for word-level timestamp information
                        if 'timestamp' in item:
                            segment_timestamps.extend(item['timestamp'])
                        # Check if result has word information with timestamps
                        if 'wnd' in item:  # Word-level timing information
                            segment_timestamps.extend(item['wnd'])
                else:
                    if 'text' in segment_res:
                        segment_text = segment_res['text']
                    elif 'nbest' in segment_res:  # Some models return results in 'nbest' field
                        if isinstance(segment_res['nbest'], list) and len(segment_res['nbest']) > 0:
                            segment_text = segment_res['nbest'][0]['sentence']
                            # Check for timestamps in nbest results
                            if 'timestamp' in segment_res['nbest'][0]:
                                segment_timestamps = segment_res['nbest'][0]['timestamp']
                    elif 'sentence' in segment_res:  # Some models return results in 'sentence' field
                        segment_text = segment_res['sentence']
                    # Check for word-level timestamp information
                    if 'timestamp' in segment_res:
                        segment_timestamps = segment_res['timestamp']
                    # Check for word-level information
                    if 'wnd' in segment_res:  # Word-level timing information
                        segment_timestamps = segment_res['wnd']
                
                # Clean up the segment text
                segment_text = segment_text.strip()
                
                # Adjust the timestamps to be relative to the original audio file
                adjusted_timestamps = []
                for ts in segment_timestamps:
                    if 'start' in ts and 'end' in ts and 'text' in ts:
                        adjusted_start = ts['start'] + start_time  # Adjust start time relative to original audio
                        adjusted_end = ts['end'] + start_time     # Adjust end time relative to original audio
                        adjusted_timestamps.append({
                            'start': adjusted_start,
                            'end': adjusted_end,
                            'text': ts['text']
                        })
                
                # Add the segment result to our collection
                if segment_text:
                    result_segments.append({
                        'text': segment_text,
                        'speaker': speaker_label,
                        'start_time': start_time,
                        'end_time': end_time,
                        'word_level_info': adjusted_timestamps
                    })
                else:
                    logger.info(f"[Job {job_id}] No text extracted for segment {i+1}, speaker {speaker_label}")
                
            except Exception as e:
                logger.error(f"[Job {job_id}] Error processing speaker segment {i+1}: {e}")
                # Add an empty segment if there was an error
                result_segments.append({
                    'text': f"[No speech detected for {speaker_label}]",
                    'speaker': speaker_label,
                    'start_time': start_time,
                    'end_time': end_time,
                    'word_level_info': []
                })
            finally:
                # Clean up the temporary file
                if temp_segment_file and os.path.exists(temp_segment_file):
                    os.remove(temp_segment_file)
        
        # Calculate coverage statistics
        coverage_percentage = (total_coverage / audio_duration) * 100 if audio_duration > 0 else 0
        logger.info(f"[Job {job_id}] Total speaker coverage: {total_coverage:.2f}s out of {audio_duration:.2f}s ({coverage_percentage:.1f}%)")
        
        # If no segments were processed successfully, create a fallback
        if not result_segments:
            logger.warning(f"[Job {job_id}] No valid segments processed, running full audio transcription as fallback...")
            # Fallback to the original approach if no segments were processed
            res = asr_model.generate(
                input=converted_file,
                hotword="",
                return_raw_dict=True,
                output_dir=None,
                batch_size=1,
                mode="2pass",
            )
            
            # Extract the transcription result with punctuation
            word_level_info = []  # To store word-level timing if available
            
            # Handle different result formats from primary and fallback models
            if isinstance(res, list):
                for item in res:
                    if 'text' in item:
                        full_transcript += item['text'] + " "
                    elif 'nbest' in item:  # Some models return results in 'nbest' field
                        if isinstance(item['nbest'], list) and len(item['nbest']) > 0:
                            full_transcript += item['nbest'][0]['sentence'] + " "
                            # Also check for timestamps in nbest results
                            if 'timestamp' in item['nbest'][0]:
                                word_level_info.extend(item['nbest'][0]['timestamp'])
                    elif 'sentence' in item:  # Some models return results in 'sentence' field
                        full_transcript += item['sentence'] + " "
                    # Check for word-level timestamp information
                    if 'timestamp' in item:
                        word_level_info.extend(item['timestamp'])
                    # Check if result has word information with timestamps
                    if 'wnd' in item:  # Word-level timing information
                        word_level_info.extend(item['wnd'])
            else:
                if 'text' in res:
                    full_transcript = res['text']
                elif 'nbest' in res:  # Some models return results in 'nbest' field
                    if isinstance(res['nbest'], list) and len(res['nbest']) > 0:
                        full_transcript = res['nbest'][0]['sentence']
                        # Check for timestamps in nbest results
                        if 'timestamp' in res['nbest'][0]:
                            word_level_info = res['nbest'][0]['timestamp']
                    elif 'sentence' in res:  # Some models return results in 'sentence' field
                        full_transcript = res['sentence']
                    # Check for word-level timestamp information
                    if 'timestamp' in res:
                        word_level_info = res['timestamp']
                    # Check for word-level information
                    if 'wnd' in res:  # Word-level timing information
                        word_level_info = res['wnd']
            
            # Create a result with UNKNOWN speaker to avoid errors
            if full_transcript.strip():
                result_segments.append({
                    'text': full_transcript.strip(),
                    'speaker': "UNKNOWN",
                    'start_time': 0,
                    'end_time': audio_duration,
                    'word_level_info': []
                })

        # Format the transcript with speakers and punctuation
        formatted_transcript = "\n".join([f"[{seg['speaker']}] {seg['text']}" for seg in result_segments])
        
        # Prepare timing information as JSON
        import json
        sentences_with_timing = []
        for idx, seg in enumerate(result_segments):
            sentences_with_timing.append({
                'speaker': seg['speaker'],
                'text': seg['text'],
                'start_time': float(seg.get('start_time', 0) or 0),
                'end_time': float(seg.get('end_time', 0) or 0),
                'do_not_merge_with_previous': bool(seg.get('do_not_merge_with_previous', False)),
                'line_number': idx,
                'segment_id': seg.get('id'),
            })
        
        timing_info_json = json.dumps(sentences_with_timing)

        # Store the transcript with native punctuation
        crud.update_job_transcript(db, job_id=job_id, transcript=formatted_transcript, timing_info=timing_info_json)
        persist_transcript_to_disk(job_id, formatted_transcript, sentences_with_timing)
        logger.info(f"[Job {job_id}] Processing completed with speakers: {set([seg['speaker'] for seg in result_segments])}")
        logger.info(f"[Job {job_id}] Result segments: {len(result_segments)}")

    except Exception as e:
        logger.error(f"[Job {job_id}] Processing failed: {e}")
        crud.update_job_status(db, job_id=job_id, status="failed")
    finally:
        db.close()
        # NOTE: We're keeping the original file for playback in the UI
        # Clean up converted file if it was created (temporary conversion file)
        if converted_file and os.path.exists(converted_file) and converted_file != filepath: 
            os.remove(converted_file)

# Register the audio processing handler with the job queue so queued tasks use FunASR.
job_queue_manager.set_processing_handler(
    lambda job_id, file_path, session_factory: process_audio_file(job_id, file_path, session_factory)
)

@app.post("/upload", response_model=schemas.Job)
async def upload_file(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Upload file and add it to the processing queue"""
    upload_dir = "uploads"
    os.makedirs(upload_dir, exist_ok=True)

    # Check file size (limit to 200MB)
    file.file.seek(0, 2)  # Seek to end
    file_size = file.file.tell()
    file.file.seek(0)  # Reset position

    if file_size > 200 * 1024 * 1024:  # 200MB
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File too large. Maximum size is 200MB."
        )

    # Check user's active job count
    active_jobs_count = crud.get_user_active_jobs_count(db, current_user.id)
    if active_jobs_count >= 2:  # Max 2 concurrent jobs per user
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many concurrent jobs. Please wait for current jobs to complete."
        )

    # Handle potential filename conflicts by adding a counter if file exists
    original_filename = file.filename
    filename = original_filename
    counter = 1

    filepath = os.path.join(upload_dir, filename)
    while os.path.exists(filepath):
        name, ext = os.path.splitext(original_filename)
        filename = f"{name}_{counter}{ext}"
        filepath = os.path.join(upload_dir, filename)
        counter += 1

    # Save file
    with open(filepath, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # Create job in database
    job = crud.create_job(
        db=db,
        filename=filename,
        owner_id=current_user.id,
        file_path=filepath,
        file_size=file_size
    )

    # Add job to queue
    success = await job_queue_manager.add_job(
        job_id=job.id,
        user_id=current_user.id,
        file_path=filepath,
        filename=filename
    )

    if not success:
        # If queue is full, delete the job and file
        crud.delete_job(db, job.id)
        os.remove(filepath)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Job queue is full. Please try again later."
        )

    # Notify user via WebSocket
    await manager.send_personal_message({
        "type": "job_uploaded",
        "job_id": job.id,
        "filename": filename,
        "status": job.status.value,
        "message": f"File '{filename}' uploaded successfully and added to processing queue"
    }, current_user.id)

    return job

@app.get("/jobs", response_model=List[schemas.Job])
def get_user_jobs(current_user: schemas.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get all jobs for the current user"""
    jobs = crud.get_jobs_by_owner(db, owner_id=current_user.id)
    # Load transcript from disk if available
    for job in jobs:
        hydrate_job_transcript_from_disk(job)
    return jobs

@app.get("/queue/status", response_model=schemas.QueueStatus)
async def get_queue_status(current_user: schemas.User = Depends(get_current_user)):
    """Get queue status for current user"""
    status = await job_queue_manager.get_queue_status(current_user.id)
    return schemas.QueueStatus(**status)

@app.post("/jobs/{job_id}/cancel")
async def cancel_job(
    job_id: int,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Cancel a job if it hasn't started processing"""
    job = crud.get_job(db, job_id=job_id, owner_id=current_user.id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status not in [models.JobStatus.QUEUED]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Can only cancel jobs that are queued"
        )

    success = await job_queue_manager.cancel_job(job_id, current_user.id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot cancel job - it may have already started processing"
        )

    await manager.send_personal_message({
        "type": "job_cancelled",
        "job_id": job_id,
        "message": f"Job '{job.filename}' has been cancelled"
    }, current_user.id)

    return {"message": "Job cancelled successfully"}

@app.websocket("/ws/{token}")
async def websocket_endpoint(websocket: WebSocket, token: str):
    """WebSocket endpoint for real-time job status updates"""
    try:
        # Verify token and get user
        payload = jwt.decode(token, security.SECRET_KEY, algorithms=[security.ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            await websocket.close(code=4001)
            return

        db = SessionLocal()
        user = crud.get_user_by_username(db, username=username)
        if not user or not user.is_active:
            await websocket.close(code=4001)
            return
        db.close()

        # Connect WebSocket
        await manager.connect(websocket, user.id)

        try:
            while True:
                # Keep connection alive and listen for client messages
                data = await websocket.receive_text()
                # Handle any client messages if needed (e.g., ping/pong)
        except WebSocketDisconnect:
            pass
        finally:
            manager.disconnect(websocket, user.id)

    except JWTError:
        await websocket.close(code=4001)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        await websocket.close(code=4000)

@app.get("/jobs/{job_id}", response_model=schemas.Job)
def get_job_details(job_id: int, current_user: schemas.User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = crud.get_job(db, job_id=job_id, owner_id=current_user.id)
    if not job: raise HTTPException(status_code=404, detail="Job not found")
    hydrate_job_transcript_from_disk(job)
    return job

@app.delete("/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_job(job_id: int, current_user: schemas.User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = crud.get_job(db, job_id=job_id, owner_id=current_user.id)
    if not job: raise HTTPException(status_code=404, detail="Job not found")
    crud.delete_job(db, job_id=job_id)
    return

# Endpoint to get audio file for a job (redirects to static file)
@app.get("/jobs/{job_id}/audio")
def get_job_audio(job_id: int, current_user: schemas.User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = crud.get_job(db, job_id=job_id, owner_id=current_user.id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    audio_path = None
    if job.file_path and os.path.exists(job.file_path):
        audio_path = job.file_path
    else:
        upload_dir = "uploads"
        candidate_path = os.path.join(upload_dir, job.filename)
        if os.path.exists(candidate_path):
            audio_path = candidate_path

    if not audio_path:
        raise HTTPException(status_code=404, detail="Audio file not found")

    media_type, _ = mimetypes.guess_type(audio_path)
    return FileResponse(
        audio_path,
        media_type=media_type or "application/octet-stream",
        filename=os.path.basename(audio_path)
    )

@app.get("/jobs/{job_id}/transcript/download")
def download_job_transcript(job_id: int, current_user: schemas.User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = crud.get_job(db, job_id=job_id, owner_id=current_user.id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    hydrate_job_transcript_from_disk(job)

    transcript_path = TRANSCRIPT_STORAGE_DIR / f"job_{job.id}.txt"
    transcript_text: Optional[str] = None

    if transcript_path.exists():
        transcript_text = transcript_path.read_text(encoding="utf-8")
    elif job.transcript:
        transcript_text = job.transcript

    if not transcript_text or not transcript_text.strip():
        raise HTTPException(status_code=404, detail="Transcript not available")

    filename = build_download_filename(job.filename, f"job-{job.id}", "_transcript.txt")
    headers = {"Content-Disposition": build_content_disposition(filename)}
    content = transcript_text if transcript_text.endswith("\n") else f"{transcript_text}\n"

    return StreamingResponse(
        iter([content]),
        media_type="text/plain; charset=utf-8",
        headers=headers
    )

@app.get("/jobs/{job_id}/summary/download")
def download_job_summary(job_id: int, current_user: schemas.User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = crud.get_job(db, job_id=job_id, owner_id=current_user.id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    summary_text = job.summary or ""
    if not summary_text.strip():
        raise HTTPException(status_code=404, detail="Summary not available")

    parsed_summary: Optional[Union[dict, str]] = None
    try:
        parsed_summary = json.loads(summary_text)
    except json.JSONDecodeError:
        parsed_summary = None

    if isinstance(parsed_summary, dict):
        formatted_content = parsed_summary.get("formatted_content")
        structured_data = parsed_summary.get("structured_data")
        if isinstance(formatted_content, str) and formatted_content.strip():
            summary_text = formatted_content
        elif structured_data:
            summary_text = format_summary_as_markdown_with_refs(structured_data, [])
    elif isinstance(parsed_summary, str) and parsed_summary.strip():
        summary_text = parsed_summary

    if not summary_text.strip():
        raise HTTPException(status_code=404, detail="Summary not available")

    filename = build_download_filename(job.filename, f"job-{job.id}", "_summary.md")
    headers = {"Content-Disposition": build_content_disposition(filename)}
    content = summary_text if summary_text.endswith("\n") else f"{summary_text}\n"

    return StreamingResponse(
        iter([content]),
        media_type="text/markdown; charset=utf-8",
        headers=headers
    )


@app.post("/jobs/{job_id}/shares", response_model=schemas.JobShareResponse)
def create_job_share(
    job_id: int,
    request: schemas.JobShareCreateRequest,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    job = crud.get_job(db, job_id=job_id, owner_id=current_user.id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    expires_at: Optional[datetime] = None

    if request.expires_at and request.expires_in_days:
        raise HTTPException(status_code=400, detail="Specify either expires_at or expires_in_days, not both")

    if request.expires_at:
        if request.expires_at <= datetime.utcnow():
            raise HTTPException(status_code=400, detail="Expiration time must be in the future")
        expires_at = request.expires_at
    elif request.expires_in_days is not None:
        if request.expires_in_days <= 0:
            raise HTTPException(status_code=400, detail="expires_in_days must be greater than zero")
        if request.expires_in_days > 365:
            raise HTTPException(status_code=400, detail="Maximum share duration is 365 days")
        expires_at = datetime.utcnow() + timedelta(days=request.expires_in_days)

    access_code_hash: Optional[str] = None
    if request.access_code:
        access_code = request.access_code.strip()
        if len(access_code) < 4:
            raise HTTPException(status_code=400, detail="Access code must be at least 4 characters")
        access_code_hash = crud.get_password_hash(access_code)

    share_token = secrets.token_urlsafe(16)
    while crud.get_job_share_by_token(db, share_token):
        share_token = secrets.token_urlsafe(16)

    share = crud.create_job_share(
        db,
        job_id=job.id,
        creator_id=current_user.id,
        share_token=share_token,
        access_code_hash=access_code_hash,
        expires_at=expires_at,
        allow_audio_download=request.allow_audio_download,
        allow_transcript_download=request.allow_transcript_download,
        allow_summary_download=request.allow_summary_download,
    )

    return build_job_share_response(share)


@app.get("/jobs/{job_id}/shares", response_model=List[schemas.JobShareResponse])
def list_job_shares(
    job_id: int,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    job = crud.get_job(db, job_id=job_id, owner_id=current_user.id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    shares = crud.get_job_shares_for_owner(db, job_id=job.id, owner_id=current_user.id)
    return [build_job_share_response(share) for share in shares]


@app.patch("/jobs/{job_id}/shares/{share_id}", response_model=schemas.JobShareResponse)
def update_job_share(
    job_id: int,
    share_id: int,
    request: schemas.JobShareUpdateRequest,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    job = crud.get_job(db, job_id=job_id, owner_id=current_user.id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    share = crud.get_job_share_by_id(db, share_id)
    if not share or share.job_id != job.id:
        raise HTTPException(status_code=404, detail="Share link not found")

    payload = request.model_dump(exclude_unset=True)
    updates: dict[str, object] = {}

    if "allow_audio_download" in payload:
        updates["allow_audio_download"] = payload["allow_audio_download"]
    if "allow_transcript_download" in payload:
        updates["allow_transcript_download"] = payload["allow_transcript_download"]
    if "allow_summary_download" in payload:
        updates["allow_summary_download"] = payload["allow_summary_download"]
    if "is_active" in payload:
        updates["is_active"] = payload["is_active"]
    if "expires_at" in payload:
        expires_at_value = payload["expires_at"]
        if expires_at_value is not None and expires_at_value <= datetime.utcnow():
            raise HTTPException(status_code=400, detail="Expiration time must be in the future")
        updates["expires_at"] = expires_at_value
    if "access_code" in payload:
        access_code_value = payload["access_code"]
        if access_code_value is None:
            updates["access_code_hash"] = None
        else:
            access_code = access_code_value.strip()
            if not access_code:
                updates["access_code_hash"] = None
            else:
                if len(access_code) < 4:
                    raise HTTPException(status_code=400, detail="Access code must be at least 4 characters")
                updates["access_code_hash"] = crud.get_password_hash(access_code)

    if not updates:
        return build_job_share_response(share)

    updated_share = crud.update_job_share(db, share_id, **updates)
    if not updated_share:
        raise HTTPException(status_code=404, detail="Share link not found")

    return build_job_share_response(updated_share)


@app.delete("/jobs/{job_id}/shares/{share_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_job_share_endpoint(
    job_id: int,
    share_id: int,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    job = crud.get_job(db, job_id=job_id, owner_id=current_user.id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    share = crud.get_job_share_by_id(db, share_id)
    if not share or share.job_id != job.id:
        raise HTTPException(status_code=404, detail="Share link not found")

    crud.deactivate_job_share(db, share_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/public/shares/{share_token}", response_model=schemas.PublicShareDetails)
def get_public_share_details(
    share_token: str,
    access_code: Optional[str] = Query(default=None, alias="access_code"),
    x_share_code: Optional[str] = Header(default=None, alias="X-Share-Code"),
    db: Session = Depends(get_db),
):
    share = crud.get_job_share_by_token(db, share_token)
    if not share:
        raise HTTPException(status_code=404, detail="Share link not found")

    provided_code = resolve_share_code(x_share_code, access_code)
    ensure_share_access(share, provided_code)

    job = share.job
    if not job:
        raise HTTPException(status_code=404, detail="Shared job not found")

    hydrate_job_transcript_from_disk(job)
    crud.touch_job_share_access(db, share)

    job_status_value = job.status.value if isinstance(job.status, models.JobStatus) else job.status

    return schemas.PublicShareDetails(
        share_token=share.share_token,
        expires_at=share.expires_at,
        requires_access_code=bool(share.access_code_hash),
        job=schemas.PublicShareJob(
            id=job.id,
            filename=job.filename,
            status=schemas.JobStatusEnum(job_status_value),
            created_at=job.created_at,
            transcript=job.transcript,
            summary=job.summary,
            timing_info=job.timing_info,
        ),
        permissions=schemas.SharePermissions(
            allow_audio_download=share.allow_audio_download,
            allow_transcript_download=share.allow_transcript_download,
            allow_summary_download=share.allow_summary_download,
        ),
    )


@app.get("/public/shares/{share_token}/transcript/download")
def download_shared_transcript(
    share_token: str,
    access_code: Optional[str] = Query(default=None, alias="access_code"),
    x_share_code: Optional[str] = Header(default=None, alias="X-Share-Code"),
    db: Session = Depends(get_db),
):
    share = crud.get_job_share_by_token(db, share_token)
    if not share:
        raise HTTPException(status_code=404, detail="Share link not found")

    provided_code = resolve_share_code(x_share_code, access_code)
    ensure_share_access(share, provided_code)

    if not share.allow_transcript_download:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Transcript download disabled for this share")

    job = share.job
    if not job:
        raise HTTPException(status_code=404, detail="Shared job not found")

    hydrate_job_transcript_from_disk(job)

    transcript_path = TRANSCRIPT_STORAGE_DIR / f"job_{job.id}.txt"
    transcript_text: Optional[str] = None

    if transcript_path.exists():
        transcript_text = transcript_path.read_text(encoding="utf-8")
    elif job.transcript:
        transcript_text = job.transcript

    if not transcript_text or not transcript_text.strip():
        raise HTTPException(status_code=404, detail="Transcript not available")

    crud.touch_job_share_access(db, share)

    filename = build_download_filename(job.filename, f"job-{job.id}", "_transcript.txt")
    headers = {"Content-Disposition": build_content_disposition(filename)}
    content = transcript_text if transcript_text.endswith("\n") else f"{transcript_text}\n"

    return StreamingResponse(
        iter([content]),
        media_type="text/plain; charset=utf-8",
        headers=headers,
    )


@app.get("/public/shares/{share_token}/summary/download")
def download_shared_summary(
    share_token: str,
    access_code: Optional[str] = Query(default=None, alias="access_code"),
    x_share_code: Optional[str] = Header(default=None, alias="X-Share-Code"),
    db: Session = Depends(get_db),
):
    share = crud.get_job_share_by_token(db, share_token)
    if not share:
        raise HTTPException(status_code=404, detail="Share link not found")

    provided_code = resolve_share_code(x_share_code, access_code)
    ensure_share_access(share, provided_code)

    if not share.allow_summary_download:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Summary download disabled for this share")

    job = share.job
    if not job:
        raise HTTPException(status_code=404, detail="Shared job not found")

    summary_text = job.summary or ""
    if not summary_text.strip():
        raise HTTPException(status_code=404, detail="Summary not available")

    parsed_summary: Optional[Union[dict, str]] = None
    try:
        parsed_summary = json.loads(summary_text)
    except json.JSONDecodeError:
        parsed_summary = None

    if isinstance(parsed_summary, dict):
        formatted_content = parsed_summary.get("formatted_content")
        structured_data = parsed_summary.get("structured_data")
        if isinstance(formatted_content, str) and formatted_content.strip():
            summary_text = formatted_content
        elif structured_data:
            summary_text = format_summary_as_markdown_with_refs(structured_data, [])
    elif isinstance(parsed_summary, str) and parsed_summary.strip():
        summary_text = parsed_summary

    if not summary_text.strip():
        raise HTTPException(status_code=404, detail="Summary not available")

    crud.touch_job_share_access(db, share)

    filename = build_download_filename(job.filename, f"job-{job.id}", "_summary.md")
    headers = {"Content-Disposition": build_content_disposition(filename)}
    content = summary_text if summary_text.endswith("\n") else f"{summary_text}\n"

    return StreamingResponse(
        iter([content]),
        media_type="text/markdown; charset=utf-8",
        headers=headers,
    )


@app.get("/public/shares/{share_token}/audio")
def download_shared_audio(
    share_token: str,
    access_code: Optional[str] = Query(default=None, alias="access_code"),
    x_share_code: Optional[str] = Header(default=None, alias="X-Share-Code"),
    db: Session = Depends(get_db),
):
    share = crud.get_job_share_by_token(db, share_token)
    if not share:
        raise HTTPException(status_code=404, detail="Share link not found")

    provided_code = resolve_share_code(x_share_code, access_code)
    ensure_share_access(share, provided_code)

    if not share.allow_audio_download:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Audio download disabled for this share")

    job = share.job
    if not job:
        raise HTTPException(status_code=404, detail="Shared job not found")

    audio_path: Optional[str] = None
    if job.file_path and os.path.exists(job.file_path):
        audio_path = job.file_path
    else:
        upload_dir = "uploads"
        candidate_path = os.path.join(upload_dir, job.filename)
        if os.path.exists(candidate_path):
            audio_path = candidate_path

    if not audio_path:
        raise HTTPException(status_code=404, detail="Audio file not found")

    crud.touch_job_share_access(db, share)

    media_type, _ = mimetypes.guess_type(audio_path)
    filename = os.path.basename(audio_path)
    return FileResponse(
        audio_path,
        media_type=media_type or "application/octet-stream",
        filename=filename,
    )

# --- Post-processing Endpoints ---
from pydantic import BaseModel, Field
from openai import OpenAI
import httpx
import os

def create_openai_client():
    """Initialize OpenAI client with fallback handling for custom base URLs."""
    import urllib3

    client = None
    try:
        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"), base_url=os.getenv("OPENAI_BASE_URL"))
    except Exception as init_error:
        logger.warning(f"Initial OpenAI client setup failed: {init_error}")
        try:
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
            http_client = httpx.Client(verify=False, timeout=60.0)
            client = OpenAI(
                api_key=os.getenv("OPENAI_API_KEY"),
                base_url=os.getenv("OPENAI_BASE_URL"),
                http_client=http_client
            )
        except Exception as e:
            logger.error(f"Fallback OpenAI client setup failed: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to initialize OpenAI client: {e}")
    return client

class SummarizeJobRequest(BaseModel):
    target_language: str = "Chinese"  # Default to Chinese if not specified

class RenameJobRequest(BaseModel):
    filename: str

@app.put("/jobs/{job_id}/rename", response_model=schemas.Job)
async def rename_job(job_id: int, request: RenameJobRequest, current_user: schemas.User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = crud.get_job(db, job_id=job_id, owner_id=current_user.id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    new_filename = request.filename.strip()
    if not new_filename:
        raise HTTPException(status_code=400, detail="Filename cannot be empty")
    if len(new_filename) > 255:
        raise HTTPException(status_code=400, detail="Filename is too long")
    if any(ch in new_filename for ch in ("/", "\\")):
        raise HTTPException(status_code=400, detail="Filename cannot contain path separators")
    if new_filename == job.filename:
        return job

    uploads_dir = Path("uploads")
    old_path = uploads_dir / job.filename if job.filename else None
    new_path = uploads_dir / new_filename

    if old_path and old_path.exists():
        if new_path.exists():
            raise HTTPException(status_code=400, detail="A file with this name already exists on the server")
        try:
            old_path.rename(new_path)
        except OSError as exc:
            logger.error(f"[Job {job_id}] Failed to rename file on disk from {old_path} to {new_path}: {exc}")
            raise HTTPException(status_code=500, detail="Failed to rename the stored file. Please try again later.")
    else:
        logger.warning(f"[Job {job_id}] Original file {old_path} missing during rename; updating database only.")

    updated_job = crud.update_job_filename(db, job_id=job_id, owner_id=current_user.id, filename=new_filename)
    if not updated_job:
        raise HTTPException(status_code=500, detail="Failed to update filename")

    logger.info(f"[Job {job_id}] Filename updated to {new_filename}")
    return updated_job

@app.post("/jobs/{job_id}/summarize", response_model=schemas.Job)
async def summarize_job(job_id: int, request: SummarizeJobRequest = None, current_user: schemas.User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = crud.get_job(db, job_id=job_id, owner_id=current_user.id)
    if not job: raise HTTPException(status_code=404, detail="Job not found")
    if not job.transcript: raise HTTPException(status_code=400, detail="Job has no transcript to summarize.")

    # Use default Chinese if no request or no language specified
    target_language = request.target_language if request else "Chinese"

    try:
        client = create_openai_client()
        
        # Parse transcript with timing information and group consecutive segments by same speaker
        original_segments = []
        if job.timing_info:
            try:
                timing_data = json.loads(job.timing_info)
                for idx, segment in enumerate(timing_data):
                    text = segment.get('text', '').strip()
                    if text:  # Only include segments with actual text content
                        original_segments.append({
                            'index': idx + 1,
                            'speaker': segment.get('speaker', 'Unknown'),
                            'text': text,
                            'start_time': segment.get('start_time', 0),
                            'end_time': segment.get('end_time', 0),
                            'do_not_merge_with_previous': bool(segment.get('do_not_merge_with_previous', False))
                        })
            except Exception as e:
                logger.warning(f"Error parsing timing info for summary: {e}")

        # Fallback: if no timing info or no valid segments, try to parse from plain transcript
        if not original_segments and job.transcript:
            logger.info(f"[Job {job_id}] No valid segments from timing info, parsing plain transcript")
            lines = job.transcript.split('\n')
            for idx, line in enumerate(lines):
                line = line.strip()
                if line:  # Skip empty lines
                    # Try to extract speaker and content
                    match = re.match(r'^\[([^\]]+)\]\s*(.+)$', line)
                    if match and match.group(2).strip():
                        original_segments.append({
                            'index': len(original_segments) + 1,
                            'speaker': match.group(1),
                            'text': match.group(2).strip(),
                            'start_time': 0,
                            'end_time': 0,
                            'do_not_merge_with_previous': False
                        })

        if not original_segments:
            logger.warning(f"[Job {job_id}] No valid transcript segments found for summary generation")
            raise HTTPException(status_code=400, detail="No valid transcript content found for summary generation")

        # Group consecutive segments by the same speaker (same logic as frontend)
        grouped_segments = []
        for segment in original_segments:
            if not grouped_segments:
                grouped_segments.append({
                    'index': 1,
                    'speaker': segment['speaker'],
                    'text': segment['text'],
                    'start_time': segment['start_time'],
                    'end_time': segment['end_time'],
                    'original_segments': [segment]
                })
            else:
                last_group = grouped_segments[-1]
                if (last_group['speaker'] == segment['speaker'] and
                    not segment.get('do_not_merge_with_previous', False)):
                    # Same speaker as previous, merge the segments
                    last_group['text'] += ' ' + segment['text']
                    last_group['end_time'] = segment['end_time']
                    last_group['original_segments'].append(segment)
                else:
                    # Different speaker, create a new group
                    grouped_segments.append({
                        'index': len(grouped_segments) + 1,
                        'speaker': segment['speaker'],
                        'text': segment['text'],
                        'start_time': segment['start_time'],
                        'end_time': segment['end_time'],
                        'original_segments': [segment]
                    })

        transcript_segments = grouped_segments
        logger.info(f"[Job {job_id}] Prepared {len(transcript_segments)} merged segments for summary generation")

        # Create prompt with clear segment references (using merged segment numbers)
        transcript_with_refs = ""
        for segment in transcript_segments:
            start_formatted = f"{int(segment['start_time']//3600):02d}:{int((segment['start_time']%3600)//60):02d}:{int(segment['start_time']%60):02d}"
            end_formatted = f"{int(segment['end_time']//3600):02d}:{int((segment['end_time']%3600)//60):02d}:{int(segment['end_time']%60):02d}"
            transcript_with_refs += f"SEGMENT [{segment['index']}] [{start_formatted}-{end_formatted}] [{segment['speaker']}] {segment['text']}\n"

        # Add segment count and validation info
        transcript_with_refs = f"TRANSCRIPT CONTAINS {len(transcript_segments)} MERGED SEGMENTS NUMBERED [1] THROUGH [{len(transcript_segments)}]\n" + "="*80 + "\n" + transcript_with_refs

        
        # Enhanced comprehensive meeting summary prompt with strict language compliance
        system_prompt = f"""You are an expert meeting analyst and transcription specialist. Your task is to create a comprehensive, factual summary of the following meeting transcript in STRICTLY {target_language}.

CRITICAL LANGUAGE REQUIREMENTS:
- ENTIRE response must be in {target_language} - NO EXCEPTIONS
- All content, labels, and text must be {target_language} only
- Never mix languages or use any terms from other languages
- Ensure perfect language consistency throughout the entire response

IMPORTANT: The transcript below has been processed to MERGE consecutive segments from the same speaker. The segment numbers [1], [2], [3], etc. represent these MERGED segments as they would appear in the frontend display.

CRITICAL REFERENCE REQUIREMENTS:
- ONLY use the MERGED segment numbers [1], [2], [3], etc. that appear in the transcript
- These numbers correspond to how segments are displayed in the frontend interface
- Every reference number in your JSON must exactly match a merged segment number
- NEVER use reference numbers like [4-5], [1-2], or any format that doesn't exist in the transcript
- If you reference segment [7], it MUST contain the information you're citing
- Double-check that every reference number you use actually exists in the provided transcript
- When information spans multiple merged segments, include ALL relevant segment numbers: [1] [2] [3]

NOTE ABOUT SEGMENT MERGING:
- Consecutive segments from the same speaker have been merged together
- Each segment number [1], [2], [3] represents a complete thought/conversation turn
- This matches exactly how users will see the transcript in the interface

COMPREHENSIVE CONTENT ANALYSIS REQUIREMENTS:
- Extract ALL meeting elements: objectives, discussions, decisions, action items, issues, participants, timeline
- Capture meeting structure: opening, main discussions, conclusions, next steps
- Include specific details: numbers, dates, names, locations, technical specifications
- Record participant roles, contributions, and interactions
- Document decision-making processes and rationale
- Track action items with owners, deadlines, and dependencies
- Note unresolved issues and future follow-ups
- Capture meeting outcomes and next steps
- Include key quotes and important statements
- Document any presentations, demonstrations, or shared materials
- Record voting results or consensus methods if applicable
- Note any cancellations, postponements, or scheduling changes
- Capture budget or resource allocations discussed
- Document risks, concerns, or challenges identified
- Include opportunities or new ideas presented

Your response should be a comprehensive JSON object with this structure:
{{
  "meeting_info": {{
    "title": "Meeting title or purpose if mentioned",
    "date": "Date if mentioned",
    "duration": "Meeting duration if determinable",
    "participants": ["List of speakers/participants identified"],
    "type": "Meeting type (e.g., planning, review, brainstorming, decision-making)",
    "references": [1, 2, 3]
  }},
  "overview": {{
    "content": "Comprehensive meeting overview including purpose, objectives, attendees, and key outcomes",
    "references": [1, 2, 3]
  }},
  "key_discussions": [
    {{
      "topic": "Main discussion topic",
      "summary": "Detailed summary including background, arguments, viewpoints, alternatives considered, and conclusions",
      "participants_involved": ["Speaker names if mentioned"],
      "key_points": ["List of main points covered"],
      "references": [1, 2, 3]
    }}
  ],
  "decisions": [
    {{
      "decision": "Complete description of the decision made",
      "responsible_party": "Person or team responsible for implementation",
      "rationale": "Reasoning behind the decision",
      "impact": "Expected impact or consequences",
      "references": [1, 2]
    }}
  ],
  "action_items": [
    {{
      "action": "Specific, actionable task description",
      "owner": "Person or team assigned",
      "deadline": "Deadline if mentioned",
      "priority": "Priority level if indicated",
      "dependencies": "Dependencies or prerequisites if mentioned",
      "references": [1, 2]
    }}
  ],
  "unresolved_issues": [
    {{
      "issue": "Detailed description of unresolved issue",
      "impact": "Potential impact if not resolved",
      "suggested_next_steps": "Suggested approaches if mentioned",
      "references": [1, 2]
    }}
  ],
  "next_meeting": {{
    "date": "Next meeting date if mentioned",
    "agenda": "Agenda items for next meeting if discussed",
    "preparations": "Preparation requirements if mentioned",
    "references": [1, 2]
  }},
  "attachments_documents": [
    {{
      "document": "Document or material mentioned",
      "purpose": "Purpose or relevance",
      "references": [1, 2]
    }}
  ]
}}

ENHANCED ANALYSIS GUIDELINES:
1. COMPREHENSIVE COVERAGE: Extract ALL meeting aspects, not just obvious ones
2. LANGUAGE CONSISTENCY: Ensure 100% {target_language} throughout entire response
3. CROSS-REFERENCE every claim with ONLY actual segment numbers from the transcript
4. VERIFY each reference number exists in the transcript before including it
5. When information spans multiple segments, include ALL existing segment numbers: [1] [2] [3] [7]
6. PRESERVE complete context and meaning - don't oversimplify complex discussions
7. IDENTIFY all participants and their roles/contributions
8. CAPTURE decision-making processes, including consensus, voting, or delegation
9. EXTRACT specific details: numbers, dates, names, locations, technical terms
10. DOCUMENT action items with complete implementation details
11. RECORD meeting logistics: timing, location, format (in-person/virtual)
12. NOTE any materials shared or referenced during the meeting
13. CAPTURE emotional tone or urgency if relevant to decisions
14. IDENTIFY conflicts, disagreements, or alternative solutions proposed
15. DOCUMENT any commitments made or assurances given
16. RECORD budget, resource, or timeline implications discussed
17. NOTE risk assessments or mitigation strategies mentioned
18. CAPTURE innovation opportunities or new initiatives proposed
19. DOCUMENT compliance or regulatory considerations if applicable
20. REFERENCE VALIDATION: Before finalizing, verify: "Does segment [X] actually contain this information?"

COMPREHENSIVE FORMAT GUIDELINES:
- Write entire response in {target_language} only
- Keep content fluent and professional
- Embed references naturally within the content
- Use clear, descriptive language appropriate for business documentation
- Organize information logically while maintaining chronological flow
- Use consistent terminology throughout the response
- Ensure each section reads like professional meeting minutes

REFERENCE FORMAT RULES:
- Use ONLY single brackets with numbers: [1], [2], [3]
- NEVER use ranges like [1-2] or [4-5]
- NEVER use any reference format that doesn't exactly match the transcript
- Each reference number must correspond to an actual segment in the provided transcript
- If you're unsure about a reference, DON'T include it rather than risk being incorrect

ULTIMATE QUALITY STANDARDS:
- 100% {target_language} language compliance - absolutely no exceptions
- Every factual claim must have supporting references from actual transcript segments
- No invented information, assumptions, or speculation
- Capture the complete complexity and nuance of all discussions
- Maintain professional, objective tone throughout
- Organize information comprehensively while preserving relationships
- Use the exact language and terminology from the meeting when appropriate
- 100% reference accuracy is mandatory - no exceptions
- Ensure all meeting aspects are documented, not just prominent ones

Return ONLY valid JSON in {target_language}. If a section has no relevant content, use an empty array []. Focus exclusively on what was actually discussed in the provided transcript segments, using ONLY the exact reference numbers that appear in the transcript, and ensure the ENTIRE response is in {target_language}."""

        # Create user message with clear instructions about merged segment numbers
        user_message = f"""MEETING TRANSCRIPT FOR ANALYSIS:

{transcript_with_refs}

IMPORTANT: The transcript above contains MERGED segments numbered from [1] to [{len(transcript_segments)}].
These merged segments combine consecutive content from the same speaker.

REFERENCE REQUIREMENTS:
- You MUST ONLY use these exact merged segment numbers in your references
- NEVER invent or guess reference numbers
- Every reference you use must correspond to an actual merged segment in the transcript above
- These references will be used to highlight the correct segments in the frontend interface

Please analyze the transcript and create the structured summary following the system prompt guidelines."""

        chat_completion = await asyncio.to_thread(
            client.chat.completions.create,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ],
            model=os.getenv("OPENAI_MODEL_NAME"),
            timeout=600,  # Increase timeout for longer operations
            temperature=0.3  # Lower temperature for more consistent, factual output
        )
        raw_summary = chat_completion.choices[0].message.content

        # Try to parse as JSON and validate references
        try:
            summary_data = json.loads(raw_summary)

            # Validate reference numbers
            valid_segments = set(range(1, len(transcript_segments) + 1))
            invalid_refs = validate_and_fix_references(summary_data, valid_segments)

            if invalid_refs:
                logger.info(f"[Job {job_id}] Adjusted invalid references: {invalid_refs}")

            # Store both the raw JSON and formatted markdown
            summary_with_json = {
                "formatted_content": format_summary_as_markdown_with_refs(summary_data, transcript_segments),
                "structured_data": summary_data
            }
            # Store as JSON string for frontend processing
            summary_json = json.dumps(summary_with_json, ensure_ascii=False, indent=2)
        except json.JSONDecodeError:
            # If JSON parsing fails, use the raw text as fallback
            logger.warning(f"[Job {job_id}] Failed to parse summary as JSON, storing raw text")
            summary_json = raw_summary

        crud.update_job_summary(db, job_id=job_id, summary=summary_json)
        
        # Return the updated job with the summary
        updated_job = crud.get_job(db, job_id=job_id, owner_id=current_user.id)
        return updated_job
    except Exception as e:
        logger.error(f"Error in summarize_job: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate summary: {e}")


class UpdateSummaryRequest(BaseModel):
    summary: str

class TranscriptSegmentUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: Optional[int] = None
    text: str
    speaker: Optional[str] = None
    start_time: Optional[float] = Field(default=None, alias="startTime")
    end_time: Optional[float] = Field(default=None, alias="endTime")
    do_not_merge_with_previous: Optional[bool] = Field(default=None, alias="doNotMergeWithPrevious")

class TranscriptUpdateRequest(BaseModel):
    transcript: List[TranscriptSegmentUpdate]

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    messages: List[ChatMessage]
    system_prompt: Optional[str] = Field(default=None, alias="systemPrompt")

@app.post("/jobs/{job_id}/update_summary")
async def update_summary(job_id: int, request: UpdateSummaryRequest, current_user: schemas.User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = crud.get_job(db, job_id=job_id, owner_id=current_user.id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    try:
        crud.update_job_summary(db, job_id=job_id, summary=request.summary)
        # Return the updated job
        updated_job = crud.get_job(db, job_id=job_id, owner_id=current_user.id)
        return updated_job
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update summary: {e}")

@app.post("/jobs/{job_id}/transcript", response_model=schemas.Job)
async def update_job_transcript_endpoint(job_id: int, request: TranscriptUpdateRequest, current_user: schemas.User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = crud.get_job(db, job_id=job_id, owner_id=current_user.id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    transcript_lines: List[str] = []
    timing_entries: List[dict] = []

    for index, segment in enumerate(request.transcript):
        text = (segment.text or "").strip()
        if not text:
            continue

        speaker = (segment.speaker or "Unknown").strip() or "Unknown"
        transcript_lines.append(f"[{speaker}] {text}")
        start_time = segment.start_time if segment.start_time is not None else 0
        end_time = segment.end_time if segment.end_time is not None else start_time
        timing_entries.append({
            "speaker": speaker,
            "text": text,
            "start_time": float(start_time),
            "end_time": float(end_time),
            "do_not_merge_with_previous": bool(segment.do_not_merge_with_previous),
            "line_number": index,
            "segment_id": segment.id,
        })

    transcript_text = "\n".join(transcript_lines)
    timing_json = json.dumps(timing_entries, ensure_ascii=False)

    updated_job = crud.update_job_transcript(db, job_id=job_id, transcript=transcript_text, timing_info=timing_json)
    if not updated_job:
        raise HTTPException(status_code=404, detail="Job not found")

    persist_transcript_to_disk(job_id, transcript_text, timing_entries)

    refreshed_job = crud.get_job(db, job_id=job_id, owner_id=current_user.id)
    if not refreshed_job:
        raise HTTPException(status_code=404, detail="Job not found")
    hydrate_job_transcript_from_disk(refreshed_job)
    return refreshed_job

@app.post("/assistant/chat/stream")
async def assistant_chat_stream(request: ChatRequest, current_user: schemas.User = Depends(get_current_user)):
    """流式会议助手聊天接口"""
    if not request.messages:
        raise HTTPException(status_code=400, detail="At least one message is required.")

    client = create_openai_client()
    conversation: List[dict] = []

    system_prompt = (request.system_prompt or
        "You are a knowledgeable meeting assistant who helps users understand transcripts, summaries, and provides actionable guidance. Provide concise, helpful answers.").strip()

    if system_prompt:
        conversation.append({"role": "system", "content": system_prompt})

    has_user_message = False
    for message in request.messages:
        role = (message.role or "user").lower()
        if role not in {"user", "assistant", "system"}:
            role = "user"
        content = (message.content or "").strip()
        if not content:
            continue
        if role == "user":
            has_user_message = True
        conversation.append({"role": role, "content": content})

    if not has_user_message:
        raise HTTPException(status_code=400, detail="Chat requires at least one user message.")

    async def generate_stream():
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()
        sentinel_done = object()
        sentinel_error = object()

        def stream_worker():
            try:
                stream = client.chat.completions.create(
                    messages=conversation,
                    model=os.getenv("OPENAI_MODEL_NAME"),
                    timeout=600,
                    temperature=0.4,
                    stream=True
                )

                for chunk in stream:
                    try:
                        choice = chunk.choices[0]
                    except (IndexError, AttributeError):
                        continue

                    delta = getattr(choice, "delta", None)
                    if not delta:
                        continue

                    content = getattr(delta, "content", None)
                    if content:
                        asyncio.run_coroutine_threadsafe(queue.put(content), loop)

                asyncio.run_coroutine_threadsafe(queue.put(sentinel_done), loop)
            except Exception as worker_error:
                logger.error(f"Error in stream worker: {worker_error}")
                asyncio.run_coroutine_threadsafe(queue.put((sentinel_error, str(worker_error))), loop)

        threading.Thread(target=stream_worker, daemon=True).start()

        while True:
            item = await queue.get()

            if item is sentinel_done:
                yield "data: {\"done\": true}\n\n"
                break

            if isinstance(item, tuple) and item and item[0] is sentinel_error:
                _, error_message = item
                yield f"data: {json.dumps({'error': error_message}, ensure_ascii=False)}\n\n"
                break

            yield f"data: {json.dumps({'content': item}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Cache-Control, Authorization",
            "X-Accel-Buffering": "no"
        }
    )

def parse_transcript_segments(transcript_text):
    """解析转录文本为段落列表，用于摘要生成中的引用编号"""
    if not transcript_text:
        return []

    segments = []
    lines = transcript_text.split('\n')

    for idx, line in enumerate(lines):
        line = line.strip()
        if line:  # 跳过空行
            # 尝试提取说话者和内容
            match = re.match(r'^\[([^\]]+)\]\s*(.+)$', line)
            if match and match.group(2).strip():
                segments.append({
                    'index': len(segments) + 1,
                    'speaker': match.group(1),
                    'text': match.group(2).strip(),
                    'start_time': 0,
                    'end_time': 0
                })
            elif not segments:  # 如果没有说话者标记且是第一行
                segments.append({
                    'index': len(segments) + 1,
                    'speaker': 'Unknown',
                    'text': line,
                    'start_time': 0,
                    'end_time': 0
                })
            else:  # 附加到最后一个段落
                segments[-1]['text'] += ' ' + line

    return segments

def format_reference_links(references):
    """Format reference numbers with consecutive ranges like [1], [2-3], [5-7]"""
    if not references:
        return ""

    # Sort and deduplicate references
    sorted_refs = sorted(set(references))
    if not sorted_refs:
        return ""

    # Group consecutive numbers
    groups = []
    start = sorted_refs[0]
    prev = start

    for num in sorted_refs[1:]:
        if num == prev + 1:
            # Still consecutive
            prev = num
        else:
            # Break in sequence, save the current group
            if start == prev:
                groups.append(str(start))
            else:
                groups.append(f"{start}-{prev}")
            start = num
            prev = num

    # Add the last group
    if start == prev:
        groups.append(str(start))
    else:
        groups.append(f"{start}-{prev}")

    # Emit plain reference markers like [1] or [2-4]; the frontend decorates them dynamically
    return " ".join(f"[{group}]" for group in groups)

def validate_and_fix_references(summary_data, valid_segments):
    """Validate and fix reference numbers in the summary data."""
    invalid_refs_found = []

    def validate_refs_in_list(items_list, section_name):
        """Validate references in a list of items."""
        invalid_refs = []
        for item in items_list:
            if isinstance(item, dict):
                for key, value in item.items():
                    if key == 'references' and isinstance(value, list):
                        # Filter out invalid references
                        valid_refs = []
                        for ref in value:
                            if isinstance(ref, int) and ref in valid_segments:
                                valid_refs.append(ref)
                            elif isinstance(ref, str) and ref.isdigit():
                                ref_num = int(ref)
                                if ref_num in valid_segments:
                                    valid_refs.append(ref_num)
                                else:
                                    invalid_refs.append(ref)
                            else:
                                invalid_refs.append(ref)
                        item[key] = valid_refs
                    elif isinstance(value, list):
                        validate_refs_in_list(value, f"{section_name}.{key}")
                    elif isinstance(value, dict):
                        validate_refs_in_dict(value, f"{section_name}.{key}")
        return invalid_refs

    def validate_refs_in_dict(data_dict, section_name):
        """Validate references in a dictionary."""
        invalid_refs = []
        for key, value in data_dict.items():
            if key == 'references' and isinstance(value, list):
                # Filter out invalid references
                valid_refs = []
                for ref in value:
                    if isinstance(ref, int) and ref in valid_segments:
                        valid_refs.append(ref)
                    elif isinstance(ref, str) and ref.isdigit():
                        ref_num = int(ref)
                        if ref_num in valid_segments:
                            valid_refs.append(ref_num)
                        else:
                            invalid_refs.append(ref)
                    else:
                        invalid_refs.append(ref)
                data_dict[key] = valid_refs
            elif isinstance(value, list):
                invalid_refs.extend(validate_refs_in_list(value, f"{section_name}.{key}"))
            elif isinstance(value, dict):
                invalid_refs.extend(validate_refs_in_dict(value, f"{section_name}.{key}"))
        return invalid_refs

    # Validate all sections
    for section_name, section_data in summary_data.items():
        if isinstance(section_data, dict):
            invalid_refs_found.extend(validate_refs_in_dict(section_data, section_name))
        elif isinstance(section_data, list):
            invalid_refs_found.extend(validate_refs_in_list(section_data, section_name))

    return list(set(invalid_refs_found))  # Remove duplicates

def format_summary_as_markdown_with_refs(summary_data, transcript_segments):
    """Convert enhanced JSON summary data to clean, fluent markdown with embedded references."""
    markdown = ""

    # Overview section
    if summary_data.get("overview"):
        overview = summary_data["overview"]
        if isinstance(overview, dict):
            content = overview.get('content', '')
            references = overview.get('references', [])
            markdown += f"## 会议概览\n\n{content}"
            if references:
                refs_text = format_reference_links(references)
                markdown += f" {refs_text}"
            markdown += "\n\n"

    # Key discussions section - Clean format
    if summary_data.get("key_discussions"):
        markdown += "## 主要讨论内容\n\n"
        for discussion in summary_data["key_discussions"]:
            topic = discussion.get('topic', '未命名主题')
            summary = discussion.get('summary', '')
            references = discussion.get('references', [])

            markdown += f"### {topic}\n\n{summary}"
            if references:
                refs_text = format_reference_links(references)
                markdown += f" {refs_text}"
            markdown += "\n\n"

    # Data and metrics section - Clean format
    if summary_data.get("data_and_metrics"):
        markdown += "## 数据与指标\n\n"
        for data_item in summary_data["data_and_metrics"]:
            metric = data_item.get('metric', '')
            value = data_item.get('value', '')
            context = data_item.get('context', '')
            references = data_item.get("references", [])

            content = f"**{metric}：** {value}"
            if context:
                content += f"（{context}）"

            markdown += content
            if references:
                refs_text = format_reference_links(references)
                markdown += f" {refs_text}"
            markdown += "\n\n"

    # Concerns and risks section - Clean format
    if summary_data.get("concerns_and_risks"):
        markdown += "## 风险与关注点\n\n"
        for concern in summary_data["concerns_and_risks"]:
            concern_text = concern.get('concern', '')
            references = concern.get("references", [])

            markdown += concern_text
            if references:
                refs_text = format_reference_links(references)
                markdown += f" {refs_text}"
            markdown += "\n\n"

    # Decisions section - Clean format
    if summary_data.get("decisions"):
        markdown += "## 决策事项\n\n"
        for decision in summary_data["decisions"]:
            decision_text = decision.get('decision', '')
            responsible_party = decision.get('responsible_party', '')
            references = decision.get("references", [])

            content = f"**决策：** {decision_text}"
            if responsible_party:
                content += f"\n**负责人：** {responsible_party}"

            markdown += content
            if references:
                refs_text = format_reference_links(references)
                markdown += f"\n{refs_text}"
            markdown += "\n\n"

    # Action items section - Clean format
    if summary_data.get("action_items"):
        markdown += "## 行动项目\n\n"
        for action in summary_data["action_items"]:
            action_text = action.get('action', '')
            owner = action.get('owner', '')
            deadline = action.get('deadline', '')
            references = action.get("references", [])

            content = f"**行动项：** {action_text}"
            if owner:
                content += f"\n**负责人：** {owner}"
            if deadline:
                content += f"\n**截止日期：** {deadline}"

            markdown += content
            if references:
                refs_text = format_reference_links(references)
                markdown += f"\n{refs_text}"
            markdown += "\n\n"

    # Unresolved issues section - Clean format
    if summary_data.get("unresolved_issues"):
        markdown += "## 未解决问题\n\n"
        for issue in summary_data["unresolved_issues"]:
            issue_text = issue.get('issue', '')
            references = issue.get("references", [])

            markdown += f"**问题：** {issue_text}"
            if references:
                refs_text = format_reference_links(references)
                markdown += f" {refs_text}"
            markdown += "\n\n"

    return markdown.strip()

# --- User Management Endpoints ---

@app.get("/users/me", response_model=schemas.UserResponse)
async def get_current_user_info(current_user: schemas.User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    """Get current user information"""
    job_count = db.query(models.Job).filter(models.Job.owner_id == current_user.id).count()
    return schemas.UserResponse(
        id=current_user.id,
        username=current_user.username,
        email=current_user.email,
        full_name=current_user.full_name,
        role=current_user.role,
        is_active=current_user.is_active,
        created_at=current_user.created_at,
        last_login=current_user.last_login,
        job_count=job_count
    )

@app.put("/users/me", response_model=schemas.UserResponse)
async def update_current_user(
    user_update: schemas.UserUpdate,
    current_user: schemas.User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """Update current user information"""
    # Users can only update their own email and full_name
    allowed_update = schemas.UserUpdate(
        email=user_update.email,
        full_name=user_update.full_name
    )

    # Check if email is already taken by another user
    if user_update.email and user_update.email != current_user.email:
        existing_user = crud.get_user_by_email(db, email=user_update.email)
        if existing_user:
            raise HTTPException(status_code=400, detail="Email already registered")

    updated_user = crud.update_user(db, current_user.id, allowed_update)
    if not updated_user:
        raise HTTPException(status_code=404, detail="User not found")

    job_count = db.query(models.Job).filter(models.Job.owner_id == updated_user.id).count()
    return schemas.UserResponse(
        id=updated_user.id,
        username=updated_user.username,
        email=updated_user.email,
        full_name=updated_user.full_name,
        role=updated_user.role,
        is_active=updated_user.is_active,
        created_at=updated_user.created_at,
        last_login=updated_user.last_login,
        job_count=job_count
    )

@app.post("/users/change_password")
async def change_password(
    password_data: schemas.PasswordChange,
    current_user: schemas.User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """Change current user password"""
    # Verify current password
    if not crud.verify_password(password_data.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    # Update password
    crud.update_user_password(db, current_user.id, password_data.new_password)
    return {"message": "Password changed successfully"}

# --- Admin User Management ---

@app.get("/admin/users", response_model=schemas.UserListResponse)
async def get_all_users(
    skip: int = 0,
    limit: int = 100,
    include_inactive: bool = False,
    search: Optional[str] = Query(default=None, max_length=100),
    current_user: schemas.User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Get all users (Admin only)"""
    users, total = crud.get_users(
        db,
        skip=skip,
        limit=limit,
        include_inactive=include_inactive,
        search=search,
    )
    user_responses = []

    for user in users:
        job_count = db.query(models.Job).filter(models.Job.owner_id == user.id).count()
        user_responses.append(schemas.UserResponse(
            id=user.id,
            username=user.username,
            email=user.email,
            full_name=user.full_name,
            role=user.role,
            is_active=user.is_active,
            created_at=user.created_at,
            last_login=user.last_login,
            job_count=job_count
        ))

    return schemas.UserListResponse(items=user_responses, total=total)

@app.get("/admin/users/{user_id}", response_model=schemas.UserResponse)
async def get_user_by_id(
    user_id: int,
    current_user: schemas.User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Get specific user by ID (Admin only)"""
    user = crud.get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    job_count = db.query(models.Job).filter(models.Job.owner_id == user.id).count()
    return schemas.UserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at,
        last_login=user.last_login,
        job_count=job_count
    )

@app.put("/admin/users/{user_id}", response_model=schemas.UserResponse)
async def update_user_by_admin(
    user_id: int,
    user_update: schemas.UserUpdate,
    current_user: schemas.User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Update user by admin"""
    # Check if user exists
    target_user = crud.get_user_by_id(db, user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    # Only super admin can change roles to super_admin
    if user_update.role == models.UserRole.SUPER_ADMIN and current_user.role != models.UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only super admin can assign super admin role")

    # Prevent admin from deactivating themselves or other admins (unless super admin)
    if (user_id == current_user.id and
        user_update.is_active == False and
        current_user.role != models.UserRole.SUPER_ADMIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot deactivate yourself")

    # Check if email is already taken by another user
    if user_update.email and user_update.email != target_user.email:
        existing_user = crud.get_user_by_email(db, email=user_update.email)
        if existing_user and existing_user.id != user_id:
            raise HTTPException(status_code=400, detail="Email already registered")

    updated_user = crud.update_user(db, user_id, user_update)
    if not updated_user:
        raise HTTPException(status_code=404, detail="User not found")

    job_count = db.query(models.Job).filter(models.Job.owner_id == updated_user.id).count()
    return schemas.UserResponse(
        id=updated_user.id,
        username=updated_user.username,
        email=updated_user.email,
        full_name=updated_user.full_name,
        role=updated_user.role,
        is_active=updated_user.is_active,
        created_at=updated_user.created_at,
        last_login=updated_user.last_login,
        job_count=job_count
    )

@app.post("/admin/users/{user_id}/reset_password")
async def reset_user_password(
    user_id: int,
    password_data: schemas.PasswordReset,
    current_user: schemas.User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Reset user password (Admin only)"""
    # Check if user exists
    target_user = crud.get_user_by_id(db, user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    # Update password
    crud.update_user_password(db, user_id, password_data.new_password)
    return {"message": "Password reset successfully"}

@app.post("/admin/users/{user_id}/activate")
async def activate_user(
    user_id: int,
    current_user: schemas.User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Activate user account (Admin only)"""
    user = crud.activate_user(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "User activated successfully"}

@app.post("/admin/users/{user_id}/deactivate")
async def deactivate_user(
    user_id: int,
    current_user: schemas.User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Deactivate user account (Admin only)"""
    target_user = crud.get_user_by_id(db, user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    # Prevent deactivating yourself unless you're super admin
    if user_id == current_user.id and current_user.role != models.UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot deactivate yourself")

    # Prevent admin from deactivating other admins unless super admin
    if (target_user.role in [models.UserRole.ADMIN, models.UserRole.SUPER_ADMIN] and
        current_user.role != models.UserRole.SUPER_ADMIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only super admin can deactivate admin accounts")

    user = crud.deactivate_user(db, user_id)
    return {"message": "User deactivated successfully"}

@app.get("/admin/stats", response_model=dict)
async def get_admin_stats(
    current_user: schemas.User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Get system statistics (Admin only)"""
    total_users = crud.get_user_count(db, include_inactive=True)
    active_users = crud.get_user_count(db, include_inactive=False)
    total_jobs = db.query(models.Job).count()
    completed_jobs = db.query(models.Job).filter(models.Job.status == "completed").count()
    processing_jobs = db.query(models.Job).filter(models.Job.status == "processing").count()
    failed_jobs = db.query(models.Job).filter(models.Job.status == "failed").count()

    return {
        "users": {
            "total": total_users,
            "active": active_users,
            "inactive": total_users - active_users
        },
        "jobs": {
            "total": total_jobs,
            "completed": completed_jobs,
            "processing": processing_jobs,
            "failed": failed_jobs
        }
    }
