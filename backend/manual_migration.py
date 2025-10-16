#!/usr/bin/env python3
"""
Manual migration script to add user roles and additional fields to existing database
Run this script to update your database schema
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import create_engine, text
from database.database import SessionLocal, SQLALCHEMY_DATABASE_URL
from database.models import User, UserRole
import datetime

def migrate_database():
    """Manually migrate the database to add user roles and additional fields"""

    print("Starting database migration...")

    # Create engine
    engine = create_engine(SQLALCHEMY_DATABASE_URL)

    with engine.connect() as connection:
        # Start transaction
        trans = connection.begin()

        try:
            # Check if columns exist
            result = connection.execute(text("PRAGMA table_info(users)"))
            columns = [row[1] for row in result.fetchall()]

            print(f"Existing columns: {columns}")

            # Add missing columns
            if 'email' not in columns:
                print("Adding email column...")
                connection.execute(text("ALTER TABLE users ADD COLUMN email VARCHAR(255)"))

            if 'role' not in columns:
                print("Adding role column...")
                connection.execute(text("ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'user'"))

            if 'is_active' not in columns:
                print("Adding is_active column...")
                connection.execute(text("ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT 1"))

            if 'created_at' not in columns:
                print("Adding created_at column...")
                connection.execute(text("ALTER TABLE users ADD COLUMN created_at DATETIME"))

            if 'last_login' not in columns:
                print("Adding last_login column...")
                connection.execute(text("ALTER TABLE users ADD COLUMN last_login DATETIME"))

            if 'full_name' not in columns:
                print("Adding full_name column...")
                connection.execute(text("ALTER TABLE users ADD COLUMN full_name VARCHAR(255)"))

            # Create unique index for email if it doesn't exist
            try:
                connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users(email)"))
                print("Email index created or already exists")
            except Exception as e:
                print(f"Warning: Could not create email index: {e}")

            print("Column migration completed!")

            # Update existing users to have default values
            print("Updating existing users with default values...")

            connection.execute(text("""
                UPDATE users SET
                    role = 'USER',
                    is_active = 1,
                    created_at = datetime('now')
                WHERE role IS NULL OR is_active IS NULL OR created_at IS NULL
            """))

            # Commit transaction
            trans.commit()
            print("Migration completed successfully!")

            # Show updated user count
            with SessionLocal() as db:
                user_count = db.query(User).count()
                active_count = db.query(User).filter(User.is_active == True).count()

                print(f"\nDatabase Statistics:")
                print(f"Total users: {user_count}")
                print(f"Active users: {active_count}")

                # Show users with their roles
                users = db.query(User).all()
                print(f"\nUsers:")
                for user in users:
                    print(f"  - {user.username} (Role: {user.role}, Active: {user.is_active})")

        except Exception as e:
            print(f"Migration failed: {e}")
            trans.rollback()
            return False

    return True

if __name__ == "__main__":
    if migrate_database():
        print("\n✅ Migration completed successfully!")
        print("\nNext steps:")
        print("1. Restart your backend server")
        print("2. Register a new super admin user or manually update an existing user's role")
        print("3. Access the admin panel at /admin")
    else:
        print("\n❌ Migration failed!")
        print("Please check the error message above and fix any issues.")
        sys.exit(1)