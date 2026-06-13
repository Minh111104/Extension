# Codebase Guide 💡

Codebase Guide helps vibe coders learn unfamiliar projects without overwriting files. It suggests key files to explore and can highlight specific lines on request.

## Features

- Single guided flow: select a file, see its summary, ask questions, get next suggestions.
- Unified file selection combining suggested files and framework-aware walkthrough steps.
- Browse all workspace files with a searchable list.
- Learn a file to see exports, functions, and headings with clickable jump-to-line links.
- Ask questions to highlight matching lines in the editor with explanations.
- Get "Explore Next" suggestions based on imports, walkthrough steps, and unexplored files.

## Commands

- Click Run -> Start Debugging (`fn+F5`)
- Codebase Guide: Start (`Ctrl+Shift+G` / `Cmd+Shift+G`)

## Usage

1. Run "Codebase Guide: Start" (or press `Ctrl+Shift+G` / `Cmd+Shift+G`) to open the guide panel.
2. Select a file from suggestions or the file list.
3. Review the file summary — click function names to jump to their lines.
4. Ask a question to highlight relevant lines in the editor.
5. Follow "Explore Next" suggestions to continue learning the codebase.

## Architecture

All extension logic lives in a single file: `src/extension.ts`. It's organized into a few functional areas:

- **Activation** — `activate()` registers the `codebase-guide.start` command.
- **Panel UI** — `openGuidePanel()`, `updateGuidePanel()`, `getGuideHtml()` create and update the webview panel (string-templated HTML, no bundler or UI framework).
- **File discovery** — `buildGuideSuggestions()`, `buildAllFilesList()` scan the workspace for key files (README, package.json, language entry points) and build the browsable file list (capped at 2000 files).
- **Analysis** — `analyzeDocument()`, `learnFile()` extract headings, exports, and functions from a file.
- **Framework detection** — `detectFrameworks()`, `buildWalkthroughSteps()` identify frameworks from `package.json` and config files, and generate adaptive onboarding steps.
- **Q&A** — `buildNextResponse()`, `extractNamedQuery()` match questions to relevant code lines for highlighting.
- **Import suggestions** — `buildNextSuggestions()` resolve relative imports and walkthrough steps into "Explore Next" suggestions.

The webview communicates with the extension over four message commands: `learnFile`, `openFile`, `jumpToLine`, and `askNext`. The extension is read-only — it never modifies user files — and has no runtime dependencies beyond the VS Code API.

## Release Notes

Initial preview with guidance panel and line highlighting.

## License

This project is created for educational purpose.
