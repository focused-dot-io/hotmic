# HotMic

A lightweight desktop application that transcribes audio using Groq's API with the Whisper-large-v3 model. While a Groq API key is required for transcription, the post-processing feature (which formats the transcription output) is optional.

## Features

- Cross-platform support for both Windows and macOS
- Press a global shortcut to start/stop recording (platform-specific defaults)
- Audio transcription using Groq's Whisper API
- Optional post-processing with Groq LLM to format transcripts
- Results are automatically copied to clipboard
- Visual feedback during recording and processing
- Configurable keyboard shortcut

## Setup

1. Clone this repository
2. Install dependencies:

   ```bash
   npm install
   ```

3. Run the application:

   ```bash
   npm start
   ```

## Configuration

1. Sign up for a Groq API account at [https://console.groq.com](https://console.groq.com)
2. Get an API key (required for transcription)
3. Enter your API key in the app settings
4. (Optional) Enable post-processing to format transcripts

## Usage

1. Press the configured global shortcut (default: Ctrl+Shift+Space on Windows, Command+Shift+Space on macOS) to start recording
2. Speak into your microphone
3. Press the shortcut again to stop recording and begin transcription
4. Once transcription is complete, the text will be copied to your clipboard
   - By default, you'll get the raw transcription text from the Whisper model
   - If post-processing is enabled, you'll get formatted text based on a customizable prompt (default: formats text as a professional email)

## Development

- Run with developer tools: `npm run dev`
- Build distribution: `npm run build`

## Dependencies

- Electron
- Electron Store
- Form Data

## License

MIT
