from pydantic import BaseModel, EmailStr
from typing import List, Optional
import datetime
from enum import Enum

class UserRole(str, Enum):
    USER = "user"
    ADMIN = "admin"
    SUPER_ADMIN = "super_admin"

class JobStatusEnum(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

class JobBase(BaseModel):
    filename: str

class JobCreate(JobBase):
    pass

class JobUpdate(BaseModel):
    summary: Optional[str] = None

class Job(JobBase):
    id: int
    status: JobStatusEnum
    created_at: datetime.datetime
    started_at: Optional[datetime.datetime] = None
    completed_at: Optional[datetime.datetime] = None
    owner_id: int
    file_path: Optional[str] = None
    file_size: Optional[int] = None
    processing_time: Optional[float] = None
    error_message: Optional[str] = None
    progress: float = 0.0
    transcript: Optional[str] = None
    timing_info: Optional[str] = None
    summary: Optional[str] = None

    class Config:
        from_attributes = True

class JobStatusUpdate(BaseModel):
    job_id: int
    status: JobStatusEnum
    progress: float = 0.0
    error_message: Optional[str] = None
    queue_position: Optional[int] = None

class QueueStatus(BaseModel):
    active_jobs: int
    queued_jobs: int
    total_queue_size: int
    jobs: List[JobStatusUpdate]

class UserBase(BaseModel):
    username: str
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None

class UserCreate(UserBase):
    password: str
    role: Optional[UserRole] = UserRole.USER

class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None

class UserResponse(UserBase):
    id: int
    role: UserRole
    is_active: bool
    created_at: datetime.datetime
    last_login: Optional[datetime.datetime] = None
    job_count: Optional[int] = 0

    class Config:
        from_attributes = True

class User(UserBase):
    id: int
    role: UserRole
    is_active: bool
    created_at: datetime.datetime
    last_login: Optional[datetime.datetime] = None
    jobs: List[JobBase] = []

    class Config:
        from_attributes = True

class PasswordChange(BaseModel):
    current_password: str
    new_password: str

class PasswordReset(BaseModel):
    new_password: str

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: Optional[str] = None
    role: Optional[UserRole] = None
