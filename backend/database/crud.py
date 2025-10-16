from sqlalchemy.orm import Session
from . import models, schemas
from passlib.context import CryptContext
from typing import Optional
import datetime

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

# --- User CRUD ---

def get_password_hash(password):
    # Truncate password to 72 bytes to comply with bcrypt limitations
    return pwd_context.hash(password[:72])

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_user_by_username(db: Session, username: str):
    return db.query(models.User).filter(models.User.username == username).first()

def get_user_by_email(db: Session, email: str):
    return db.query(models.User).filter(models.User.email == email).first()

def get_user_by_id(db: Session, user_id: int):
    return db.query(models.User).filter(models.User.id == user_id).first()

def get_users(db: Session, skip: int = 0, limit: int = 100, include_inactive: bool = False):
    query = db.query(models.User)
    if not include_inactive:
        query = query.filter(models.User.is_active == True)
    return query.offset(skip).limit(limit).all()

def get_user_count(db: Session, include_inactive: bool = False):
    query = db.query(models.User)
    if not include_inactive:
        query = query.filter(models.User.is_active == True)
    return query.count()

def create_user(db: Session, user: schemas.UserCreate):
    # Truncate password to 72 bytes to comply with bcrypt limitations
    hashed_password = get_password_hash(user.password[:72])
    db_user = models.User(
        username=user.username,
        email=user.email,
        full_name=user.full_name,
        hashed_password=hashed_password,
        role=user.role if user.role else models.UserRole.USER
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

def update_user(db: Session, user_id: int, user_update: schemas.UserUpdate):
    db_user = db.query(models.User).filter(models.User.id == user_id).first()
    if db_user:
        update_data = user_update.dict(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_user, field, value)
        db.commit()
        db.refresh(db_user)
    return db_user

def update_user_password(db: Session, user_id: int, new_password: str):
    db_user = db.query(models.User).filter(models.User.id == user_id).first()
    if db_user:
        db_user.hashed_password = get_password_hash(new_password[:72])
        db.commit()
        db.refresh(db_user)
    return db_user

def update_last_login(db: Session, user_id: int):
    db_user = db.query(models.User).filter(models.User.id == user_id).first()
    if db_user:
        db_user.last_login = datetime.datetime.utcnow()
        db.commit()
    return db_user

def deactivate_user(db: Session, user_id: int):
    db_user = db.query(models.User).filter(models.User.id == user_id).first()
    if db_user:
        db_user.is_active = False
        db.commit()
        db.refresh(db_user)
    return db_user

def activate_user(db: Session, user_id: int):
    db_user = db.query(models.User).filter(models.User.id == user_id).first()
    if db_user:
        db_user.is_active = True
        db.commit()
        db.refresh(db_user)
    return db_user

# --- Job CRUD ---

def create_job(db: Session, filename: str, owner_id: int, file_path: str = None, file_size: int = None) -> models.Job:
    db_job = models.Job(
        filename=filename,
        owner_id=owner_id,
        status=models.JobStatus.QUEUED,
        file_path=file_path,
        file_size=file_size
    )
    db.add(db_job)
    db.commit()
    db.refresh(db_job)
    return db_job

def get_jobs_by_owner(db: Session, owner_id: int):
    return db.query(models.Job).filter(models.Job.owner_id == owner_id).order_by(models.Job.created_at.desc()).all()

def get_job(db: Session, job_id: int, owner_id: int) -> models.Job | None:
    return db.query(models.Job).filter(models.Job.id == job_id, models.Job.owner_id == owner_id).first()

def update_job_status(db: Session, job_id: int, status: models.JobStatus, started_at: datetime.datetime = None, completed_at: datetime.datetime = None, error_message: str = None):
    db_job = db.query(models.Job).filter(models.Job.id == job_id).first()
    if db_job:
        db_job.status = status
        if started_at:
            db_job.started_at = started_at
        if completed_at:
            db_job.completed_at = completed_at
            if db_job.started_at:
                db_job.processing_time = (completed_at - db_job.started_at).total_seconds()
        if error_message:
            db_job.error_message = error_message
        db.commit()
        db.refresh(db_job)
        return db_job
    return None

def update_job_transcript(db: Session, job_id: int, transcript: str, timing_info: str = None):
    db_job = db.query(models.Job).filter(models.Job.id == job_id).first()
    if db_job:
        db_job.transcript = transcript
        if timing_info is not None:
            db_job.timing_info = timing_info
        db_job.status = models.JobStatus.COMPLETED
        db_job.completed_at = datetime.datetime.utcnow()
        if db_job.started_at:
            db_job.processing_time = (db_job.completed_at - db_job.started_at).total_seconds()
        db.commit()
        db.refresh(db_job)  # Refresh to get updated values
        return db_job
    return None

def update_job_timing_info(db: Session, job_id: int, timing_info: str):
    db_job = db.query(models.Job).filter(models.Job.id == job_id).first()
    if db_job:
        db_job.timing_info = timing_info
        db.commit()
        db.refresh(db_job)
        return db_job
    return None

def delete_job(db: Session, job_id: int):
    db_job = db.query(models.Job).filter(models.Job.id == job_id).first()
    if db_job:
        db.delete(db_job)
        db.commit()

def update_job_summary(db: Session, job_id: int, summary: str):
    db_job = db.query(models.Job).filter(models.Job.id == job_id).first()
    if db_job:
        db_job.summary = summary
        db.commit()
        db.refresh(db_job)
        return db_job
    return None

def update_job_filename(db: Session, job_id: int, owner_id: int, filename: str):
    db_job = db.query(models.Job).filter(
        models.Job.id == job_id,
        models.Job.owner_id == owner_id
    ).first()
    if db_job:
        db_job.filename = filename
        db.commit()
        db.refresh(db_job)
        return db_job
    return None

def update_job_progress(db: Session, job_id: int, progress: float):
    """Update job progress (0.0 to 100.0)"""
    db_job = db.query(models.Job).filter(models.Job.id == job_id).first()
    if db_job:
        db_job.progress = max(0.0, min(100.0, progress))
        db.commit()
        return db_job
    return None

def get_job_with_progress(db: Session, job_id: int, owner_id: int) -> models.Job | None:
    """Get job with progress information"""
    return db.query(models.Job).filter(
        models.Job.id == job_id,
        models.Job.owner_id == owner_id
    ).first()

def get_all_jobs(db: Session, skip: int = 0, limit: int = 100):
    """Get all jobs (for admin)"""
    return db.query(models.Job).order_by(models.Job.created_at.desc()).offset(skip).limit(limit).all()

def get_jobs_by_status(db: Session, status: models.JobStatus):
    """Get jobs by status"""
    return db.query(models.Job).filter(models.Job.status == status).all()

def get_user_active_jobs_count(db: Session, user_id: int):
    """Get count of active jobs for a user"""
    return db.query(models.Job).filter(
        models.Job.owner_id == user_id,
        models.Job.status.in_([models.JobStatus.QUEUED, models.JobStatus.PROCESSING])
    ).count()
