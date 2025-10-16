#!/usr/bin/env python3
"""
Script to create a super admin user
Run this after migration to set up the first administrator
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database.database import SessionLocal
from database.models import User, UserRole
from database.crud import get_password_hash
import getpass

def create_super_admin():
    """Create a super admin user"""

    print("🔐 Create Super Administrator")
    print("=" * 40)

    with SessionLocal() as db:
        # Get username
        while True:
            username = input("Enter username: ").strip()
            if not username:
                print("❌ Username cannot be empty!")
                continue

            # Check if user already exists
            existing_user = db.query(User).filter(User.username == username).first()
            if existing_user:
                print(f"❌ User '{username}' already exists!")
                continue

            break

        # Get email
        while True:
            email = input("Enter email (optional): ").strip()
            if not email:
                email = None
                break

            # Simple email validation
            if '@' not in email:
                print("❌ Please enter a valid email address!")
                continue

            # Check if email already exists
            existing_user = db.query(User).filter(User.email == email).first()
            if existing_user:
                print(f"❌ Email '{email}' already exists!")
                continue

            break

        # Get full name
        full_name = input("Enter full name (optional): ").strip() or None

        # Get password
        while True:
            password = getpass.getpass("Enter password: ")
            if not password:
                print("❌ Password cannot be empty!")
                continue

            if len(password) < 6:
                print("❌ Password must be at least 6 characters long!")
                continue

            confirm_password = getpass.getpass("Confirm password: ")
            if password != confirm_password:
                print("❌ Passwords do not match!")
                continue

            break

        # Create the super admin user
        try:
            hashed_password = get_password_hash(password)
            super_admin = User(
                username=username,
                email=email,
                full_name=full_name,
                hashed_password=hashed_password,
                role=UserRole.SUPER_ADMIN,
                is_active=True
            )

            db.add(super_admin)
            db.commit()
            db.refresh(super_admin)

            print("\n✅ Super administrator created successfully!")
            print(f"   Username: {username}")
            print(f"   Email: {email or 'Not provided'}")
            print(f"   Full Name: {full_name or 'Not provided'}")
            print(f"   Role: {super_admin.role.value}")
            print(f"   Active: {super_admin.is_active}")
            print("\n🎉 You can now log in and access the admin panel at /admin")

        except Exception as e:
            print(f"\n❌ Failed to create super admin: {e}")
            db.rollback()
            return False

    return True

if __name__ == "__main__":
    print("🚀 Super Administrator Setup")
    print("This script will create a new super administrator user.")
    print("Make sure you have run the database migration first!\n")

    if create_super_admin():
        print("\n🎉 Setup completed successfully!")
    else:
        print("\n💥 Setup failed!")
        sys.exit(1)