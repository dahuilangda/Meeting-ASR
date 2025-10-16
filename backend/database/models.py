from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Text, Boolean, Enum, Float
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

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    email = Column(String, unique=True, index=True, nullable=True)
    hashed_password = Column(String)
    role = Column(Enum(UserRole), default=UserRole.USER)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    last_login = Column(DateTime, nullable=True)
    full_name = Column(String, nullable=True)

    jobs = relationship("Job", back_populates="owner")

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
