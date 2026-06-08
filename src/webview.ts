import * as vscode from 'vscode';
import type { GuideSuggestion, FileEntry, SummaryInfo, NextResponse, NextSuggestion, WalkthroughStep } from './types';

export function getGuideHtml(
	_suggestions: GuideSuggestion[],
	frameworks: string[],
	allFiles: FileEntry[],
	walkthroughSteps: WalkthroughStep[],
	summary: SummaryInfo | undefined,
	response: NextResponse | undefined,
	nextSuggestions: NextSuggestion[],
	learnedStepCount: number,
	totalSteps: number,
	currentStepInfo: WalkthroughStep | undefined,
	learnedFiles: ReadonlySet<string>
): string {
	const frameworkLine = frameworks.length
		? `<p class="frameworks">Detected: ${frameworks.map(escapeHtml).join(', ')}</p>`
		: `<p class="frameworks muted">Detected: none</p>`;

	// Progress bar
	const progressPct = totalSteps > 0 ? Math.round((learnedStepCount / totalSteps) * 100) : 0;
	const progressSection = totalSteps > 0 ? `
		<div class="progress-wrap">
			<div class="progress-label">${learnedStepCount} / ${totalSteps} walkthrough steps explored</div>
			<div class="progress-track"><div class="progress-fill" style="width:${progressPct}%"></div></div>
		</div>
	` : '';

	// Summary section
	const summarySection = summary ? `
		<section class="step" id="step-summary">
			${currentStepInfo ? `<div class="reading-goal"><strong>Reading goal:</strong> ${escapeHtml(currentStepInfo.details)}</div>` : ''}
			${summary.purposeHint ? `<div class="purpose-hint">${escapeHtml(summary.purposeHint)}</div>` : ''}
			<h2>File Summary: ${escapeHtml(summary.relativePath)}</h2>
			<div class="summary-meta">${summary.lineCount} lines</div>
			${summary.headings.length ? `<div class="summary-block"><strong>Headings:</strong> ${summary.headings.map(escapeHtml).join(', ')}</div>` : ''}
			${summary.exports.length ? `<div class="summary-block"><strong>Exports:</strong> ${summary.exports.map(escapeHtml).join(', ')}</div>` : ''}
			${summary.functions.length ? `
				<div class="summary-block"><strong>Key functions:</strong></div>
				<ul class="fn-list">
					${summary.functions.map(fn => `
						<li>
							<a class="fn-link" href="#" data-path="${encodeURIComponent(summary.filePath)}" data-line="${fn.line}">
								${escapeHtml(fn.name)} <span class="muted">(L${fn.line})</span>
							</a>
						</li>
					`).join('')}
				</ul>
			` : ''}
		</section>
	` : '';

	// Q&A section
	const qaSection = summary ? `
		<section class="step" id="step-qa">
			<h2>Ask a Question</h2>
			<div class="qa-input">
				<input id="nextQuestion" class="input" type="text" placeholder="e.g. How is routing handled?"${response ? ` value="${escapeHtml(response.question)}"` : ''} />
				<button id="askNextBtn" class="action-btn">Ask</button>
			</div>
			${response ? `
				<div class="qa-result">
					<div class="summary-block">${escapeHtml(response.message)}</div>
					${response.evidence.length ? `
						<div class="evidence">
							<strong>Highlighted lines:</strong>
							<ul>
								${response.evidence.map(item => `
									<li class="evidence-item">
										<a class="fn-link evidence-anchor" href="#" data-path="${encodeURIComponent(summary.filePath)}" data-line="${item.line}">L${item.line}</a>
										<div class="evidence-lines">
											${item.context[0] ? `<div class="ctx-line">${escapeHtml(item.context[0])}</div>` : ''}
											<div class="match-line">${escapeHtml(item.text)}</div>
											${item.context[1] ? `<div class="ctx-line">${escapeHtml(item.context[1])}</div>` : ''}
										</div>
									</li>
								`).join('')}
							</ul>
						</div>
					` : '<div class="summary-block muted">No direct matches found in the current file.</div>'}
				</div>
			` : '<div class="summary-block muted">Ask a question to highlight matching lines in the current file.</div>'}
		</section>
	` : '';

	// Explore Next section
	const exploreNextSection = (summary && nextSuggestions.length) ? `
		<section class="step" id="step-next">
			<h2>Explore Next</h2>
			<div class="grid">
				${nextSuggestions.map(s => `
					<div class="card">
						<div class="card-title">${escapeHtml(s.label)}</div>
						<div class="card-reason">${escapeHtml(s.reason)}</div>
						<button class="learn-btn" data-path="${encodeURIComponent(s.fsPath)}">Learn</button>
					</div>
				`).join('')}
			</div>
		</section>
	` : '';

	// Journey step list
	const stepsWithTarget = walkthroughSteps.filter(s => s.target !== undefined);
	const journeyRows = stepsWithTarget.map((step, idx) => {
		const isDone = learnedFiles.has(step.target!.fsPath);
		const isCurrent = summary?.filePath === step.target!.fsPath;
		const badge = isDone ? '✓' : isCurrent ? '→' : String(idx + 1);
		const rowClass = isDone ? 'journey-step step-done' : isCurrent ? 'journey-step step-current' : 'journey-step';
		const relPath = vscode.workspace.asRelativePath(step.target!);
		return `
			<li class="${rowClass}">
				<span class="step-badge">${badge}</span>
				<div class="step-body">
					<div class="step-title">${escapeHtml(step.title)}</div>
					<div class="step-path muted">${escapeHtml(relPath)}</div>
				</div>
				<button class="learn-btn" data-path="${encodeURIComponent(step.target!.fsPath)}">${isDone ? 'Review' : 'Learn'}</button>
			</li>
		`;
	}).join('');

	const journeySection = stepsWithTarget.length
		? `<ol class="journey-list">${journeyRows}</ol>`
		: `<div class="empty">No common entry points found. Use the file list below.</div>`;

	// All files list
	const allFilesItems = allFiles.map(entry => {
		const safeLabel = escapeHtml(entry.label);
		const encodedPath = encodeURIComponent(entry.uri.fsPath);
		const learned = learnedFiles.has(entry.uri.fsPath);
		return `
			<li class="file-item${learned ? ' file-learned' : ''}" data-label="${safeLabel.toLowerCase()}">
				<span class="file-label">${safeLabel}</span>
				<button class="learn-btn" data-path="${encodedPath}">${learned ? 'Review' : 'Learn'}</button>
			</li>
		`;
	}).join('');

	return `
		<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8" />
			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';" />
			<meta name="viewport" content="width=device-width, initial-scale=1.0" />
			<title>Codebase Guide</title>
			<style>
				body { font-family: var(--vscode-font-family); padding: 16px; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
				.header { margin-bottom: 16px; }
				.header h1 { font-size: 18px; margin: 0 0 8px; }
				.header p { margin: 0; opacity: 0.8; }
				.frameworks { margin-top: 6px; font-size: 12px; opacity: 0.8; }

				.progress-wrap { margin-top: 10px; }
				.progress-label { font-size: 12px; opacity: 0.75; margin-bottom: 4px; }
				.progress-track { height: 6px; background: var(--vscode-editorWidget-border); border-radius: 3px; overflow: hidden; }
				.progress-fill { height: 100%; background: var(--vscode-button-background); border-radius: 3px; }

				.step { border: 1px solid var(--vscode-editorWidget-border); background: var(--vscode-editorWidget-background); border-radius: 8px; padding: 12px; margin-bottom: 16px; }
				.step h2 { margin: 0 0 8px; font-size: 16px; }

				.reading-goal { border-left: 3px solid var(--vscode-button-background); padding: 7px 10px; border-radius: 0 6px 6px 0; font-size: 12px; margin-bottom: 10px; background: color-mix(in srgb, var(--vscode-button-background) 10%, transparent); }
				.purpose-hint { font-size: 11px; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 4px; }

				.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
				.card { border: 1px solid var(--vscode-editorWidget-border); background: var(--vscode-editorWidget-background); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
				.card-title { font-weight: 600; word-break: break-all; }
				.card-reason { font-size: 12px; opacity: 0.8; }

				.learn-btn, .action-btn { align-self: flex-start; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; white-space: nowrap; }
				.learn-btn:hover, .action-btn:hover { background: var(--vscode-button-hoverBackground); }
				.input { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 6px; padding: 6px 8px; }

				.journey-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
				.journey-step { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--vscode-editorWidget-border); border-radius: 6px; background: var(--vscode-editorWidget-background); }
				.step-done { opacity: 0.55; }
				.step-current { border-color: var(--vscode-button-background); background: color-mix(in srgb, var(--vscode-button-background) 8%, transparent); }
				.step-badge { width: 24px; height: 24px; border-radius: 50%; background: var(--vscode-editorWidget-border); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; flex-shrink: 0; }
				.step-done .step-badge, .step-current .step-badge { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
				.step-body { flex: 1; min-width: 0; }
				.step-title { font-size: 13px; font-weight: 500; }
				.step-path { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

				.file-search { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
				.file-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; max-height: 300px; overflow-y: auto; }
				.file-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; border: 1px solid var(--vscode-editorWidget-border); background: var(--vscode-editorWidget-background); border-radius: 6px; padding: 8px 10px; }
				.file-learned { opacity: 0.6; }
				.file-label { font-size: 12px; word-break: break-all; }

				.summary-meta { font-size: 12px; opacity: 0.7; margin-bottom: 8px; }
				.summary-block { font-size: 12px; margin-top: 6px; }
				.fn-list { margin: 6px 0 0; padding-left: 18px; font-size: 12px; }
				.fn-list li { margin-bottom: 4px; }
				.fn-link { color: var(--vscode-textLink-foreground); text-decoration: none; cursor: pointer; }
				.fn-link:hover { text-decoration: underline; }

				.qa-input { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
				.qa-result { margin-top: 8px; }
				.evidence { margin-top: 8px; font-size: 12px; }
				.evidence ul { margin: 6px 0 0; padding-left: 0; list-style: none; }
				.evidence-item { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 10px; }
				.evidence-anchor { white-space: nowrap; padding-top: 1px; }
				.evidence-lines { flex: 1; }
				.ctx-line { font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; opacity: 0.5; }
				.match-line { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; font-weight: 600; }

				.muted { font-size: 12px; opacity: 0.7; }
				.empty { padding: 16px; border: 1px dashed var(--vscode-editorWidget-border); border-radius: 8px; opacity: 0.8; }
				.divider { border: none; border-top: 1px solid var(--vscode-editorWidget-border); margin: 16px 0; }
			</style>
		</head>
		<body>
			<div class="header">
				<h1>Codebase Guide</h1>
				<p>Select a step to start learning. This extension never modifies your files.</p>
				${frameworkLine}
				${progressSection}
			</div>

			${summarySection}
			${qaSection}
			${exploreNextSection}

			${summarySection ? '<hr class="divider" />' : ''}

			<section id="step-files">
				<h2>Onboarding Journey</h2>
				${journeySection}
				<h3 style="margin: 16px 0 8px;">All Files</h3>
				<div class="file-search">
					<input id="fileFilter" class="input" type="text" placeholder="Filter files..." />
					<span class="muted">${allFiles.length} files</span>
				</div>
				<ul class="file-list">
					${allFilesItems || '<li class="muted">No files found.</li>'}
				</ul>
			</section>

			<script>
				const vscode = acquireVsCodeApi();

				document.querySelectorAll('.learn-btn').forEach(button => {
					button.addEventListener('click', event => {
						const path = event.currentTarget.getAttribute('data-path');
						if (!path) { return; }
						vscode.postMessage({ command: 'learnFile', path: decodeURIComponent(path) });
					});
				});

				document.querySelectorAll('.fn-link').forEach(link => {
					link.addEventListener('click', event => {
						event.preventDefault();
						const el = event.currentTarget;
						const path = el.getAttribute('data-path');
						const line = parseInt(el.getAttribute('data-line') || '0', 10);
						if (path && line) {
							vscode.postMessage({ command: 'jumpToLine', path: decodeURIComponent(path), line: line });
						}
					});
				});

				const askBtn = document.getElementById('askNextBtn');
				const questionInput = document.getElementById('nextQuestion');
				if (askBtn && questionInput) {
					askBtn.addEventListener('click', () => {
						if (!questionInput.value.trim()) { return; }
						vscode.postMessage({ command: 'askNext', text: questionInput.value.trim() });
					});
					questionInput.addEventListener('keydown', event => {
						if (event.key === 'Enter' && questionInput.value.trim()) {
							vscode.postMessage({ command: 'askNext', text: questionInput.value.trim() });
						}
					});
				}

				const filterInput = document.getElementById('fileFilter');
				if (filterInput) {
					filterInput.addEventListener('input', event => {
						const value = event.target.value.toLowerCase();
						document.querySelectorAll('.file-item').forEach(item => {
							const label = item.getAttribute('data-label') || '';
							item.style.display = label.includes(value) ? 'flex' : 'none';
						});
					});
				}
			</script>
		</body>
		</html>
	`;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
