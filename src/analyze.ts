import * as vscode from 'vscode';
import type { SummaryInfo, NextResponse } from './types';

export function inferFilePurpose(relativePath: string): string | undefined {
	const lower = relativePath.toLowerCase();
	const base = lower.split('/').pop()?.split('\\').pop() ?? '';
	if (base === 'readme.md' || base === 'readme') { return 'Project documentation and overview'; }
	if (base === 'package.json') { return 'Package scripts, dependencies, and entry points'; }
	if (base === 'tsconfig.json') { return 'TypeScript compiler configuration'; }
	if (base === 'vite.config.ts' || base === 'vite.config.js' || base === 'vite.config.mjs') { return 'Vite bundler configuration'; }
	if (base.startsWith('next.config.')) { return 'Next.js framework configuration'; }
	if (base.startsWith('tailwind.config.')) { return 'Tailwind CSS configuration'; }
	if (base.startsWith('eslint.config.') || base === '.eslintrc.js' || base === '.eslintrc.json') { return 'ESLint linting rules'; }
	if (base === 'docker-compose.yml' || base === 'dockerfile') { return 'Container build and orchestration config'; }
	if (base === 'go.mod') { return 'Go module definition and dependencies'; }
	if (base === 'cargo.toml') { return 'Rust package and dependency configuration'; }
	if (base === 'requirements.txt' || base === 'pyproject.toml') { return 'Python dependencies'; }
	if (lower.includes('/routes/') || lower.includes('\\routes\\')) { return 'Route definitions and URL mappings'; }
	if (lower.includes('/controllers/') || lower.includes('\\controllers\\')) { return 'Request handlers and business logic'; }
	if (lower.includes('/services/') || lower.includes('\\services\\')) { return 'Service layer and business operations'; }
	if (lower.includes('/models/') || lower.includes('\\models\\')) { return 'Data model definitions'; }
	if (lower.includes('/middleware/') || lower.includes('\\middleware\\')) { return 'HTTP middleware pipeline'; }
	if (lower.includes('/hooks/') || lower.includes('\\hooks\\')) { return 'React hooks and reusable stateful logic'; }
	if (lower.includes('/components/') || lower.includes('\\components\\')) { return 'UI component'; }
	if (lower.includes('/pages/') || lower.includes('\\pages\\')) { return 'Page-level component or route'; }
	if (lower.includes('/utils/') || lower.includes('/helpers/') || lower.includes('/lib/')) { return 'Utility functions and helpers'; }
	if (base === 'index.ts' || base === 'index.js' || base === 'index.tsx' || base === 'index.jsx') { return 'Module entry point or barrel export'; }
	if (base === 'main.ts' || base === 'main.js' || base === 'main.tsx' || base === 'main.jsx') { return 'Application entry point'; }
	if (base === 'app.ts' || base === 'app.tsx' || base === 'app.vue' || base === 'app.js') { return 'Root application component or setup'; }
	if (base === 'server.ts' || base === 'server.js') { return 'HTTP server bootstrap'; }
	if (base.endsWith('.test.ts') || base.endsWith('.spec.ts') || base.endsWith('.test.js') || base.endsWith('.spec.js')) { return 'Test suite'; }
	return undefined;
}

export function analyzeDocument(doc: vscode.TextDocument): SummaryInfo {
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

	const relativePath = vscode.workspace.asRelativePath(doc.uri);
	return {
		filePath: doc.uri.fsPath,
		relativePath,
		lineCount: doc.lineCount,
		headings,
		exports: uniqueExports,
		functions: uniqueFunctions,
		purposeHint: inferFilePurpose(relativePath)
	};
}

function getLineContext(doc: vscode.TextDocument, i: number): string[] {
	const before = i > 0 ? doc.lineAt(i - 1).text.trim() : '';
	const after = i + 1 < doc.lineCount ? doc.lineAt(i + 1).text.trim() : '';
	return [before, after];
}

function extractNamedQuery(input: string, keyword: 'class' | 'id'): string | undefined {
	const pattern = new RegExp(`${keyword}\\s*[:=]?\\s*['\"]?([a-zA-Z0-9_-]+)['\"]?`);
	return input.match(pattern)?.[1];
}

export function buildNextResponse(
	question: string,
	doc: vscode.TextDocument | undefined,
	current: SummaryInfo | undefined
): NextResponse {
	const evidence: Array<{ line: number; text: string; context: string[] }> = [];
	const normalized = question.toLowerCase();
	const isHtml = doc?.languageId === 'html' || doc?.fileName.toLowerCase().endsWith('.html');
	const isCss = doc?.languageId === 'css' || doc?.fileName.toLowerCase().endsWith('.css');
	const tokens = normalized.split(/\W+/).map(t => t.trim()).filter(t => t.length > 3);
	const stopwords = new Set(['what', 'which', 'where', 'when', 'then', 'this', 'that', 'with', 'from', 'have', 'your', 'about']);
	const keywords = tokens.filter(t => !stopwords.has(t));
	const classQuery = extractNamedQuery(normalized, 'class');
	const idQuery = extractNamedQuery(normalized, 'id');
	const selectorQuery = classQuery ? `.${classQuery}` : idQuery ? `#${idQuery}` : undefined;

	const addedLines = new Set<number>();

	if (doc) {
		if ((isHtml || isCss) && (classQuery || idQuery)) {
			for (let i = 0; i < doc.lineCount; i += 1) {
				const lineText = doc.lineAt(i).text;
				const lowerLine = lineText.toLowerCase();
				if (isHtml) {
					if (classQuery && lowerLine.includes('class=') && lowerLine.includes(classQuery)) {
						addedLines.add(i + 1);
						evidence.push({ line: i + 1, text: lineText.trim(), context: getLineContext(doc, i) });
					} else if (idQuery && lowerLine.includes('id=') && lowerLine.includes(idQuery)) {
						addedLines.add(i + 1);
						evidence.push({ line: i + 1, text: lineText.trim(), context: getLineContext(doc, i) });
					}
				} else if (isCss && selectorQuery && lowerLine.includes(selectorQuery)) {
					addedLines.add(i + 1);
					evidence.push({ line: i + 1, text: lineText.trim(), context: getLineContext(doc, i) });
				}
				if (evidence.length >= 6) { break; }
			}
		}

		for (let i = 0; i < doc.lineCount; i += 1) {
			if (evidence.length >= 6) { break; }
			const lineText = doc.lineAt(i).text;
			const lowerLine = lineText.toLowerCase();
			if (!addedLines.has(i + 1) && keywords.some(kw => lowerLine.includes(kw))) {
				evidence.push({ line: i + 1, text: lineText.trim(), context: getLineContext(doc, i) });
			}
		}
	}

	let message = 'Here are the lines in this file that best match your question.';
	if (classQuery) { message = `Matching class "${classQuery}" in this file.`; }
	else if (idQuery) { message = `Matching id "${idQuery}" in this file.`; }
	if (!doc || !evidence.length) { message = 'I could not find matching lines in the current file. Try a different question or choose another file.'; }
	if (current && current.functions.length && !evidence.length) {
		message = `I could not find direct matches, but this file has ${current.functions.length} key functions you can explore.`;
	}

	return { question, message, evidence };
}
