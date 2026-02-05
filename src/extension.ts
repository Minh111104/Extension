// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

type GuideSuggestion = {
	label: string;
	reason: string;
	uri: vscode.Uri;
};

let currentPanel: vscode.WebviewPanel | undefined;
let highlightDecoration: vscode.TextEditorDecorationType | undefined;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log('Codebase Guide extension is active.');

	highlightDecoration = vscode.window.createTextEditorDecorationType({
		backgroundColor: new vscode.ThemeColor('editor.wordHighlightStrongBackground'),
		isWholeLine: true
	});
	context.subscriptions.push(highlightDecoration);

	const openGuideDisposable = vscode.commands.registerCommand('codebase-guide.openGuide', async () => {
		await openGuidePanel(context);
	});

	const highlightDisposable = vscode.commands.registerCommand('codebase-guide.highlightLines', async () => {
		await highlightLines();
	});

	context.subscriptions.push(openGuideDisposable, highlightDisposable);
}

// This method is called when your extension is deactivated
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
			if (message?.command === 'openFile' && typeof message.path === 'string') {
				const fileUri = vscode.Uri.file(message.path);
				const doc = await vscode.workspace.openTextDocument(fileUri);
				await vscode.window.showTextDocument(doc, { preview: false });
			}
		},
		undefined,
		context.subscriptions
	);

	await updateGuidePanel(currentPanel);
}

async function updateGuidePanel(panel: vscode.WebviewPanel): Promise<void> {
	const suggestions = await buildGuideSuggestions();
	panel.webview.html = getGuideHtml(suggestions);
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

function getGuideHtml(suggestions: GuideSuggestion[]): string {
	const cards = suggestions
		.map(suggestion => {
			const safeLabel = escapeHtml(suggestion.label);
			const safeReason = escapeHtml(suggestion.reason);
			const encodedPath = encodeURIComponent(suggestion.uri.fsPath);
			return `
				<div class="card">
					<div class="card-title">${safeLabel}</div>
					<div class="card-reason">${safeReason}</div>
					<button class="open-btn" data-path="${encodedPath}">Open file</button>
				</div>
			`;
		})
		.join('');

	const emptyState = `
		<div class="empty">
			No common entry points were found. Try opening a file and ask to highlight lines.
		</div>
	`;

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
				.grid {
					display: grid;
					grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
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
				.card-title {
					font-weight: 600;
					word-break: break-all;
				}
				.card-reason {
					font-size: 12px;
					opacity: 0.8;
				}
				.open-btn {
					align-self: flex-start;
					background: var(--vscode-button-background);
					color: var(--vscode-button-foreground);
					border: none;
					padding: 6px 12px;
					border-radius: 6px;
					cursor: pointer;
				}
				.open-btn:hover {
					background: var(--vscode-button-hoverBackground);
				}
				.empty {
					padding: 16px;
					border: 1px dashed var(--vscode-editorWidget-border);
					border-radius: 8px;
					opacity: 0.8;
				}
			</style>
		</head>
		<body>
			<div class="header">
				<h1>Codebase Guide</h1>
				<p>Pick a file to start learning the structure. This extension never overwrites your files.</p>
			</div>
			<div class="grid">
				${suggestions.length ? cards : emptyState}
			</div>
			<script>
				const vscode = acquireVsCodeApi();
				document.querySelectorAll('.open-btn').forEach(button => {
					button.addEventListener('click', event => {
						const path = event.currentTarget.getAttribute('data-path');
						if (!path) {
							return;
						}
						vscode.postMessage({ command: 'openFile', path: decodeURIComponent(path) });
					});
				});
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

async function highlightLines(): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor || !highlightDecoration) {
		vscode.window.showInformationMessage('Open a file to highlight lines.');
		return;
	}

	const input = await vscode.window.showInputBox({
		prompt: 'Enter a line or range to highlight (e.g. 12 or 12-20).',
		placeHolder: '12-20'
	});
	if (!input) {
		return;
	}

	const range = parseLineRange(input, editor.document.lineCount);
	if (!range) {
		vscode.window.showErrorMessage('Invalid range. Use the format 12 or 12-20.');
		return;
	}

	const decorationRange = new vscode.Range(
		range.start,
		0,
		range.end,
		editor.document.lineAt(range.end).range.end.character
	);

	editor.setDecorations(highlightDecoration, [decorationRange]);
	editor.revealRange(decorationRange, vscode.TextEditorRevealType.InCenter);
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
