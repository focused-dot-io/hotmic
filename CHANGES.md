# Change Summary

## Version 0.0.2

### Cross-Platform Support

- Added proper Windows platform support
- Made UI and controls adapt to the specific platform
- Implemented platform-specific shortcuts (Command+Shift+Space on macOS, Ctrl+Shift+Space on Windows)
- Updated requirements to reduce deprecated packages warnings

### User Experience Improvements

- Made the API key management more clear and fixed empty key handling
- Disabled post-processing by default for new installations
- Improved explanatory text throughout the application

### History Features

- Added toggle to enable/disable history recording
- Added "Clear History" button with confirmation dialog
- Implemented secure encryption of history data using system keychain/credential store
- Added status indicator to show encryption availability

### Security Improvements

- Utilized Electron's safeStorage API for encrypting sensitive transcript data
- Implemented proper error handling for encryption/decryption operations

### Other Improvements

- Various code organization improvements and refactoring

## Version 0.0.1

- Initial release
