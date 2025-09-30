#!/usr/bin/env python
"""
Simple migration script to add timing_info column to jobs table
"""
import sqlite3
import os

def migrate_database():
    # Connect to the database
    db_path = "sqlite.db"
    if not os.path.exists(db_path):
        print(f"Database {db_path} not found!")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        # Check if the timing_info column already exists
        cursor.execute("PRAGMA table_info(jobs)")
        columns = [column[1] for column in cursor.fetchall()]
        
        if 'timing_info' not in columns:
            # Add the timing_info column
            cursor.execute("ALTER TABLE jobs ADD COLUMN timing_info TEXT")
            print("Added timing_info column to jobs table")
        else:
            print("timing_info column already exists")
        
        # Commit the changes
        conn.commit()
        print("Migration completed successfully!")
    except Exception as e:
        print(f"Migration failed: {e}")
        conn.rollback()
    finally:
        conn.close()

if __name__ == "__main__":
    migrate_database()