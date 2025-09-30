from sqlalchemy.orm import Session
from . import models, schemas
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

# --- User CRUD ---

def get_password_hash(password):
    # Truncate password to 72 bytes to comply with bcrypt limitations
    return pwd_context.hash(password[:72])

def get_user_by_username(db: Session, username: str):
    return db.query(models.User).filter(models.User.username == username).first()

def create_user(db: Session, user: schemas.UserCreate):
    # Truncate password to 72 bytes to comply with bcrypt limitations
    hashed_password = get_password_hash(user.password[:72])
    db_user = models.User(username=user.username, hashed_password=hashed_password)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

# --- Job CRUD ---

def create_job(db: Session, filename: str, owner_id: int) -> models.Job:
    db_job = models.Job(filename=filename, owner_id=owner_id, status="processing")
    db.add(db_job)
    db.commit()
    db.refresh(db_job)
    return db_job

def get_jobs_by_owner(db: Session, owner_id: int):
    return db.query(models.Job).filter(models.Job.owner_id == owner_id).order_by(models.Job.created_at.desc()).all()

def get_job(db: Session, job_id: int, owner_id: int) -> models.Job | None:
    return db.query(models.Job).filter(models.Job.id == job_id, models.Job.owner_id == owner_id).first()

def update_job_status(db: Session, job_id: int, status: str):
    db_job = db.query(models.Job).filter(models.Job.id == job_id).first()
    if db_job:
        db_job.status = status
        db.commit()

def update_job_transcript(db: Session, job_id: int, transcript: str, timing_info: str = None):
    db_job = db.query(models.Job).filter(models.Job.id == job_id).first()
    if db_job:
        db_job.transcript = transcript
        if timing_info is not None:
            db_job.timing_info = timing_info
        db_job.status = "completed"
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
