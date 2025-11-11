#!/bin/bash

# Meeting ASR Frontend Startup Script
# This script starts the React frontend development server

echo "Starting Meeting ASR Frontend..."

# Allow overriding the frontend port via environment, default to 3030
FRONTEND_PORT=${FRONTEND_PORT:-3030}


# Change to frontend directory
cd frontend

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Start the React development server
echo "Starting React development server..."
echo "The frontend will be available at http://localhost:${FRONTEND_PORT}"
echo "Press Ctrl+C to stop the server"

# CRA reads the PORT environment variable to determine the dev server port
export PORT="${FRONTEND_PORT}"
npm start