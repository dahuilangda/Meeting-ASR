#!/bin/bash

set -euo pipefail

# Meeting ASR Frontend Startup Script
# This script starts the React frontend development server

echo "Starting Meeting ASR Frontend..."

# Allow overriding the frontend port via environment, default to 3030
FRONTEND_PORT=${FRONTEND_PORT:-3030}


# Change to frontend directory
cd frontend

# Ensure the React app sees the desired backend URL
resolve_api_url() {
    local file_path="$1"
    if [ -f "$file_path" ]; then
        local value
        value=$(grep -E '^REACT_APP_API_URL=' "$file_path" | tail -n 1 | cut -d'=' -f2-)
        value=$(printf '%s' "$value" | tr -d '"' | xargs)
        if [ -n "$value" ]; then
            printf '%s' "$value"
            return 0
        fi
    fi
    return 1
}

api_url="${REACT_APP_API_URL:-}"

if [ -z "$api_url" ]; then
    api_url=$(resolve_api_url ".env" || true)
fi

if [ -z "$api_url" ]; then
    api_url=$(resolve_api_url ".env.development" || true)
fi

if [ -n "$api_url" ]; then
    export REACT_APP_API_URL="$api_url"
fi

echo "Using backend API: ${REACT_APP_API_URL:-http://localhost:8000}"

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
PORT="${FRONTEND_PORT}" \
REACT_APP_API_URL="${REACT_APP_API_URL:-http://localhost:8000}" \
npm start