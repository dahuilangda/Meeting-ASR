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
            model=os.getenv("OPENAI_MODEL_NAME") or "gpt-3.5-turbo",  # Fallback to gpt-3.5-turbo if not specified
            temperature=0.3,  # Lower temperature for more consistent output
            timeout=60  # Increase timeout for longer operations
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

        # Use only the specified FunASR model for ASR (no backup models)
        transcription_result = None
        full_transcript = ""
        
        # Use FunASR with a stable model for Chinese with punctuation and word-level timestamps
        from funasr import AutoModel
        print(f"[Job {job_id}] Using FunASR for Chinese ASR with punctuation...")
        
        # Try the primary model first, with additional parameters to prevent tensor size issues
        # Enable return of timestamps for better alignment with speaker diarization
        try:
            model = AutoModel(
                model="iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
                model_revision="v2.0.4",
                vad_model="fsmn-vad",
                vad_model_revision="v2.0.4",
                punc_model="ct-punc",  # 标点符号模型
                punc_model_revision="v2.0.4",
            )
            
            # Generate with specific parameters to avoid tensor size mismatch and get word-level timestamps
            res = model.generate(
                input=converted_file,
                hotword="",
                token_max_batch_size=1,  # Process one audio file at a time
                return_raw_dict=True,    # Return raw dictionary for access to timestamps
                output_dir=None,         # Don't save to disk
                batch_size=1,            # Process one at a time
                mode="2pass",            # Use two-pass decoding if supported
            )
        except RuntimeError as e:
            if "Sizes of tensors must match" in str(e):
                print(f"[Job {job_id}] Primary model failed with tensor size error, trying fallback model...")
                # Fallback to another model that doesn't have tensor size issues
                model = AutoModel(
                    model="damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
                    model_revision="v2.0.4",
                    punc_model="ct-punc",
                    punc_model_revision="v2.0.4",
                )
                
                res = model.generate(
                    input=converted_file,
                    return_raw_dict=True,
                    batch_size=1
                )
            elif "shape" in str(e).lower() or "dimension" in str(e).lower():
                print(f"[Job {job_id}] Model failed with shape error, trying simpler configuration...")
                # Additional fallback with minimal parameters
                model = AutoModel(
                    model="damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
                    punc_model="ct-punc",
                )
                
                res = model.generate(
                    input=converted_file,
                    batch_size=1
                )
            else:
                raise e

        # Extract the transcription result with punctuation
        # Also try to extract timestamp information if available for better alignment
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
        
        transcription_result = {'text': full_transcript.strip(), 'timestamp_info': word_level_info}

        print(f"[Job {job_id}] Aligning ASR and diarization results...")
        # Get speaker timestamps
        speaker_segments = [[turn.start, turn.end, speaker] for turn, _, speaker in diarization.itertracks(yield_label=True)]
        speaker_df = pd.DataFrame(speaker_segments, columns=['start', 'end', 'speaker'])
        
        # DEBUG: Print detailed information about speaker segments
        print(f"[Job {job_id}] Found {len(speaker_segments)} speaker segments: {set([s[2] for s in speaker_segments])}")
        print(f"[Job {job_id}] First 5 speaker segments: {speaker_segments[:5] if len(speaker_segments) > 0 else 'None'}")
        print(f"[Job {job_id}] Sample of speaker segments:")
        for i, seg in enumerate(speaker_segments[:10]):  # Print first 10 segments as sample
            print(f"  [{i}] {seg[0]:.2f}s-{seg[1]:.2f}s: {seg[2]} (duration: {seg[1]-seg[0]:.2f}s)")
        
        # DEBUG: Print FunASR result structure
        print(f"[Job {job_id}] FunASR result type: {type(res)}")
        if isinstance(res, list):
            print(f"[Job {job_id}] FunASR result list length: {len(res)}")
            if len(res) > 0:
                print(f"[Job {job_id}] First result item keys: {list(res[0].keys()) if isinstance(res[0], dict) else 'Not a dict'}")
        else:
            print(f"[Job {job_id}] FunASR result keys: {list(res.keys()) if isinstance(res, dict) else type(res)}")
        
        # DEBUG: Print timestamp info if available
        word_level_info = transcription_result.get('timestamp_info', [])
        print(f"[Job {job_id}] Available timestamp info: {len(word_level_info)} items")
        
        # Get the transcription text with punctuation
        if transcription_result and 'text' in transcription_result:
            full_transcript = transcription_result['text']
            print(f"[Job {job_id}] Transcript (first 200 chars): {full_transcript[:200]}...")  # Print first 200 chars for debugging
            print(f"[Job {job_id}] Transcript length: {len(full_transcript)} characters")
        else:
            # Fallback if ASR failed completely
            raise Exception("FunASR failed, unable to transcribe audio")
        
        # Load the audio file to get its duration for alignment
        import librosa
        audio_data, sample_rate = librosa.load(converted_file)
        audio_duration = librosa.get_duration(y=audio_data, sr=sample_rate)
        
        print(f"[Job {job_id}] Audio duration: {audio_duration:.2f} seconds")
        
        # Split the full text into segments to assign to speakers
        import re
        
        # First try to split by punctuation followed by space (original approach)
        potential_segments = re.split(r'(?<=[.!?。！？])\s+', full_transcript)
        
        # If this doesn't create multiple segments, try splitting just by punctuation
        if len(potential_segments) <= 1:
            potential_segments = re.split(r'[.!?。！？]', full_transcript)
        
        # If we still don't have multiple segments, try using jieba for Chinese text segmentation
        if len(potential_segments) <= 1:
            try:
                import jieba
                # Use jieba to segment the Chinese text into more meaningful chunks
                # This will break the text into smaller, more semantic units
                text_list = list(jieba.cut(full_transcript))
                
                # Group the jieba segments into chunks to create multiple text segments
                chunk_size = 20  # Number of jieba tokens per segment
                potential_segments = []
                for i in range(0, len(text_list), chunk_size):
                    chunk = "".join(text_list[i:i+chunk_size]).strip()
                    if chunk:
                        potential_segments.append(chunk)
            except ImportError:
                # If jieba is not available, fall back to character-based splitting
                # Split the transcript into fixed-length chunks to ensure we have multiple segments
                chunk_size = 100  # Number of characters per segment
                full_text = full_transcript.strip()
                potential_segments = []
                for i in range(0, len(full_text), chunk_size):
                    potential_segments.append(full_text[i:i+chunk_size])
        
        potential_segments = [seg.strip() for seg in potential_segments if seg.strip()]
        
        print(f"[Job {job_id}] Split transcript into {len(potential_segments)} segments")
        
        # Create a precise time-based alignment between speakers and text
        result_segments = []
        
        # Use timestamp information from ASR if available for precise alignment
        word_level_info = transcription_result.get('timestamp_info', [])
        
        if word_level_info and len(speaker_segments) > 0:
            print(f"[Job {job_id}] Using word-level timestamp information for alignment ({len(word_level_info)} word segments)")
            
            # Group word-level results by speaker based on diarization
            result_segments = []
            
            # Process each word/timestamp segment and assign to the appropriate speaker
            for word_info in word_level_info:
                if 'start' in word_info and 'end' in word_info and 'text' in word_info:
                    word_start = word_info['start']
                    word_end = word_info['end']
                    word_text = word_info['text']
                    
                    # Find the speaker that was active during this word's time
                    best_speaker = "UNKNOWN"
                    best_overlap = -1.0
                    
                    # Calculate overlap with each speaker segment
                    for start, end, speaker_label in speaker_segments:
                        overlap_start = max(word_start, start)
                        overlap_end = min(word_end, end)
                        
                        if overlap_start < overlap_end:
                            overlap_duration = overlap_end - overlap_start
                            if best_overlap < 0 or overlap_duration > best_overlap:
                                best_overlap = overlap_duration
                                best_speaker = speaker_label
                    
                    # If no speaker found in interval, find the one active at midpoint
                    if best_speaker == "UNKNOWN" or best_overlap < 0:
                        mid_time = (word_start + word_end) / 2
                        for start, end, speaker_label in speaker_segments:
                            if start <= mid_time <= end:
                                best_speaker = speaker_label
                                break
                    
                    # If still no speaker found, assign to first available speaker
                    if best_speaker == "UNKNOWN":
                        best_speaker = speaker_segments[0][2] if speaker_segments else "UNKNOWN"
                    
                    # Add this word/segment to results
                    result_segments.append({
                        'text': word_text,
                        'speaker': best_speaker,
                        'start_time': word_start,
                        'end_time': word_end
                    })
            
            # Merge consecutive segments from the same speaker for readability
            if result_segments:
                merged_segments = []
                current_speaker = result_segments[0]['speaker']
                current_text = result_segments[0]['text']
                current_start = result_segments[0]['start_time']
                current_end = result_segments[0]['end_time']
                
                for i in range(1, len(result_segments)):
                    segment = result_segments[i]
                    if segment['speaker'] == current_speaker:
                        # Same speaker, merge the text
                        current_text += " " + segment['text']
                        current_end = segment['end_time']
                    else:
                        # Different speaker, save the current segment and start a new one
                        merged_segments.append({
                            'text': current_text.strip(),
                            'speaker': current_speaker,
                            'start_time': current_start,
                            'end_time': current_end
                        })
                        current_speaker = segment['speaker']
                        current_text = segment['text']
                        current_start = segment['start_time']
                        current_end = segment['end_time']
                
                # Add the last segment
                merged_segments.append({
                    'text': current_text.strip(),
                    'speaker': current_speaker,
                    'start_time': current_start,
                    'end_time': current_end
                })
                
                result_segments = merged_segments
        else:
            # When no timestamp info is available, use a more accurate time-slot approach
            print(f"[Job {job_id}] No word-level timestamp information available, using improved time-slot alignment")
            
            # potential_text_segments was already computed earlier, so we reuse it
            print(f"[Job {job_id}] Split transcript into {len(potential_segments)} text segments, with {len(speaker_segments)} speaker segments")
            
            if potential_segments and len(speaker_segments) > 0:
                # Create a timeline of speaker activity
                # Process each speaker segment and assign text based on when they spoke
                result_segments = []
                
                # Group consecutive speaker segments by the same speaker for better continuity
                # First, sort speaker segments by start time
                sorted_speaker_segments = sorted(speaker_segments, key=lambda x: x[0])
                
                # DEBUG: Check speaker distribution
                speakers_present = set([seg[2] for seg in sorted_speaker_segments])
                print(f"[Job {job_id}] Unique speakers in timeline: {speakers_present}")
                
                # Now, distribute text segments according to speaker timeline
                # We'll use a time-based mapping where we assign text to speakers based on when they were active
                text_idx = 0
                
                # Group text by speaker time slots
                for start, end, speaker in sorted_speaker_segments:
                    if text_idx >= len(potential_segments):
                        break  # No more text to assign
                    
                    # Calculate which text segments should belong to this speaker's time slot
                    slot_duration = end - start
                    total_duration = audio_duration
                    
                    # Calculate the portion of text that falls in this time slot
                    text_start_idx = int((start / total_duration) * len(potential_segments))
                    text_end_idx = int((end / total_duration) * len(potential_segments))
                    
                    # Ensure indices are valid
                    text_start_idx = max(text_start_idx, text_idx)
                    text_end_idx = min(text_end_idx, len(potential_segments))
                    text_end_idx = max(text_end_idx, text_start_idx + 1)  # Ensure at least one segment
                    
                    # Get text segments for this speaker
                    if text_start_idx < len(potential_segments) and text_start_idx < text_end_idx:
                        speaker_texts = potential_segments[text_start_idx:text_end_idx]
                        combined_text = " ".join(speaker_texts).strip()
                        
                        if combined_text:
                            result_segments.append({
                                'text': combined_text,
                                'speaker': speaker,
                                'start_time': start,
                                'end_time': end
                            })
                        
                        # Update text index to continue from where we left off
                        text_idx = text_end_idx
                        print(f"[Job {job_id}] Assigned {len(speaker_texts)} text segments to {speaker} during {start:.2f}s-{end:.2f}s")
                
                # If there are remaining text segments that weren't assigned (might happen due to rounding)
                if text_idx < len(potential_segments):
                    remaining_texts = potential_segments[text_idx:]
                    if remaining_texts and result_segments:
                        # Append to the last speaker's segment
                        print(f"[Job {job_id}] Assigning {len(remaining_texts)} remaining text segments to the last speaker")
                        last_segment = result_segments[-1]
                        last_segment['text'] = last_segment['text'] + " " + " ".join(remaining_texts).strip()
                        last_segment['text'] = last_segment['text'].strip()
                    elif remaining_texts:
                        # If no segments yet, create one with UNKNOWN speaker
                        result_segments.append({
                            'text': " ".join(remaining_texts).strip(),
                            'speaker': "UNKNOWN",
                            'start_time': 0,
                            'end_time': audio_duration
                        })
            
            else:
                # If no segments found, assign full transcript to UNKNOWN
                result_segments.append({
                    'text': full_transcript,
                    'speaker': "UNKNOWN",
                    'start_time': 0,
                    'end_time': audio_duration
                })
        
        # If still no segments, assign full transcript to UNKNOWN
        if not result_segments:
            result_segments.append({
                'text': full_transcript,
                'speaker': "UNKNOWN",
                'start_time': 0,
                'end_time': audio_duration
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
print(f'DEBUG: OPENAI_BASE_URL={os.getenv("OPENAI_BASE_URL")}')
print(f'DEBUG: OPENAI_MODEL_NAME={os.getenv("OPENAI_MODEL_NAME")}')
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"), base_url=os.getenv("OPENAI_BASE_URL"))

class TranslateJobRequest(BaseModel):
    target_language: str

@app.post("/jobs/{job_id}/summarize", response_model=schemas.Job)
async def summarize_job(job_id: int, current_user: schemas.User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = crud.get_job(db, job_id=job_id, owner_id=current_user.id)
    if not job: raise HTTPException(status_code=404, detail="Job not found")
    if not job.transcript: raise HTTPException(status_code=400, detail="Job has no transcript to summarize.")

    try:
        chat_completion = client.chat.completions.create(
            messages=[
                {"role": "system", "content": "You are an expert meeting assistant. Please summarize the following meeting transcript, identifying key discussion points, decisions made, and action items. Format it clearly."}, 
                {"role": "user", "content": job.transcript}
            ],
            model=os.getenv("OPENAI_MODEL_NAME"),
        )
        summary = chat_completion.choices[0].message.content
        crud.update_job_summary(db, job_id=job_id, summary=summary)
        return job
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate summary: {e}")

@app.post("/jobs/{job_id}/translate")
async def translate_job(job_id: int, request: TranslateJobRequest, current_user: schemas.User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = crud.get_job(db, job_id=job_id, owner_id=current_user.id)
    if not job: raise HTTPException(status_code=404, detail="Job not found")
    if not job.transcript: raise HTTPException(status_code=400, detail="Job has no transcript to translate.")

    try:
        chat_completion = client.chat.completions.create(
            messages=[
                {"role": "system", "content": f"Translate the following text to {request.target_language}."},
                {"role": "user", "content": job.transcript}
            ],
            model=os.getenv("OPENAI_MODEL_NAME"),
        )
        translated_text = chat_completion.choices[0].message.content
        return {"translated_text": translated_text}
    except Exception as e:
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