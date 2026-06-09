import * as vscode from 'vscode';
import type { SummaryInfo, NextResponse } from './types';
import { buildGuideSuggestions, buildAllFilesList, buildNextSuggestions, detectFrameworks } from './discover';
import { analyzeDocument, buildNextResponse } from './analyze';
import { buildWalkthroughSteps } from './walkthrough';
import { getGuideHtml } from './webview';

let currentPanel: vscode.WebviewPanel | undefined;
let highlightDecoration: vscode.TextEditorDecorationType | undefined;
let currentSummary: SummaryInfo | undefined;
let nextResponse: NextResponse | undefined;
let currentLearnedUri: vscode.Uri | undefined;
const learnedFiles = new Set<string>();

export function activate(context: vscode.ExtensionContext) {
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
		{ enableScripts: true }
	);

	currentPanel.onDidDispose(() => { currentPanel = undefined; }, undefined, context.subscriptions);

	currentPanel.webview.onDidReceiveMessage(
		async message => {
			if (message?.command === 'learnFile' && typeof message.path === 'string') {
				try {
					await learnFile(message.path);
					await updateGuidePanel(currentPanel!);
				} catch {
					vscode.window.showErrorMessage(`Codebase Guide: Could not open file "${message.path}". It may have been moved or deleted.`);
				}
				return;
			}
			if (message?.command === 'openFile' && typeof message.path === 'string') {
				try {
					const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(message.path));
					await vscode.window.showTextDocument(doc, { preview: false });
				} catch {
					vscode.window.showErrorMessage(`Codebase Guide: Could not open file "${message.path}". It may have been moved or deleted.`);
				}
				return;
			}
			if (message?.command === 'jumpToLine' && typeof message.path === 'string' && typeof message.line === 'number') {
				const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(message.path));
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
		? await buildNextSuggestions(currentLearnedUri, suggestions, walkthroughSteps, learnedFiles)
		: [];

	const stepsWithTarget = walkthroughSteps.filter(s => s.target !== undefined);
	const learnedStepCount = stepsWithTarget.filter(s => learnedFiles.has(s.target!.fsPath)).length;
	const learnedFsPath = currentLearnedUri?.fsPath;
	const currentStepInfo = learnedFsPath
		? walkthroughSteps.find(s => s.target?.fsPath === learnedFsPath)
		: undefined;

	panel.webview.html = getGuideHtml(
		suggestions, frameworks, allFiles, walkthroughSteps,
		currentSummary, nextResponse, nextSuggestions,
		learnedStepCount, stepsWithTarget.length, currentStepInfo,
		learnedFiles
	);
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
		vscode.window.visibleTextEditors.forEach(e => e.setDecorations(highlightDecoration!, []));
		const ranges = currentSummary.functions.map(item => new vscode.Range(item.line - 1, 0, item.line - 1, 0));
		editor.setDecorations(highlightDecoration, ranges);
		if (ranges.length) {
			editor.revealRange(ranges[0], vscode.TextEditorRevealType.InCenter);
		}
	}
}
