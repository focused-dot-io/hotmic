# HotMic

A lightweight desktop application that transcribes audio using either Groq or OpenAI APIs with the Whisper-large-v3 model. While an API key is required for transcription, the post-processing feature (which formats the transcription output) is optional.

## Features

- Cross-platform support for both Windows and macOS
- Press a global shortcut to start/stop recording (platform-specific defaults)
- Audio transcription using Groq or OpenAI Whisper API
- Multiple transcription model options (whisper-large-v3, gpt-4o-transcribe, etc.)
- Optional post-processing with Groq or OpenAI LLM to format transcripts
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

1. Choose a provider for speech-to-text (Groq or OpenAI)
2. Get an API key from your chosen provider:
   - For Groq, sign up at [https://console.groq.com](https://console.groq.com)
   - For OpenAI, sign up at [https://platform.openai.com](https://platform.openai.com)
3. Enter your API key in the app settings
4. Select your preferred transcription model
5. (Optional) Enable post-processing to format transcripts

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
