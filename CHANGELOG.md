# Change Log

All notable changes to the "codebase-guide" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Added an onboarding journey list that tracks framework-specific walkthrough steps with progress badges (done/current/upcoming)
- Added a progress bar showing how many walkthrough steps have been explored
- Added "Reading goal" callouts describing what to look for in the current step
- Added file purpose hints (e.g. "Route definitions and URL mappings") based on file path heuristics
- Added surrounding context lines to Q&A evidence to make matches easier to understand
- Q&A evidence now shows which function or class each matched line belongs to ("Inside `functionName`")
- Split `extension.ts` into focused modules (`types`, `analyze`, `discover`, `walkthrough`, `webview`) for readability

## [Initial]

- Initial release