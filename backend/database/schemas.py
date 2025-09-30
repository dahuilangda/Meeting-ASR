from pydantic import BaseModel
from typing import List, Optional
import datetime

class JobBase(BaseModel):
    id: int
    filename: str
    status: str
    created_at: datetime.datetime

class Job(JobBase):
    transcript: Optional[str]
    timing_info: Optional[str]  # JSON string containing timing information
    class Config:
        from_attributes = True

class UserBase(BaseModel):
    username: str

class UserCreate(UserBase):
    password: str

class User(UserBase):
    id: int
    jobs: List[JobBase] = []

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: str | None = None
