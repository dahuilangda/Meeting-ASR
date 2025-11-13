from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Text, Boolean, Enum, Float, UniqueConstraint
from sqlalchemy.orm import relationship
from .database import Base
import datetime
import enum

class UserRole(enum.Enum):
    USER = "user"
    ADMIN = "admin"
    SUPER_ADMIN = "super_admin"

class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("oauth_provider", "oauth_subject", name="uq_users_oauth_identity"),
    )

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    email = Column(String, unique=True, index=True, nullable=True)
    hashed_password = Column(String, nullable=True)
    role = Column(Enum(UserRole), default=UserRole.USER)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    last_login = Column(DateTime, nullable=True)
    full_name = Column(String, nullable=True)
    oauth_provider = Column(String, nullable=True, index=True)
    oauth_subject = Column(String, nullable=True, index=True)

    jobs = relationship("Job", back_populates="owner")
    created_shares = relationship("JobShare", back_populates="creator")

class JobStatus(enum.Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

class Job(Base):
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String)
    status = Column(Enum(JobStatus), default=JobStatus.QUEUED)
    transcript = Column(Text, nullable=True)
    summary = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    owner_id = Column(Integer, ForeignKey("users.id"))
    file_path = Column(String, nullable=True)
    file_size = Column(Integer, nullable=True)
    processing_time = Column(Float, nullable=True)  # in seconds
    error_message = Column(Text, nullable=True)
    progress = Column(Float, default=0.0)  # 0.0 to 1.0
    # Additional field to store timing and speaker information
    timing_info = Column(Text, nullable=True)  # JSON string containing timing information

    owner = relationship("User", back_populates="jobs")
    shares = relationship("JobShare", back_populates="job", cascade="all, delete-orphan")


class JobShare(Base):
    __tablename__ = "job_shares"

    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(Integer, ForeignKey("jobs.id"), nullable=False, index=True)
    creator_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    share_token = Column(String, unique=True, index=True, nullable=False)
    access_code_hash = Column(String, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    allow_audio_download = Column(Boolean, default=False)
    allow_transcript_download = Column(Boolean, default=True)
    allow_summary_download = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    last_accessed_at = Column(DateTime, nullable=True)
    access_count = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)

    job = relationship("Job", back_populates="shares")
    creator = relationship("User", back_populates="created_shares")
