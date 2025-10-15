#!/bin/bash

# Meeting ASR Backend Startup Script
# This script starts the FastAPI backend with settings that allow remote connections

echo "Starting Meeting ASR Backend..."

# Change to backend directory
cd backend

# Activate virtual environment if it exists
if [ -d "venv" ]; then
    echo "Activating virtual environment..."
    source venv/bin/activate
fi

# Install dependencies if needed
if [ ! -f ".deps_installed" ]; then
    echo "Installing dependencies..."
    pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
    touch .deps_installed
fi

# Start the backend server on all interfaces (0.0.0.0) port 8000
echo "Starting server on http://0.0.0.0:8000"
echo "This will allow remote connections from any IP address"
echo "Press Ctrl+C to stop the server"

uvicorn main:app --host 0.0.0.0 --port 8000 --reload