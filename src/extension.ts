import * as vscode from 'vscode';

type GuideSuggestion = {
	label: string;
	reason: string;
	uri: vscode.Uri;
};

type FileEntry = {
	label: string;
	uri: vscode.Uri;
};

type SummaryInfo = {
	filePath: string;
	relativePath: string;
	lineCount: number;
	headings: string[];
	exports: string[];
	functions: Array<{ name: string; line: number }>;
};

type NextResponse = {
	question: string;
	message: string;
	evidence: Array<{ line: number; text: string }>;
};

type NextSuggestion = {
	label: string;
	reason: string;
	fsPath: string;
};

let currentPanel: vscode.WebviewPanel | undefined;
let highlightDecoration: vscode.TextEditorDecorationType | undefined;
let currentSummary: SummaryInfo | undefined;
let nextResponse: NextResponse | undefined;
let currentLearnedUri: vscode.Uri | undefined;
const learnedFiles = new Set<string>();

export function activate(context: vscode.ExtensionContext) {
	console.log('Codebase Guide extension is active.');

	highlightDecoration = vscode.window.createTextEditorDecorationType({
		backgroundColor: new vscode.ThemeColor('editor.wordHighlightStrongBackground'),
		isWholeLine: true
	});
	context.subscriptions.push(highlightDecoration);

	const startDisposable = vscode.commands.registerCommand('codebase-guide.start', async () => {
		await openGuidePanel(context);
	});

	context.subscriptions.push(startDisposable);
}

export function deactivate() {}

async function openGuidePanel(context: vscode.ExtensionContext): Promise<void> {
	if (currentPanel) {
		currentPanel.reveal(vscode.ViewColumn.One);
		await updateGuidePanel(currentPanel);
		return;
	}

	currentPanel = vscode.window.createWebviewPanel(
		'codebaseGuide',
		'Codebase Guide',
		vscode.ViewColumn.One,
		{
			enableScripts: true
		}
	);

	currentPanel.onDidDispose(
		() => {
			currentPanel = undefined;
		},
		undefined,
		context.subscriptions
	);

	currentPanel.webview.onDidReceiveMessage(
		async message => {
			if (message?.command === 'learnFile' && typeof message.path === 'string') {
				await learnFile(message.path);
				await updateGuidePanel(currentPanel!);
				return;
			}
			if (message?.command === 'openFile' && typeof message.path === 'string') {
				const fileUri = vscode.Uri.file(message.path);
				const doc = await vscode.workspace.openTextDocument(fileUri);
				await vscode.window.showTextDocument(doc, { preview: false });
				return;
			}
			if (message?.command === 'jumpToLine' && typeof message.path === 'string' && typeof message.line === 'number') {
				const fileUri = vscode.Uri.file(message.path);
				const doc = await vscode.workspace.openTextDocument(fileUri);
				const editor = await vscode.window.showTextDocument(doc, { preview: false });
				const lineIndex = Math.max(0, message.line - 1);
				const range = new vscode.Range(lineIndex, 0, lineIndex, 0);
				editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
				editor.selection = new vscode.Selection(range.start, range.start);
				return;
			}
			if (message?.command === 'askNext' && typeof message.text === 'string') {
				const doc = currentLearnedUri
					? await vscode.workspace.openTextDocument(currentLearnedUri)
					: undefined;
				nextResponse = buildNextResponse(message.text, doc, currentSummary);
				if (doc && highlightDecoration && nextResponse?.evidence.length) {
					const ranges = nextResponse.evidence.map(item => new vscode.Range(item.line - 1, 0, item.line - 1, 0));
					const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.fsPath === doc.uri.fsPath);
					if (editor) {
						editor.setDecorations(highlightDecoration, ranges);
						editor.revealRange(ranges[0], vscode.TextEditorRevealType.InCenter);
					}
				}
				await updateGuidePanel(currentPanel!);
			}
		},
		undefined,
		context.subscriptions
	);

	await updateGuidePanel(currentPanel);
}

async function updateGuidePanel(panel: vscode.WebviewPanel): Promise<void> {
	const suggestions = await buildGuideSuggestions();
	const frameworks = await detectFrameworks();
	const allFiles = await buildAllFilesList();
	const walkthroughSteps = buildWalkthroughSteps(suggestions, frameworks);
	const nextSuggestions = currentLearnedUri
		? await buildNextSuggestions(currentLearnedUri, suggestions, walkthroughSteps)
		: [];
	panel.webview.html = getGuideHtml(suggestions, frameworks, allFiles, walkthroughSteps, currentSummary, nextResponse, nextSuggestions);
}

async function buildGuideSuggestions(): Promise<GuideSuggestion[]> {
	const patterns: Array<{ glob: string; reason: string }> = [
		{ glob: '**/README.md', reason: 'Project overview and setup notes.' },
		{ glob: '**/package.json', reason: 'Scripts, dependencies, and entry points.' },
		{ glob: '**/src/index.*', reason: 'Likely application entry point.' },
		{ glob: '**/src/main.*', reason: 'Likely application entry point.' },
		{ glob: '**/src/app.*', reason: 'Core app wiring and middleware.' },
		{ glob: '**/src/server.*', reason: 'HTTP server or runtime bootstrap.' },
		{ glob: '**/src/routes/**', reason: 'Route definitions and endpoints.' },
		{ glob: '**/src/controllers/**', reason: 'Endpoint handlers and business logic.' },
		{ glob: '**/src/pages/**', reason: 'UI routes or page-level components.' }
	];

	const exclude = '**/node_modules/**';
	const seen = new Set<string>();
	const suggestions: GuideSuggestion[] = [];

	for (const pattern of patterns) {
		const uris = await vscode.workspace.findFiles(pattern.glob, exclude, 20);
		for (const uri of uris) {
			const fsPath = uri.fsPath;
			if (seen.has(fsPath)) {
				continue;
			}
			seen.add(fsPath);
			suggestions.push({
				label: vscode.workspace.asRelativePath(uri),
				reason: pattern.reason,
				uri
			});
		}
	}

	return suggestions;
}

async function buildNextSuggestions(
	currentUri: vscode.Uri,
	suggestions: GuideSuggestion[],
	walkthroughSteps: Array<{ title: string; details: string; target?: vscode.Uri }>
): Promise<NextSuggestion[]> {
	const result: NextSuggestion[] = [];
	const seen = new Set<string>();
	seen.add(currentUri.fsPath);

	// 1. Parse imports/requires from the current file
	try {
		const doc = await vscode.workspace.openTextDocument(currentUri);
		const importPattern = /(?:import\s+.*?\s+from\s+['"](.+?)['"]|require\s*\(\s*['"](.+?)['"]\s*\))/g;
		const text = doc.getText();
		let match: RegExpExecArray | null;
		while ((match = importPattern.exec(text)) !== null) {
			const specifier = match[1] ?? match[2];
			if (!specifier || specifier.startsWith('.') === false) {
				continue;
			}
			// Resolve relative import
			const currentDir = vscode.Uri.joinPath(currentUri, '..');
			const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
			for (const ext of extensions) {
				const candidate = vscode.Uri.joinPath(currentDir, specifier + ext);
				try {
					await vscode.workspace.fs.stat(candidate);
					if (!seen.has(candidate.fsPath)) {
						seen.add(candidate.fsPath);
						const relPath = vscode.workspace.asRelativePath(candidate);
						const learned = learnedFiles.has(candidate.fsPath);
						result.push({
							label: relPath,
							reason: learned ? 'Imported by current file (already explored)' : 'Imported by current file',
							fsPath: candidate.fsPath
						});
					}
					break;
				} catch {
					// file doesn't exist with this extension, try next
				}
			}
		}
	} catch {
		// couldn't read file
	}

	// 2. If current file is in a walkthrough step, suggest the next step
	const currentFsPath = currentUri.fsPath;
	const stepIndex = walkthroughSteps.findIndex(s => s.target?.fsPath === currentFsPath);
	if (stepIndex !== -1) {
		for (let i = stepIndex + 1; i < walkthroughSteps.length; i++) {
			const step = walkthroughSteps[i];
			if (step.target && !seen.has(step.target.fsPath)) {
				seen.add(step.target.fsPath);
				result.push({
					label: vscode.workspace.asRelativePath(step.target),
					reason: `Next walkthrough step: ${step.title}`,
					fsPath: step.target.fsPath
				});
				break;
			}
		}
	}

	// 3. Suggest files from buildGuideSuggestions that haven't been learned
	for (const suggestion of suggestions) {
		if (!seen.has(suggestion.uri.fsPath) && !learnedFiles.has(suggestion.uri.fsPath)) {
			seen.add(suggestion.uri.fsPath);
			result.push({
				label: suggestion.label,
				reason: suggestion.reason,
				fsPath: suggestion.uri.fsPath
			});
		}
		if (result.length >= 6) {
			break;
		}
	}

	return result;
}

function getGuideHtml(
	suggestions: GuideSuggestion[],
	frameworks: string[],
	allFiles: FileEntry[],
	walkthroughSteps: Array<{ title: string; details: string; target?: vscode.Uri }>,
	summary: SummaryInfo | undefined,
	response: NextResponse | undefined,
	nextSuggestions: NextSuggestion[]
): string {
	const frameworkLine = frameworks.length
		? `<p class="frameworks">Detected: ${frameworks.map(escapeHtml).join(', ')}</p>`
		: `<p class="frameworks muted">Detected: none</p>`;

	// Merge suggested files and walkthrough steps into one unified list
	const unifiedCards: Array<{ label: string; reason: string; encodedPath: string; learned: boolean }> = [];
	const cardSeen = new Set<string>();

	for (const s of suggestions) {
		if (!cardSeen.has(s.uri.fsPath)) {
			cardSeen.add(s.uri.fsPath);
			unifiedCards.push({
				label: s.label,
				reason: s.reason,
				encodedPath: encodeURIComponent(s.uri.fsPath),
				learned: learnedFiles.has(s.uri.fsPath)
			});
		}
	}
	for (const step of walkthroughSteps) {
		if (step.target && !cardSeen.has(step.target.fsPath)) {
			cardSeen.add(step.target.fsPath);
			unifiedCards.push({
				label: vscode.workspace.asRelativePath(step.target),
				reason: `${step.title} — ${step.details}`,
				encodedPath: encodeURIComponent(step.target.fsPath),
				learned: learnedFiles.has(step.target.fsPath)
			});
		}
	}

	const cardsHtml = unifiedCards.map(card => `
		<div class="card${card.learned ? ' card-learned' : ''}">
			<div class="card-title">${escapeHtml(card.label)}</div>
			<div class="card-reason">${escapeHtml(card.reason)}</div>
			<button class="learn-btn" data-path="${card.encodedPath}">${card.learned ? 'Review' : 'Learn'}</button>
		</div>
	`).join('');

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

	// Step 2: Summary section
	const summarySection = summary ? `
		<section class="step" id="step-summary">
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

	// Step 3: Q&A section
	const qaSection = summary ? `
		<section class="step" id="step-qa">
			<h2>Ask a Question</h2>
			<div class="qa-input">
				<input id="nextQuestion" class="input" type="text" placeholder="e.g. How is routing handled?" />
				<button id="askNextBtn" class="action-btn">Ask</button>
			</div>
			${response ? `
				<div class="qa-result">
					<div class="summary-block"><strong>Q:</strong> ${escapeHtml(response.question)}</div>
					<div class="summary-block">${escapeHtml(response.message)}</div>
					${response.evidence.length ? `
						<div class="evidence">
							<strong>Highlighted lines:</strong>
							<ul>
								${response.evidence.map(item => `
									<li>
										<a class="fn-link" href="#" data-path="${encodeURIComponent(summary.filePath)}" data-line="${item.line}">
											L${item.line}
										</a>: ${escapeHtml(item.text)}
									</li>
								`).join('')}
							</ul>
						</div>
					` : '<div class="summary-block muted">No direct matches found in the current file.</div>'}
				</div>
			` : '<div class="summary-block muted">Ask a question to get evidence from the current file.</div>'}
		</section>
	` : '';

	// Step 4: Next suggestions
	const suggestionsSection = (summary && nextSuggestions.length) ? `
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

	return `
		<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8" />
			<meta name="viewport" content="width=device-width, initial-scale=1.0" />
			<title>Codebase Guide</title>
			<style>
				body {
					font-family: var(--vscode-font-family);
					padding: 16px;
					color: var(--vscode-editor-foreground);
					background: var(--vscode-editor-background);
				}
				.header {
					margin-bottom: 16px;
				}
				.header h1 {
					font-size: 18px;
					margin: 0 0 8px;
				}
				.header p {
					margin: 0;
					opacity: 0.8;
				}
				.frameworks {
					margin-top: 6px;
					font-size: 12px;
					opacity: 0.8;
				}
				.step {
					border: 1px solid var(--vscode-editorWidget-border);
					background: var(--vscode-editorWidget-background);
					border-radius: 8px;
					padding: 12px;
					margin-bottom: 16px;
				}
				.step h2 {
					margin: 0 0 8px;
					font-size: 16px;
				}
				.grid {
					display: grid;
					grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
					gap: 12px;
				}
				.card {
					border: 1px solid var(--vscode-editorWidget-border);
					background: var(--vscode-editorWidget-background);
					border-radius: 8px;
					padding: 12px;
					display: flex;
					flex-direction: column;
					gap: 8px;
				}
				.card-learned {
					opacity: 0.6;
				}
				.card-title {
					font-weight: 600;
					word-break: break-all;
				}
				.card-reason {
					font-size: 12px;
					opacity: 0.8;
				}
				.learn-btn, .action-btn {
					align-self: flex-start;
					background: var(--vscode-button-background);
					color: var(--vscode-button-foreground);
					border: none;
					padding: 6px 12px;
					border-radius: 6px;
					cursor: pointer;
				}
				.learn-btn:hover, .action-btn:hover {
					background: var(--vscode-button-hoverBackground);
				}
				.input {
					flex: 1;
					background: var(--vscode-input-background);
					color: var(--vscode-input-foreground);
					border: 1px solid var(--vscode-input-border);
					border-radius: 6px;
					padding: 6px 8px;
				}
				.file-search {
					display: flex;
					gap: 8px;
					align-items: center;
					margin-bottom: 12px;
				}
				.file-list {
					list-style: none;
					padding: 0;
					margin: 0;
					display: flex;
					flex-direction: column;
					gap: 6px;
					max-height: 300px;
					overflow-y: auto;
				}
				.file-item {
					display: flex;
					align-items: center;
					justify-content: space-between;
					gap: 12px;
					border: 1px solid var(--vscode-editorWidget-border);
					background: var(--vscode-editorWidget-background);
					border-radius: 6px;
					padding: 8px 10px;
				}
				.file-learned {
					opacity: 0.6;
				}
				.file-label {
					font-size: 12px;
					word-break: break-all;
				}
				.summary-meta {
					font-size: 12px;
					opacity: 0.7;
					margin-bottom: 8px;
				}
				.summary-block {
					font-size: 12px;
					margin-top: 6px;
				}
				.fn-list {
					margin: 6px 0 0;
					padding-left: 18px;
					font-size: 12px;
				}
				.fn-list li {
					margin-bottom: 4px;
				}
				.fn-link {
					color: var(--vscode-textLink-foreground);
					text-decoration: none;
					cursor: pointer;
				}
				.fn-link:hover {
					text-decoration: underline;
				}
				.qa-input {
					display: flex;
					gap: 8px;
					align-items: center;
					margin-bottom: 10px;
				}
				.qa-result {
					margin-top: 8px;
				}
				.evidence {
					margin-top: 8px;
					font-size: 12px;
				}
				.evidence ul {
					margin: 6px 0 0;
					padding-left: 18px;
				}
				.evidence li {
					margin-bottom: 4px;
				}
				.muted {
					font-size: 12px;
					opacity: 0.7;
				}
				.empty {
					padding: 16px;
					border: 1px dashed var(--vscode-editorWidget-border);
					border-radius: 8px;
					opacity: 0.8;
				}
				.divider {
					border: none;
					border-top: 1px solid var(--vscode-editorWidget-border);
					margin: 16px 0;
				}
			</style>
		</head>
		<body>
			<div class="header">
				<h1>Codebase Guide</h1>
				<p>Select a file to start learning. This extension never modifies your files.</p>
				${frameworkLine}
			</div>

			${summarySection}
			${qaSection}
			${suggestionsSection}

			${summarySection ? '<hr class="divider" />' : ''}

			<section id="step-files">
				<h2>Select a File</h2>
				<div class="grid" style="margin-bottom: 16px;">
					${unifiedCards.length ? cardsHtml : '<div class="empty">No common entry points found. Use the file list below.</div>'}
				</div>
				<h3>All Files</h3>
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

async function buildAllFilesList(): Promise<FileEntry[]> {
	const exclude = '**/{node_modules,.git,.vscode,.idea}/**';
	const uris = await vscode.workspace.findFiles('**/*', exclude);
	return uris.map(uri => ({
		label: vscode.workspace.asRelativePath(uri),
		uri
	}));
}

async function learnFile(filePath: string): Promise<void> {
	const fileUri = vscode.Uri.file(filePath);
	const doc = await vscode.workspace.openTextDocument(fileUri);
	const editor = await vscode.window.showTextDocument(doc, { preview: false });
	currentSummary = analyzeDocument(doc);
	nextResponse = undefined;
	currentLearnedUri = doc.uri;
	learnedFiles.add(doc.uri.fsPath);

	if (highlightDecoration) {
		const ranges = currentSummary.functions.map(item => new vscode.Range(item.line - 1, 0, item.line - 1, 0));
		editor.setDecorations(highlightDecoration, ranges);
		if (ranges.length) {
			editor.revealRange(ranges[0], vscode.TextEditorRevealType.InCenter);
		}
	}
}

function analyzeDocument(doc: vscode.TextDocument): SummaryInfo {
	const headings: string[] = [];
	const exports: string[] = [];
	const functions: Array<{ name: string; line: number }> = [];
	const isMarkdown = doc.languageId === 'markdown' || doc.fileName.toLowerCase().endsWith('.md');

	for (let i = 0; i < doc.lineCount; i += 1) {
		const lineText = doc.lineAt(i).text;

		if (isMarkdown) {
			const headingMatch = lineText.match(/^#{1,3}\s+(.*)$/);
			if (headingMatch && headings.length < 5) {
				headings.push(headingMatch[1].trim());
			}
		}

		const exportMatch = lineText.match(/^\s*export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type|enum)?\s*([A-Za-z0-9_]+)/);
		if (exportMatch && exportMatch[1] && exports.length < 8) {
			exports.push(exportMatch[1]);
		}

		const functionMatch = lineText.match(/^\s{0,2}(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/);
		if (functionMatch && functionMatch[1]) {
			functions.push({ name: functionMatch[1], line: i + 1 });
			continue;
		}

		const classMatch = lineText.match(/^\s{0,2}(?:export\s+)?class\s+([A-Za-z0-9_]+)/);
		if (classMatch && classMatch[1]) {
			functions.push({ name: classMatch[1], line: i + 1 });
			continue;
		}

		const arrowMatch = lineText.match(/^\s{0,2}(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/);
		if (arrowMatch && arrowMatch[1]) {
			functions.push({ name: arrowMatch[1], line: i + 1 });
		}
	}

	const uniqueExports = Array.from(new Set(exports));
	const uniqueFunctions = functions.filter(
		(item, index, array) => array.findIndex(entry => entry.name === item.name) === index
	);

	return {
		filePath: doc.uri.fsPath,
		relativePath: vscode.workspace.asRelativePath(doc.uri),
		lineCount: doc.lineCount,
		headings,
		exports: uniqueExports,
		functions: uniqueFunctions
	};
}

function buildNextResponse(
	question: string,
	doc: vscode.TextDocument | undefined,
	current: SummaryInfo | undefined
): NextResponse {
	const evidence: Array<{ line: number; text: string }> = [];
	const normalized = question.toLowerCase();
	const isHtml = doc?.languageId === 'html' || doc?.fileName.toLowerCase().endsWith('.html');
	const isCss = doc?.languageId === 'css' || doc?.fileName.toLowerCase().endsWith('.css');
	const tokens = normalized
		.split(/\W+/)
		.map(token => token.trim())
		.filter(token => token.length > 3);
	const stopwords = new Set(['what', 'which', 'where', 'when', 'then', 'this', 'that', 'with', 'from', 'have', 'your', 'about']);
	const keywords = tokens.filter(token => !stopwords.has(token));
	const classQuery = extractNamedQuery(normalized, 'class');
	const idQuery = extractNamedQuery(normalized, 'id');
	const selectorQuery = classQuery ? `.${classQuery}` : idQuery ? `#${idQuery}` : undefined;

	if (doc) {
		if ((isHtml || isCss) && (classQuery || idQuery)) {
			for (let i = 0; i < doc.lineCount; i += 1) {
				const lineText = doc.lineAt(i).text;
				const lowerLine = lineText.toLowerCase();
				if (isHtml) {
					if (classQuery && lowerLine.includes('class=') && lowerLine.includes(classQuery)) {
						evidence.push({ line: i + 1, text: lineText.trim() });
					} else if (idQuery && lowerLine.includes('id=') && lowerLine.includes(idQuery)) {
						evidence.push({ line: i + 1, text: lineText.trim() });
					}
				} else if (isCss && selectorQuery && lowerLine.includes(selectorQuery)) {
					evidence.push({ line: i + 1, text: lineText.trim() });
				}
				if (evidence.length >= 6) {
					break;
				}
			}
		}

		for (let i = 0; i < doc.lineCount; i += 1) {
			const lineText = doc.lineAt(i).text;
			const lowerLine = lineText.toLowerCase();
			if (evidence.length >= 6) {
				break;
			}
			if (keywords.some(keyword => lowerLine.includes(keyword))) {
				evidence.push({ line: i + 1, text: lineText.trim() });
			}
		}
	}

	let message = 'Here are the lines in this file that best match your question.';
	if (classQuery) {
		message = `Matching class "${classQuery}" in this file.`;
	} else if (idQuery) {
		message = `Matching id "${idQuery}" in this file.`;
	}
	if (!doc || !evidence.length) {
		message = 'I could not find matching lines in the current file. Try a different question or choose another file.';
	}

	if (current && current.functions.length && !evidence.length) {
		message = `I could not find direct matches, but this file has ${current.functions.length} key functions you can explore.`;
	}

	return {
		question,
		message,
		evidence
	};
}

function extractNamedQuery(input: string, keyword: 'class' | 'id'): string | undefined {
	const pattern = new RegExp(`${keyword}\\s*[:=]?\\s*['\"]?([a-zA-Z0-9_-]+)['\"]?`);
	const match = input.match(pattern);
	return match?.[1];
}

function buildWalkthroughSteps(
	suggestions: GuideSuggestion[],
	frameworks: string[]
): Array<{ title: string; details: string; target?: vscode.Uri }> {
	const findByEndsWith = (suffixes: string[]): vscode.Uri | undefined =>
		suggestions.find(suggestion => suffixes.some(suffix => suggestion.label.toLowerCase().endsWith(suffix)))?.uri;
	const findByContains = (snippet: string): vscode.Uri | undefined =>
		suggestions.find(suggestion => suggestion.label.toLowerCase().includes(snippet))?.uri;

	const steps = [
		{
			title: 'Read the README',
			details: 'Start with project goals, setup, and quickstart notes.',
			target: findByEndsWith(['readme.md'])
		},
		{
			title: 'Check package or build config',
			details: 'Look for scripts, dependencies, and entry points.',
			target: findByEndsWith(['package.json', 'pyproject.toml', 'pom.xml', 'build.gradle'])
		}
	];

	const has = (name: string) => frameworks.includes(name);

	if (has('Next.js')) {
		steps.push(
			{
				title: 'Review Next.js routing',
				details: 'Routes come from app/ or pages/ directories.',
				target: findByEndsWith([
					'app/layout.tsx',
					'app/page.tsx',
					'pages/_app.tsx',
					'pages/index.tsx'
				])
			},
			{
				title: 'Check API routes',
				details: 'Look under app/api or pages/api for endpoints.',
				target: findByContains('pages/api/') ?? findByContains('app/api/')
			}
		);
	}

	if (has('React') && has('Vite')) {
		steps.push(
			{
				title: 'Check Vite entry',
				details: 'Vite typically starts in src/main.tsx or src/main.jsx.',
				target: findByEndsWith(['src/main.tsx', 'src/main.jsx', 'src/main.ts', 'src/main.js'])
			},
			{
				title: 'Locate the root component',
				details: 'Trace into App.tsx or App.jsx.',
				target: findByEndsWith(['src/App.tsx', 'src/App.jsx', 'src/App.ts', 'src/App.js'])
			}
		);
	} else if (has('React')) {
		steps.push({
			title: 'Locate the root component',
			details: 'Trace into App.tsx or App.jsx.',
			target: findByEndsWith(['src/App.tsx', 'src/App.jsx', 'src/App.ts', 'src/App.js'])
		});
	}

	if (has('Vue')) {
		steps.push(
			{
				title: 'Check Vue entry',
				details: 'Vue apps typically start in src/main.ts or src/main.js.',
				target: findByEndsWith(['src/main.ts', 'src/main.js'])
			},
			{
				title: 'Review root component',
				details: 'Look for App.vue to understand layout and providers.',
				target: findByEndsWith(['src/App.vue'])
			},
			{
				title: 'Check routing',
				details: 'Vue Router lives in src/router.',
				target: findByContains('src/router/')
			}
		);
	}

	if (has('Angular')) {
		steps.push(
			{
				title: 'Check Angular module',
				details: 'AppModule wires components and providers.',
				target: findByEndsWith(['src/app/app.module.ts'])
			},
			{
				title: 'Check routing module',
				details: 'Routes live in app-routing.module.ts.',
				target: findByEndsWith(['src/app/app-routing.module.ts'])
			}
		);
	}

	if (has('Svelte')) {
		steps.push(
			{
				title: 'Check Svelte entry',
				details: 'SvelteKit routes live in src/routes.',
				target: findByContains('src/routes/')
			},
			{
				title: 'Check Svelte config',
				details: 'Svelte config defines adapters and preprocessors.',
				target: findByEndsWith(['svelte.config.js', 'svelte.config.ts'])
			}
		);
	}

	if (has('Astro')) {
		steps.push(
			{
				title: 'Check Astro pages',
				details: 'Astro routes live in src/pages.',
				target: findByContains('src/pages/')
			},
			{
				title: 'Check Astro config',
				details: 'Integrations and build settings are in astro.config.*.',
				target: findByEndsWith(['astro.config.mjs', 'astro.config.ts', 'astro.config.js'])
			}
		);
	}

	if (has('Nuxt')) {
		steps.push(
			{
				title: 'Check Nuxt app entry',
				details: 'Nuxt uses pages/ and app.vue for layout.',
				target: findByEndsWith(['app.vue', 'pages/index.vue'])
			},
			{
				title: 'Check Nuxt config',
				details: 'Modules and runtime config live in nuxt.config.*.',
				target: findByEndsWith(['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs'])
			}
		);
	}

	if (has('NestJS')) {
		steps.push(
			{
				title: 'Check NestJS entry',
				details: 'Bootstrap happens in main.ts.',
				target: findByEndsWith(['src/main.ts'])
			},
			{
				title: 'Inspect the root module',
				details: 'AppModule wires controllers and providers.',
				target: findByEndsWith(['src/app.module.ts'])
			}
		);
	}

	if (has('Express') || has('Fastify')) {
		steps.push(
			{
				title: 'Find server setup',
				details: 'Look for app.ts/server.ts to see middleware and routes.',
				target: findByEndsWith(['src/app.ts', 'src/server.ts', 'server.js', 'app.js'])
			},
			{
				title: 'Trace route registration',
				details: 'Routes are usually organized under src/routes.',
				target: findByContains('src/routes/')
			}
		);
	}

	steps.push(
		{
			title: 'Find the app entry point',
			details: 'Locate the main file that starts the app runtime.',
			target: findByEndsWith(['src/index.ts', 'src/index.js', 'src/main.ts', 'src/main.js', 'src/app.ts', 'src/app.js', 'src/server.ts', 'src/server.js'])
		},
		{
			title: 'Trace routes or pages',
			details: 'Identify how requests or pages are registered.',
			target: findByEndsWith(['src/routes/index.ts', 'src/routes/index.js', 'src/pages/index.tsx', 'src/pages/index.jsx'])
		},
		{
			title: 'Inspect controllers or handlers',
			details: 'See how endpoints map to logic.',
			target: suggestions.find(suggestion => suggestion.label.toLowerCase().includes('controllers/'))?.uri
		},
		{
			title: 'Follow data and services',
			details: 'Find services, database clients, or data access layers.',
			target: suggestions.find(suggestion => suggestion.label.toLowerCase().includes('services/'))?.uri
		}
	);

	return steps;
}

async function detectFrameworks(): Promise<string[]> {
	const frameworks = new Set<string>();
	const packageJson = await readWorkspacePackageJson();
	const deps = {
		...(packageJson?.dependencies ?? {}),
		...(packageJson?.devDependencies ?? {})
	};

	const hasDep = (name: string) => Object.prototype.hasOwnProperty.call(deps, name);

	if (hasDep('next')) {
		frameworks.add('Next.js');
	}
	if (hasDep('react')) {
		frameworks.add('React');
	}
	if (hasDep('vite')) {
		frameworks.add('Vite');
	}
	if (hasDep('vue')) {
		frameworks.add('Vue');
	}
	if (hasDep('@angular/core')) {
		frameworks.add('Angular');
	}
	if (hasDep('svelte') || hasDep('@sveltejs/kit')) {
		frameworks.add('Svelte');
	}
	if (hasDep('nuxt')) {
		frameworks.add('Nuxt');
	}
	if (hasDep('astro')) {
		frameworks.add('Astro');
	}
	if (hasDep('@nestjs/core')) {
		frameworks.add('NestJS');
	}
	if (hasDep('express')) {
		frameworks.add('Express');
	}
	if (hasDep('fastify')) {
		frameworks.add('Fastify');
	}

	if (frameworks.size > 0) {
		return Array.from(frameworks);
	}

	const fallbackFiles = [
		{ glob: '**/next.config.*', name: 'Next.js' },
		{ glob: '**/vite.config.*', name: 'Vite' },
		{ glob: '**/angular.json', name: 'Angular' },
		{ glob: '**/svelte.config.*', name: 'Svelte' },
		{ glob: '**/nuxt.config.*', name: 'Nuxt' },
		{ glob: '**/astro.config.*', name: 'Astro' },
		{ glob: '**/nest-cli.json', name: 'NestJS' }
	];

	for (const fallback of fallbackFiles) {
		const matches = await vscode.workspace.findFiles(fallback.glob, '**/node_modules/**', 1);
		if (matches.length) {
			frameworks.add(fallback.name);
		}
	}

	return Array.from(frameworks);
}

async function readWorkspacePackageJson(): Promise<
	| { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
	| undefined
> {
	const packageUris = await vscode.workspace.findFiles('**/package.json', '**/node_modules/**', 5);
	if (!packageUris.length) {
		return undefined;
	}

	const root = vscode.workspace.workspaceFolders?.[0];
	const selected = root
		? packageUris.find(uri => uri.fsPath.startsWith(root.uri.fsPath)) ?? packageUris[0]
		: packageUris[0];

	try {
		const content = await vscode.workspace.fs.readFile(selected);
		const json = JSON.parse(Buffer.from(content).toString('utf8'));
		return json;
	} catch {
		return undefined;
	}
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function parseLineRange(input: string, maxLines: number): { start: number; end: number } | null {
	const match = input.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
	if (!match) {
		return null;
	}

	const start = Math.max(1, Number(match[1]));
	const end = Math.max(start, Number(match[2] ?? match[1]));

	if (start > maxLines) {
		return null;
	}

	return {
		start: start - 1,
		end: Math.min(end, maxLines) - 1
	};
}
