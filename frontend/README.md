# Meeting ASR Frontend

The frontend for the Meeting ASR (Automatic Speech Recognition) application. A React-based interface for uploading audio files, processing them through speech recognition, and managing transcribed content with advanced features.

## Features

- **User Authentication**: Secure login and registration system
- **Audio Upload**: Upload audio/video files for transcription
- **Transcript Management**: View and manage transcribed content
- **Interactive Transcript Display**: Speaker-separated transcript with timestamps
- **Click-to-Play**: Click on transcript segments to jump to corresponding audio
- **Additional Processing**: Summarization capabilities
- **Transcript Editing Persistence**: Save inline transcript edits back to the backend
- **Rich Summary Editor**: Word-style meeting minutes editor with formatting toolbar and quick references
- **Meeting Copilot Chat**: Ask contextual questions through an AI assistant dialog
- **Responsive Design**: Works on desktop and mobile devices

## New Features Added

### Improved Transcript Editor
- Segment-based display with speaker identification
- Timestamps for each transcript segment
- Visual distinction between different speakers
- Clickable segments for direct audio navigation

### Meeting Summary Editor
- Word-style editing surface with headings, lists, alignments, and inline formatting
- Quick reference palette with search for transcript segment citations
- Automatically preserves AI-generated Markdown/HTML formatting in the editor
- Keyboard shortcuts (Ctrl/Cmd + B/I/U, Ctrl/Cmd + S) and save status indicator for smooth workflow

### Audio Synchronization
- Click on any transcript segment to jump to the corresponding audio position
- Audio playback controls integrated with transcript display
- Visual feedback during audio playback

### Meeting Copilot Chat
- Floating "会议助理" button opens a Copilot-style conversation window
- Ask follow-up questions about the transcript or summary using the existing LLM backend
- Quick prompt chips for action items, risks, and decision summaries
- Assistant replies render Markdown (lists, tables, emphasis) for better readability
- Quick prompts can be hidden when you need more space in the chat window

## Prerequisites

- Node.js 16+ 
- npm or yarn package manager
- Backend server running (see backend/README.md)

## Installation

1. **Clone the repository** (if you haven't already):
   ```bash
   git clone <repository-url>
   cd Meeting-ASR/frontend
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment variables**:
   Create a `.env` file in the frontend directory:
   ```env
   REACT_APP_API_URL=http://localhost:8000
   FORK_TS_CHECKER_MEMORY_LIMIT=4096
   ```
   Increase or decrease `FORK_TS_CHECKER_MEMORY_LIMIT` if TypeScript checking exhausts memory on your machine.

4. **Start the development server**:
   ```bash
   npm start
   ```

The application will be available at [http://localhost:3000](http://localhost:3000)

## Available Scripts

### `npm start`
Runs the app in development mode.

### `npm test`
Launches the test runner. Use `CI=true npm test` for a single non-interactive run (recommended in CI).

### `npm run build`
Builds the app for production deployment.

## Project Structure

- `src/components/TranscriptEditor.tsx` - Enhanced transcript editor with click-to-play support
- `src/components/SummaryWithReferences.tsx` - Rich meeting summary editor with formatting toolbar
- `src/pages/JobDetailPage.tsx` - Updated page with new transcript editor component
- `src/components/AssistantChat.tsx` - Meeting Copilot chat dialog implementation
- `src/api.ts` - API client configuration
- `src/App.tsx` - Main application routing

## API Configuration

The frontend communicates with the backend API for all functionality. The default API URL is `http://localhost:8000`. Update the `REACT_APP_API_URL` environment variable to point to your backend server.

## Learn More

For more information about the backend API and additional features, see the backend documentation in `backend/README.md`.
