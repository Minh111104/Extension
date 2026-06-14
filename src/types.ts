import * as vscode from 'vscode';

export type GuideSuggestion = {
	label: string;
	reason: string;
	uri: vscode.Uri;
};

export type FileEntry = {
	label: string;
	uri: vscode.Uri;
};

export type SummaryInfo = {
	filePath: string;
	relativePath: string;
	lineCount: number;
	headings: string[];
	exports: string[];
	functions: Array<{ name: string; line: number }>;
	purposeHint: string | undefined;
};

export type NextResponse = {
	question: string;
	message: string;
	evidence: Array<{ line: number; text: string; context: string[]; enclosingSymbol: string | undefined }>;
};

export type NextSuggestion = {
	label: string;
	reason: string;
	fsPath: string;
};

export type WalkthroughStep = {
	title: string;
	details: string;
	target?: vscode.Uri;
};
