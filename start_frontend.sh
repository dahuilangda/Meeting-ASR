#!/bin/bash

# Meeting ASR Frontend Startup Script
# This script starts the React frontend development server

echo "Starting Meeting ASR Frontend..."

# Change to frontend directory
cd frontend

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Start the React development server
echo "Starting React development server..."
echo "The frontend will be available at http://localhost:3000"
echo "Press Ctrl+C to stop the server"

npm start