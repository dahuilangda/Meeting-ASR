from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Text
from sqlalchemy.orm import relationship
from .database import Base
import datetime

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)

    jobs = relationship("Job", back_populates="owner")

class Job(Base):
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String)
    status = Column(String, default="processing") # processing, completed, failed
    transcript = Column(Text, nullable=True)
    summary = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    owner_id = Column(Integer, ForeignKey("users.id"))
    # Additional field to store timing and speaker information 
    timing_info = Column(Text, nullable=True)  # JSON string containing timing information

    owner = relationship("User", back_populates="jobs")
