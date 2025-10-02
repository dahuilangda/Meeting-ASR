from fastapi import Depends, FastAPI, HTTPException, status, File, UploadFile, BackgroundTasks
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from typing import List
import shutil
import os
from jose import JWTError, jwt
from dotenv import load_dotenv
from fastapi.staticfiles import StaticFiles

from database import crud, models, schemas
from database.database import SessionLocal, engine
import security

# Load environment variables from .env file FIRST
load_dotenv()

# HF_ENDPOINT - commented out for now due to connection issues
os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"

# --- App and DB Setup ---
models.Base.metadata.create_all(bind=engine)
app = FastAPI()

# Add CORS middleware
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

# Mount the uploads directory to serve audio files
app.mount("/uploads", StaticFiles(directory="backend/uploads"), name="uploads")

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
    return user

@app.post("/register", response_model=schemas.User)
def register_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = crud.get_user_by_username(db, username=user.username)
    if db_user: raise HTTPException(status_code=400, detail="Username already registered")
    return crud.create_user(db=db, user=user)

@app.post("/token", response_model=schemas.Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = crud.get_user_by_username(db, username=form_data.username)
    if not user or not security.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect username or password")
    access_token = security.create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer"}

# --- File Processing Workflow ---
import torch
from pyannote.audio import Pipeline
import pandas as pd
import subprocess
import tempfile
import os
import librosa
import numpy as np
from transformers import pipeline

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
            print(f"Error converting audio file: {e}")
            # If conversion fails, try to proceed with original file
            return filepath
    else:
        # For already compatible format, return as-is
        return filepath

def optimize_transcript_with_llm(transcript: str) -> str:
    """
    Uses a large language model to optimize the transcript.
    This can include fixing grammatical errors, improving sentence structure, 
    clarifying unclear segments, and organizing the conversation better.
    """
    import os
    from openai import OpenAI
    import httpx
    import ssl
    
    # Initialize OpenAI client, handling potential SSL issues with custom endpoints
    try:
        # First, try with default settings
        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"), base_url=os.getenv("OPENAI_BASE_URL"))
    except Exception as init_error:
        print(f"Initial OpenAI client setup failed: {init_error}")
        # Handle SSL certificate issues for custom endpoints
        try:
            import urllib3
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
            
            # Create httpx client with SSL verification disabled for custom endpoints
            http_client = httpx.Client(
                verify=False,  # Disable SSL verification for self-signed certificates
                timeout=60.0   # Increase timeout
            )
            
            client = OpenAI(
                api_key=os.getenv("OPENAI_API_KEY"), 
                base_url=os.getenv("OPENAI_BASE_URL"),
                http_client=http_client
            )
        except Exception as e:
            print(f"Error initializing OpenAI client: {e}")
            # If client initialization fails completely, return original transcript
            return transcript
    
    try:
        # Create a prompt to optimize the transcript
        prompt = f"""
        请优化以下会议转录文本。这是一段语音转文字的结果，可能存在一些错误和不连贯的地方。
        请进行以下处理：
        1. 修正明显的错别字和语法错误
        2. 保持说话人标识不变（例如[SPEAKER_00]、[SPEAKER_01]等）
        3. 让对话更连贯和易读
        4. 保持原文的核心意思不变
        5. 如果有不完整的句子，根据上下文补全或合理组织
        
        以下是需要优化的转录文本：
        {transcript}
        
        请输出优化后的转录文本：
        """
        
        chat_completion = client.chat.completions.create(
            messages=[
                {"role": "system", "content": "You are an expert at improving speech-to-text transcriptions. You maintain speaker labels while improving readability, fixing obvious errors, and making the conversation more coherent."},
                {"role": "user", "content": prompt}
            ],
            model=os.getenv("OPENAI_MODEL_NAME"),
            temperature=0.3,  # Lower temperature for more consistent output
            timeout=600  # Increase timeout for longer operations
        )
        
        optimized_text = chat_completion.choices[0].message.content
        return optimized_text
        
    except Exception as e:
        print(f"Error optimizing transcript with LLM: {e}")
        # If LLM optimization fails, return the original transcript
        return transcript

def process_audio_file(job_id: int, filepath: str, db_session_class):
    db = db_session_class()
    converted_file = None  # Track converted file for cleanup
    
    try:
        print(f"[Job {job_id}] Starting transcription & diarization for {filepath}")
        hf_token = os.getenv("HF_TOKEN")
        if not hf_token: raise ValueError("HF_TOKEN not set in .env file")

        # Ensure the audio file is in a compatible format
        converted_file = ensure_audio_format(filepath)
        print(f"[Job {job_id}] Using converted file: {converted_file}")
        
        device = "cuda" if torch.cuda.is_available() else "cpu"
        
        diarization_pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", use_auth_token=hf_token)
        diarization_pipeline.to(torch.device(device))
        
        print(f"[Job {job_id}] Using device: {device}")
        
        # Run diarization first to identify speakers
        print(f"[Job {job_id}] Running Pyannote diarization...")
        diarization = diarization_pipeline(converted_file)

        # Get speaker timestamps
        speaker_segments = [[turn.start, turn.end, speaker] for turn, _, speaker in diarization.itertracks(yield_label=True)]
        speaker_df = pd.DataFrame(speaker_segments, columns=['start', 'end', 'speaker'])
        
        # DEBUG: Print detailed information about speaker segments
        print(f"[Job {job_id}] Found {len(speaker_segments)} speaker segments: {set([s[2] for s in speaker_segments])}")
        print(f"[Job {job_id}] First 5 speaker segments: {speaker_segments[:5] if len(speaker_segments) > 0 else 'None'}")
        print(f"[Job {job_id}] Sample of speaker segments:")
        for i, seg in enumerate(speaker_segments[:10]):  # Print first 10 segments as sample
            print(f"  [{i}] {seg[0]:.2f}s-{seg[1]:.2f}s: {seg[2]} (duration: {seg[1]-seg[0]:.2f}s)")
        
        # Load the audio file to get its duration for alignment and segment processing
        audio_data, sample_rate = librosa.load(converted_file)
        audio_duration = librosa.get_duration(y=audio_data, sr=sample_rate)
        
        # Initialize the FunASR model once for the entire process
        from funasr import AutoModel
        print(f"[Job {job_id}] Using FunASR for Chinese ASR with punctuation...")
        
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
                print(f"[Job {job_id}] Primary model failed with tensor size error, trying fallback model...")
                asr_model = AutoModel(
                    model="damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
                    model_revision="v2.0.4",
                    punc_model="ct-punc",
                    punc_model_revision="v2.0.4",
                )
            elif "shape" in str(e).lower() or "dimension" in str(e).lower():
                print(f"[Job {job_id}] Model failed with shape error, trying simpler configuration...")
                asr_model = AutoModel(
                    model="damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
                    punc_model="ct-punc",
                )
            else:
                raise e
        
        # Process each speaker segment individually to ensure alignment
        print(f"[Job {job_id}] Processing {len(speaker_segments)} speaker segments for alignment...")
        
        # Create temporary files for each segment and transcribe individually
        import tempfile
        import soundfile as sf
        
        result_segments = []
        total_coverage = 0
        
        for i, (start_time, end_time, speaker_label) in enumerate(speaker_segments):
            segment_duration = end_time - start_time
            total_coverage += segment_duration
            
            print(f"[Job {job_id}] Processing speaker segment {i+1}/{len(speaker_segments)}: {speaker_label} at {start_time:.2f}s-{end_time:.2f}s ({segment_duration:.2f}s)")
            
            # Extract the audio segment
            segment_start_sample = int(start_time * sample_rate)
            segment_end_sample = int(end_time * sample_rate)
            
            # Ensure we don't go out of bounds
            segment_end_sample = min(segment_end_sample, len(audio_data))
            segment_audio = audio_data[segment_start_sample:segment_end_sample]
            
            # Skip very short segments (less than 0.1 seconds) to avoid processing errors
            if len(segment_audio) < sample_rate * 0.1:  # Less than 0.1 seconds
                print(f"[Job {job_id}] Skipping very short segment {start_time:.2f}s-{end_time:.2f}s")
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
                    print(f"[Job {job_id}] Transcribed segment for {speaker_label}: '{segment_text[:100]}...' ({segment_duration:.2f}s)")
                else:
                    print(f"[Job {job_id}] No text extracted for segment {i+1}, speaker {speaker_label}")
                
            except Exception as e:
                print(f"[Job {job_id}] Error processing speaker segment {i+1}: {e}")
                import traceback
                traceback.print_exc()  # Print full stack trace for debugging
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
        print(f"[Job {job_id}] Total speaker coverage: {total_coverage:.2f}s out of {audio_duration:.2f}s ({coverage_percentage:.1f}%)")
        
        # If no segments were processed successfully, create a fallback
        if not result_segments:
            print(f"[Job {job_id}] No valid segments processed, running full audio transcription as fallback...")
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
        for seg in result_segments:
            sentences_with_timing.append({
                'speaker': seg['speaker'],
                'text': seg['text'],
                'start_time': seg['start_time'],
                'end_time': seg['end_time']
            })
        
        timing_info_json = json.dumps(sentences_with_timing)

        # Store the transcript with native punctuation
        crud.update_job_transcript(db, job_id=job_id, transcript=formatted_transcript, timing_info=timing_info_json)
        print(f"[Job {job_id}] Processing completed with speakers: {set([seg['speaker'] for seg in result_segments])}")
        print(f"[Job {job_id}] Result segments: {len(result_segments)}")

    except Exception as e:
        print(f"[Job {job_id}] Processing failed: {e}")
        import traceback
        traceback.print_exc()  # Print full stack trace for debugging
        crud.update_job_status(db, job_id=job_id, status="failed")
    finally:
        db.close()
        # NOTE: We're keeping the original file for playback in the UI
        # Clean up converted file if it was created (temporary conversion file)
        if converted_file and os.path.exists(converted_file) and converted_file != filepath: 
            os.remove(converted_file)

@app.post("/upload", response_model=schemas.JobBase)
def upload_file(background_tasks: BackgroundTasks, file: UploadFile = File(...), current_user: schemas.User = Depends(get_current_user), db: Session = Depends(get_db)):
    upload_dir = "backend/uploads"
    os.makedirs(upload_dir, exist_ok=True)
    
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
    
    with open(filepath, "wb") as buffer: shutil.copyfileobj(file.file, buffer)
    job = crud.create_job(db, filename=filename, owner_id=current_user.id)
    background_tasks.add_task(process_audio_file, job.id, filepath, SessionLocal)
    return job

@app.get("/jobs", response_model=List[schemas.JobBase])
def get_user_jobs(current_user: schemas.User = Depends(get_current_user), db: Session = Depends(get_db)):
    return crud.get_jobs_by_owner(db, owner_id=current_user.id)

@app.get("/jobs/{job_id}", response_model=schemas.Job)
def get_job_details(job_id: int, current_user: schemas.User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = crud.get_job(db, job_id=job_id, owner_id=current_user.id)
    if not job: raise HTTPException(status_code=404, detail="Job not found")
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
    
    # Check if audio file exists in uploads
    import os
    upload_dir = "backend/uploads"
    audio_path = os.path.join(upload_dir, job.filename)
    
    if not os.path.exists(audio_path):
        raise HTTPException(status_code=404, detail="Audio file not found")
    
    # Redirect to the static file path
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url=f"/uploads/{job.filename}")

# --- Post-processing Endpoints ---
from pydantic import BaseModel
from openai import OpenAI
import httpx
import os

# Print environment variables for debugging
print(f'DEBUG: OPENAI_BASE_URL={os.getenv("OPENAI_BASE_URL")}')
print(f'DEBUG: OPENAI_MODEL_NAME={os.getenv("OPENAI_MODEL_NAME")}')
print(f'DEBUG: OPENAI_API_KEY is set: {bool(os.getenv("OPENAI_API_KEY"))}')

class TranslateJobRequest(BaseModel):
    target_language: str

@app.post("/jobs/{job_id}/summarize", response_model=schemas.Job)
async def summarize_job(job_id: int, current_user: schemas.User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = crud.get_job(db, job_id=job_id, owner_id=current_user.id)
    if not job: raise HTTPException(status_code=404, detail="Job not found")
    if not job.transcript: raise HTTPException(status_code=400, detail="Job has no transcript to summarize.")

    try:
        # Initialize OpenAI client with proper error handling similar to optimize_transcript_with_llm
        from openai import OpenAI
        import urllib3
        import httpx
        import os
        
        # Initialize OpenAI client with proper error handling
        client = None
        try:
            # First, try with default settings
            client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"), base_url=os.getenv("OPENAI_BASE_URL"))
        except Exception as init_error:
            print(f"Initial OpenAI client setup failed: {init_error}")
            # Handle SSL certificate issues for custom endpoints
            try:
                urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
                
                # Create httpx client with SSL verification disabled for custom endpoints
                http_client = httpx.Client(
                    verify=False,  # Disable SSL verification for self-signed certificates
                    timeout=60.0   # Increase timeout
                )
                
                client = OpenAI(
                    api_key=os.getenv("OPENAI_API_KEY"), 
                    base_url=os.getenv("OPENAI_BASE_URL"),
                    http_client=http_client
                )
            except Exception as e:
                print(f"Error initializing OpenAI client: {e}")
                raise HTTPException(status_code=500, detail=f"Failed to initialize OpenAI client: {e}")
        
        chat_completion = client.chat.completions.create(
            messages=[
                {"role": "system", "content": "You are an expert meeting assistant. Please summarize the following meeting transcript, identifying key discussion points, decisions made, and action items. Format it clearly."}, 
                {"role": "user", "content": job.transcript}
            ],
            model=os.getenv("OPENAI_MODEL_NAME"),
            timeout=600  # Increase timeout for longer operations
        )
        summary = chat_completion.choices[0].message.content
        crud.update_job_summary(db, job_id=job_id, summary=summary)
        
        # Return the updated job with the summary
        updated_job = crud.get_job(db, job_id=job_id, owner_id=current_user.id)
        return updated_job
    except Exception as e:
        print(f"Error in summarize_job: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate summary: {e}")

@app.post("/jobs/{job_id}/translate")
async def translate_job(job_id: int, request: TranslateJobRequest, current_user: schemas.User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = crud.get_job(db, job_id=job_id, owner_id=current_user.id)
    if not job: raise HTTPException(status_code=404, detail="Job not found")
    if not job.transcript: raise HTTPException(status_code=400, detail="Job has no transcript to translate.")

    try:
        # Initialize OpenAI client with proper error handling similar to optimize_transcript_with_llm
        from openai import OpenAI
        import urllib3
        import httpx
        import os
        
        # Initialize OpenAI client with proper error handling
        client = None
        try:
            # First, try with default settings
            client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"), base_url=os.getenv("OPENAI_BASE_URL"))
        except Exception as init_error:
            print(f"Initial OpenAI client setup failed: {init_error}")
            # Handle SSL certificate issues for custom endpoints
            try:
                urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
                
                # Create httpx client with SSL verification disabled for custom endpoints
                http_client = httpx.Client(
                    verify=False,  # Disable SSL verification for self-signed certificates
                    timeout=60.0   # Increase timeout
                )
                
                client = OpenAI(
                    api_key=os.getenv("OPENAI_API_KEY"), 
                    base_url=os.getenv("OPENAI_BASE_URL"),
                    http_client=http_client
                )
            except Exception as e:
                print(f"Error initializing OpenAI client: {e}")
                raise HTTPException(status_code=500, detail=f"Failed to initialize OpenAI client: {e}")
        
        chat_completion = client.chat.completions.create(
            messages=[
                {"role": "system", "content": f"Translate the following text to {request.target_language}."},
                {"role": "user", "content": job.transcript}
            ],
            model=os.getenv("OPENAI_MODEL_NAME"),
            timeout=600  # Increase timeout for longer operations
        )
        translated_text = chat_completion.choices[0].message.content
        return {"translated_text": translated_text}
    except Exception as e:
        print(f"Error in translate_job: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate translation: {e}")

class SegmentTranslateRequest(BaseModel):
    target_language: str
    text: str

@app.post("/jobs/{job_id}/translate_segment")
async def translate_segment(job_id: int, request: SegmentTranslateRequest, current_user: schemas.User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = crud.get_job(db, job_id=job_id, owner_id=current_user.id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    try:
        # Initialize OpenAI client with proper error handling similar to optimize_transcript_with_llm
        from openai import OpenAI
        import urllib3
        import httpx
        import os
        
        # Initialize OpenAI client with proper error handling
        client = None
        try:
            # First, try with default settings
            client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"), base_url=os.getenv("OPENAI_BASE_URL"))
        except Exception as init_error:
            print(f"Initial OpenAI client setup failed: {init_error}")
            # Handle SSL certificate issues for custom endpoints
            try:
                urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
                
                # Create httpx client with SSL verification disabled for custom endpoints
                http_client = httpx.Client(
                    verify=False,  # Disable SSL verification for self-signed certificates
                    timeout=60.0   # Increase timeout
                )
                
                client = OpenAI(
                    api_key=os.getenv("OPENAI_API_KEY"), 
                    base_url=os.getenv("OPENAI_BASE_URL"),
                    http_client=http_client
                )
            except Exception as e:
                print(f"Error initializing OpenAI client: {e}")
                raise HTTPException(status_code=500, detail=f"Failed to initialize OpenAI client: {e}")
        
        chat_completion = client.chat.completions.create(
            messages=[
                {"role": "system", "content": f"Translate the following text to {request.target_language}."},
                {"role": "user", "content": request.text}
            ],
            model=os.getenv("OPENAI_MODEL_NAME"),
            timeout=600  # Increase timeout for longer operations
        )
        translated_text = chat_completion.choices[0].message.content
        return {"translated_text": translated_text}
    except Exception as e:
        print(f"Error in translate_segment: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate translation: {e}")

@app.post("/jobs/{job_id}/optimize", response_model=schemas.Job)
async def optimize_job_transcript(job_id: int, current_user: schemas.User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = crud.get_job(db, job_id=job_id, owner_id=current_user.id)
    if not job: raise HTTPException(status_code=404, detail="Job not found")
    if not job.transcript: raise HTTPException(status_code=400, detail="Job has no transcript to optimize.")

    try:
        # Use the existing optimization function
        optimized_transcript = optimize_transcript_with_llm(job.transcript)
        crud.update_job_transcript(db, job_id=job_id, transcript=optimized_transcript)
        
        # Return the updated job with optimized transcript
        updated_job = crud.get_job(db, job_id=job_id, owner_id=current_user.id)
        return updated_job
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to optimize transcript: {e}")

@app.post("/jobs/{job_id}/optimize_segment", response_model=dict)
async def optimize_segment(job_id: int, request: dict, current_user: schemas.User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Verify that the job belongs to the current user
    job = crud.get_job(db, job_id=job_id, owner_id=current_user.id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    try:
        # Extract text and speaker from the request
        text = request.get("text", "")
        speaker = request.get("speaker", "")
        
        # Create a prompt that includes the speaker context to maintain proper speaker labels
        import os
        from openai import OpenAI
        import httpx
        
        # Initialize OpenAI client
        try:
            # First, try with default settings
            client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"), base_url=os.getenv("OPENAI_BASE_URL"))
        except Exception as init_error:
            print(f"Initial OpenAI client setup failed: {init_error}")
            # Handle SSL certificate issues for custom endpoints
            try:
                import urllib3
                urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
                
                # Create httpx client with SSL verification disabled for custom endpoints
                http_client = httpx.Client(
                    verify=False,  # Disable SSL verification for self-signed certificates
                    timeout=60.0   # Increase timeout
                )
                
                client = OpenAI(
                    api_key=os.getenv("OPENAI_API_KEY"), 
                    base_url=os.getenv("OPENAI_BASE_URL"),
                    http_client=http_client
                )
            except Exception as e:
                print(f"Error initializing OpenAI client: {e}")
                # If client initialization fails completely, return original text
                return {"optimized_text": text}
        
        # Create prompt with context about maintaining speaker labels
        prompt = f"""
        请优化以下会议转录段落。这是{speaker}的发言，是一段语音转文字的结果，可能存在一些错误和不连贯的地方。
        请进行以下处理：
        1. 修正明显的错别字和语法错误
        2. 让表达更连贯和易读
        3. 保持说话人标识不变（例如[{speaker}]）
        4. 保持原文的核心意思不变
        5. 如果有不完整的句子，根据上下文补全或合理组织
        6. 确保优化后的内容适合会议记录的形式
        7. 保持句子的完整性，不要截断

        以下是需要优化的转录段落：
        {text}

        请输出优化后的转录段落：
        """
        
        chat_completion = client.chat.completions.create(
            messages=[
                {"role": "system", "content": "You are an expert at improving speech-to-text transcriptions. You maintain speaker context while improving readability, fixing obvious errors, and making the conversation more coherent."},
                {"role": "user", "content": prompt}
            ],
            model=os.getenv("OPENAI_MODEL_NAME") or "gpt-3.5-turbo",  # Fallback to gpt-3.5-turbo if not specified
            temperature=0.3,  # Lower temperature for more consistent output
            timeout=60  # Increase timeout for longer operations
        )
        
        optimized_text = chat_completion.choices[0].message.content
        return {"optimized_text": optimized_text}
        
    except Exception as e:
        print(f"Error optimizing segment: {e}")
        # If LLM optimization fails, return the original text
        return {"optimized_text": text}