#!/usr/bin/env python3
"""
Multi-user async job queue manager for Meeting ASR system
Provides proper job isolation, queuing, and real-time status updates
"""

import asyncio
import os
from datetime import datetime
from typing import Dict, List, Optional, Callable
from dataclasses import dataclass
from sqlalchemy.orm import Session
from concurrent.futures import ThreadPoolExecutor
import logging

from database.database import SessionLocal
from database.models import Job, JobStatus
from database.crud import update_job_status, update_job_progress

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class JobTask:
    """Represents a job in the queue"""
    job_id: int
    user_id: int
    file_path: str
    filename: str
    priority: int = 0
    created_at: datetime = None
    callback: Optional[Callable] = None
    status: str = JobStatus.QUEUED.value
    progress: float = 0.0
    error_message: Optional[str] = None

class JobQueueManager:
    """Multi-user job queue manager with proper isolation and async processing"""

    def __init__(self, max_concurrent_jobs: int = 3, max_queue_size: int = 50, max_jobs_per_user: Optional[int] = None):
        self.max_concurrent_jobs = max_concurrent_jobs
        self.max_queue_size = max_queue_size
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=max_queue_size)
        self.active_jobs: Dict[int, JobTask] = {}  # job_id -> JobTask
        self.user_job_counts: Dict[int, int] = {}  # user_id -> active job count
        self.executor = ThreadPoolExecutor(max_workers=max_concurrent_jobs)
        self.is_running = False
        self.websocket_connections: Dict[int, List] = {}  # user_id -> list of connections
        self._worker_task: Optional[asyncio.Task] = None
        self._process_handler: Optional[Callable[[int, str, Callable[[], Session]], None]] = None

        # Rate limiting per user (max 2 concurrent jobs per user)
        if max_jobs_per_user is not None and max_jobs_per_user > 0:
            self.max_jobs_per_user = max_jobs_per_user
        else:
            self.max_jobs_per_user = 2

    async def start(self):
        """Start the job queue manager"""
        if self.is_running:
            return

        self.is_running = True
        self._worker_task = asyncio.create_task(self._worker())
        logger.info("Job queue manager started")

    async def stop(self):
        """Stop the job queue manager"""
        self.is_running = False
        if self._worker_task:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass
        self.executor.shutdown(wait=True)
        logger.info("Job queue manager stopped")

    def set_processing_handler(self, handler: Callable[[int, str, Callable[[], Session]], None]) -> None:
        """Register the callable that performs the actual transcription work."""
        self._process_handler = handler

    async def add_job(self, job_id: int, user_id: int, file_path: str, filename: str,
                     priority: int = 0) -> bool:
        """Add a job to the queue"""
        # Check user rate limiting
        user_active_jobs = self.user_job_counts.get(user_id, 0)
        if user_active_jobs >= self.max_jobs_per_user:
            logger.warning(f"User {user_id} has too many active jobs: {user_active_jobs}")
            await self._notify_user(user_id, {
                "type": "error",
                "message": "Too many concurrent jobs. Please wait for current jobs to complete."
            })
            return False

        # Check queue capacity
        if self.queue.qsize() >= self.max_queue_size:
            logger.warning("Job queue is full")
            await self._notify_user(user_id, {
                "type": "error",
                "message": "Job queue is full. Please try again later."
            })
            return False

        # Create job task
        job_task = JobTask(
            job_id=job_id,
            user_id=user_id,
            file_path=file_path,
            filename=filename,
            priority=priority,
            created_at=datetime.now(),
            callback=self._process_handler
        )

        try:
            await self.queue.put(job_task)
            self.user_job_counts[user_id] = user_active_jobs + 1

            # Update database status
            with SessionLocal() as db:
                update_job_status(db, job_id, JobStatus.QUEUED)

            await self._notify_user(user_id, {
                "type": "job_queued",
                "job_id": job_id,
                "queue_position": self.queue.qsize(),
                "message": f"Job '{filename}' has been queued for processing"
            })

            logger.info(f"Job {job_id} added to queue for user {user_id}")
            return True

        except asyncio.QueueFull:
            logger.error(f"Failed to add job {job_id} to queue - queue full")
            return False

    async def cancel_job(self, job_id: int, user_id: int) -> bool:
        """Cancel a job if it hasn't started processing"""
        # Check if job is still in queue
        temp_queue = asyncio.Queue()
        cancelled = False

        while not self.queue.empty():
            try:
                job_task = self.queue.get_nowait()
                if job_task.job_id == job_id and job_task.user_id == user_id:
                    cancelled = True
                    # Update database status
                    with SessionLocal() as db:
                        update_job_status(db, job_id, JobStatus.CANCELLED)
                    await self._notify_user(user_id, {
                        "type": "job_cancelled",
                        "job_id": job_id,
                        "message": f"Job '{job_task.filename}' has been cancelled"
                    })
                else:
                    await temp_queue.put(job_task)
            except asyncio.QueueEmpty:
                break

        # Restore the queue
        while not temp_queue.empty():
            try:
                job_task = temp_queue.get_nowait()
                await self.queue.put(job_task)
            except asyncio.QueueEmpty:
                break

        return cancelled

    async def get_queue_status(self, user_id: int) -> Dict:
        """Get queue status for a specific user"""
        user_jobs = []

        # Check active jobs
        for job_task in self.active_jobs.values():
            if job_task.user_id == user_id:
                user_jobs.append({
                    "job_id": job_task.job_id,
                    "filename": job_task.filename,
                    "status": job_task.status,
                    "progress": job_task.progress,
                    "error_message": job_task.error_message
                })

        # Check queued jobs
        queued_count = 0
        temp_queue = asyncio.Queue()
        while not self.queue.empty():
            try:
                job_task = self.queue.get_nowait()
                if job_task.user_id == user_id:
                    queued_count += 1
                    user_jobs.append({
                        "job_id": job_task.job_id,
                        "filename": job_task.filename,
                        "status": JobStatus.QUEUED.value,
                        "progress": 0.0,
                        "queue_position": queued_count
                    })
                await temp_queue.put(job_task)
            except asyncio.QueueEmpty:
                break

        # Restore queue
        while not temp_queue.empty():
            try:
                job_task = temp_queue.get_nowait()
                await self.queue.put(job_task)
            except asyncio.QueueEmpty:
                break

        return {
            "active_jobs": len([j for j in self.active_jobs.values() if j.user_id == user_id]),
            "queued_jobs": queued_count,
            "total_queue_size": self.queue.qsize(),
            "jobs": user_jobs
        }

    async def _worker(self):
        """Main worker that processes jobs from the queue"""
        logger.info("Job queue worker started")

        while self.is_running:
            try:
                # Get job from queue with timeout
                job_task = await asyncio.wait_for(self.queue.get(), timeout=1.0)

                # Process job in thread pool
                asyncio.create_task(self._process_job(job_task))

            except asyncio.TimeoutError:
                continue
            except Exception as e:
                logger.error(f"Error in job queue worker: {e}")
                await asyncio.sleep(1)

    async def _process_job(self, job_task: JobTask):
        """Process a single job"""
        job_id = job_task.job_id
        user_id = job_task.user_id
        filename = job_task.filename

        try:
            # Add to active jobs
            self.active_jobs[job_id] = job_task

            # Update database status
            with SessionLocal() as db:
                update_job_status(db, job_id, JobStatus.PROCESSING, started_at=datetime.now())

            await self._notify_user(user_id, {
                "type": "job_started",
                "job_id": job_id,
                "message": f"Started processing '{filename}'"
            })

            logger.info(f"Processing job {job_id} for user {user_id}: {filename}")

            # Run actual processing in thread pool
            await asyncio.get_event_loop().run_in_executor(
                self.executor,
                self._process_audio_file,
                job_task
            )
            # Refresh job state for notifications
            with SessionLocal() as db:
                job = db.query(Job).filter(Job.id == job_id).first()
                if job:
                    job_task.status = job.status.value
                    if job.progress is not None:
                        job_task.progress = job.progress
                    job_task.error_message = job.error_message
                    if job.status == JobStatus.COMPLETED:
                        update_job_progress(db, job_id, 100.0)
                        job_task.progress = 100.0
                    elif job.status == JobStatus.FAILED:
                        raise RuntimeError(job.error_message or "Transcription failed")
                else:
                    update_job_progress(db, job_id, 100.0)
                    job_task.progress = 100.0
                    job_task.status = JobStatus.COMPLETED.value

            await self._notify_user(user_id, {
                "type": "job_completed",
                "job_id": job_id,
                "filename": filename,
                "status": job_task.status,
                "progress": job_task.progress,
                "message": f"Finished processing '{filename}'"
            })

        except Exception as e:
            logger.error(f"Error processing job {job_id}: {e}")
            job_task.error_message = str(e)
            job_task.status = JobStatus.FAILED.value

            # Update database
            with SessionLocal() as db:
                update_job_status(db, job_id, JobStatus.FAILED, error_message=str(e))

            await self._notify_user(user_id, {
                "type": "job_failed",
                "job_id": job_id,
                "error": str(e),
                "message": f"Failed to process '{filename}': {str(e)}"
            })

        finally:
            # Clean up
            if job_id in self.active_jobs:
                del self.active_jobs[job_id]

            # Update user job count
            current_count = self.user_job_counts.get(user_id, 1) - 1
            self.user_job_counts[user_id] = max(0, current_count)

    def _process_audio_file(self, job_task: JobTask):
        """Process audio file - this runs in a separate thread"""
        job_id = job_task.job_id
        file_path = job_task.file_path

        handler = job_task.callback or self._process_handler
        if handler is None:
            raise RuntimeError("No processing handler configured for job queue")

        try:
            handler(job_id, file_path, SessionLocal)
            job_task.status = JobStatus.COMPLETED.value
            job_task.progress = 100.0
            logger.info(f"Job {job_id} processed successfully via registered handler")

        except Exception as e:
            logger.error(f"Error in audio processing for job {job_id}: {e}")
            raise

    async def _notify_user(self, user_id: int, message: Dict):
        """Notify user about job status changes"""
        logger.info(f"User {user_id} notification: {message}")

        # Send WebSocket notification if manager is available
        if hasattr(self, 'websocket_manager') and self.websocket_manager:
            try:
                await self.websocket_manager.send_personal_message(message, user_id)
            except Exception as e:
                logger.warning(f"Failed to send WebSocket notification to user {user_id}: {e}")

    def set_websocket_manager(self, websocket_manager):
        """Set the WebSocket manager for notifications"""
        self.websocket_manager = websocket_manager

# Helper to parse integer environment variables safely
def _get_positive_int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        value = int(raw)
        if value <= 0:
            raise ValueError
        return value
    except ValueError:
        logger.warning(f"Ignoring invalid value '{raw}' for {name}; using default {default}")
        return default


# Global job queue manager instance
_max_concurrent = _get_positive_int_env("JOB_QUEUE_MAX_CONCURRENT", 3)
_max_queue_size = _get_positive_int_env("JOB_QUEUE_MAX_SIZE", 50)
_max_jobs_per_user = os.getenv("JOB_QUEUE_MAX_PER_USER")
_max_jobs_per_user_int = None
if _max_jobs_per_user:
    try:
        parsed_value = int(_max_jobs_per_user)
        if parsed_value > 0:
            _max_jobs_per_user_int = parsed_value
        else:
            raise ValueError
    except ValueError:
        logger.warning(
            f"Ignoring invalid value '{_max_jobs_per_user}' for JOB_QUEUE_MAX_PER_USER; using default"
        )

job_queue_manager = JobQueueManager(
    max_concurrent_jobs=_max_concurrent,
    max_queue_size=_max_queue_size,
    max_jobs_per_user=_max_jobs_per_user_int
)

logger.info(
    "Job queue configured with max_concurrent_jobs=%s, max_queue_size=%s, max_jobs_per_user=%s",
    _max_concurrent,
    _max_queue_size,
    _max_jobs_per_user_int or 2
)
