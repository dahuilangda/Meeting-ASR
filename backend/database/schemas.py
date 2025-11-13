from pydantic import BaseModel, EmailStr, ConfigDict
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


class OAuthProvider(str, Enum):
    GOOGLE = "google"

class JobBase(BaseModel):
    filename: str

class JobCreate(JobBase):
    pass

class JobUpdate(BaseModel):
    summary: Optional[str] = None

class Job(JobBase):
    model_config = ConfigDict(from_attributes=True, validate_by_name=True)

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


class JobListResponse(BaseModel):
    items: List[Job]
    total: int
    page: int
    page_size: int
    total_pages: int


class JobShareCreateRequest(BaseModel):
    expires_in_days: Optional[int] = None
    expires_at: Optional[datetime.datetime] = None
    access_code: Optional[str] = None
    allow_audio_download: bool = False
    allow_transcript_download: bool = True
    allow_summary_download: bool = True


class JobShareUpdateRequest(BaseModel):
    allow_audio_download: Optional[bool] = None
    allow_transcript_download: Optional[bool] = None
    allow_summary_download: Optional[bool] = None
    expires_at: Optional[datetime.datetime] = None
    is_active: Optional[bool] = None
    access_code: Optional[str] = None


class JobShareResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, validate_by_name=True)

    id: int
    job_id: int
    share_token: str
    created_at: datetime.datetime
    expires_at: Optional[datetime.datetime] = None
    last_accessed_at: Optional[datetime.datetime] = None
    access_count: int = 0
    allow_audio_download: bool
    allow_transcript_download: bool
    allow_summary_download: bool
    is_active: bool
    requires_access_code: bool


class SharePermissions(BaseModel):
    allow_audio_download: bool
    allow_transcript_download: bool
    allow_summary_download: bool


class PublicShareJob(BaseModel):
    model_config = ConfigDict(from_attributes=True, validate_by_name=True)

    id: int
    filename: str
    status: JobStatusEnum
    created_at: datetime.datetime
    transcript: Optional[str] = None
    summary: Optional[str] = None
    timing_info: Optional[str] = None


class PublicShareDetails(BaseModel):
    model_config = ConfigDict(from_attributes=True, validate_by_name=True)

    share_token: str
    expires_at: Optional[datetime.datetime] = None
    requires_access_code: bool
    job: PublicShareJob
    permissions: SharePermissions

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
    confirm_password: Optional[str] = None

class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None

class UserResponse(UserBase):
    model_config = ConfigDict(from_attributes=True, validate_by_name=True)

    id: int
    role: UserRole
    is_active: bool
    created_at: datetime.datetime
    last_login: Optional[datetime.datetime] = None
    job_count: Optional[int] = 0
    oauth_provider: Optional[str] = None


class UserListResponse(BaseModel):
    items: List[UserResponse]
    total: int

class User(UserBase):
    model_config = ConfigDict(from_attributes=True, validate_by_name=True)

    id: int
    role: UserRole
    is_active: bool
    created_at: datetime.datetime
    last_login: Optional[datetime.datetime] = None
    jobs: List[JobBase] = []
    oauth_provider: Optional[str] = None


class OAuthLoginRequest(BaseModel):
    provider: OAuthProvider
    id_token: str
    access_token: Optional[str] = None

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
