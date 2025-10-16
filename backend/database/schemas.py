from pydantic import BaseModel, EmailStr
from typing import List, Optional
import datetime
from enum import Enum

class UserRole(str, Enum):
    USER = "user"
    ADMIN = "admin"
    SUPER_ADMIN = "super_admin"

class JobBase(BaseModel):
    id: int
    filename: str
    status: str
    created_at: datetime.datetime

class Job(JobBase):
    transcript: Optional[str]
    timing_info: Optional[str]  # JSON string containing timing information
    summary: Optional[str]  # Summary field added
    class Config:
        from_attributes = True

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
