import * as vscode from 'vscode';
import type { GuideSuggestion, FileEntry, NextSuggestion, WalkthroughStep } from './types';

export async function buildGuideSuggestions(): Promise<GuideSuggestion[]> {
	const patterns: Array<{ glob: string; reason: string }> = [
		{ glob: '**/README.md', reason: 'Project overview and setup notes.' },
		{ glob: '**/package.json', reason: 'Scripts, dependencies, and entry points.' },
		{ glob: '**/src/index.*', reason: 'Likely application entry point.' },
		{ glob: '**/src/main.*', reason: 'Likely application entry point.' },
		{ glob: '**/src/app.*', reason: 'Core app wiring and middleware.' },
		{ glob: '**/src/server.*', reason: 'HTTP server or runtime bootstrap.' },
		{ glob: '**/src/routes/**', reason: 'Route definitions and endpoints.' },
		{ glob: '**/src/controllers/**', reason: 'Endpoint handlers and business logic.' },
		{ glob: '**/src/pages/**', reason: 'UI routes or page-level components.' },
		{ glob: '**/main.py', reason: 'Python application entry point.' },
		{ glob: '**/manage.py', reason: 'Django project manager.' },
		{ glob: '**/main.go', reason: 'Go application entry point.' },
		{ glob: '**/src/main.rs', reason: 'Rust application entry point.' },
		{ glob: '**/Cargo.toml', reason: 'Rust build config and dependencies.' },
		{ glob: '**/go.mod', reason: 'Go module definition.' },
		{ glob: '**/requirements.txt', reason: 'Python package dependencies.' }
	];

	const exclude = '**/node_modules/**';
	const seen = new Set<string>();
	const suggestions: GuideSuggestion[] = [];

	for (const pattern of patterns) {
		const uris = await vscode.workspace.findFiles(pattern.glob, exclude, 20);
		for (const uri of uris) {
			if (seen.has(uri.fsPath)) { continue; }
			seen.add(uri.fsPath);
			suggestions.push({ label: vscode.workspace.asRelativePath(uri), reason: pattern.reason, uri });
		}
	}

	return suggestions;
}

export async function buildAllFilesList(): Promise<FileEntry[]> {
	const exclude = '**/{node_modules,.git,.vscode,.idea}/**';
	const uris = await vscode.workspace.findFiles('**/*', exclude, 2000);
	return uris.map(uri => ({ label: vscode.workspace.asRelativePath(uri), uri }));
}

export async function buildNextSuggestions(
	currentUri: vscode.Uri,
	suggestions: GuideSuggestion[],
	walkthroughSteps: WalkthroughStep[],
	learnedFiles: ReadonlySet<string>
): Promise<NextSuggestion[]> {
	const result: NextSuggestion[] = [];
	const seen = new Set<string>();
	seen.add(currentUri.fsPath);

	// 1. Relative imports from the current file
	try {
		const doc = await vscode.workspace.openTextDocument(currentUri);
		const importPattern = /(?:import\s+.*?\s+from\s+['"](.+?)['"]|require\s*\(\s*['"](.+?)['"]\s*\))/g;
		const text = doc.getText();
		let match: RegExpExecArray | null;
		while ((match = importPattern.exec(text)) !== null) {
			const specifier = match[1] ?? match[2];
			if (!specifier?.startsWith('.')) { continue; }
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
				} catch { /* extension not found, try next */ }
			}
		}
	} catch { /* couldn't read file */ }

	if (result.length >= 6) { return result; }

	// 2. Next step in the walkthrough after the current file
	const stepIndex = walkthroughSteps.findIndex(s => s.target?.fsPath === currentUri.fsPath);
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

	if (result.length >= 6) { return result; }

	// 3. Unlearned suggested files
	for (const suggestion of suggestions) {
		if (!seen.has(suggestion.uri.fsPath) && !learnedFiles.has(suggestion.uri.fsPath)) {
			seen.add(suggestion.uri.fsPath);
			result.push({ label: suggestion.label, reason: suggestion.reason, fsPath: suggestion.uri.fsPath });
		}
		if (result.length >= 6) { break; }
	}

	return result;
}

export async function detectFrameworks(): Promise<string[]> {
	const frameworks = new Set<string>();
	const packageJson = await readWorkspacePackageJson();
	const deps = { ...(packageJson?.dependencies ?? {}), ...(packageJson?.devDependencies ?? {}) };
	const hasDep = (name: string) => Object.prototype.hasOwnProperty.call(deps, name);

	if (hasDep('next')) { frameworks.add('Next.js'); }
	if (hasDep('react')) { frameworks.add('React'); }
	if (hasDep('vite')) { frameworks.add('Vite'); }
	if (hasDep('vue')) { frameworks.add('Vue'); }
	if (hasDep('@angular/core')) { frameworks.add('Angular'); }
	if (hasDep('svelte') || hasDep('@sveltejs/kit')) { frameworks.add('Svelte'); }
	if (hasDep('nuxt')) { frameworks.add('Nuxt'); }
	if (hasDep('astro')) { frameworks.add('Astro'); }
	if (hasDep('@nestjs/core')) { frameworks.add('NestJS'); }
	if (hasDep('express')) { frameworks.add('Express'); }
	if (hasDep('fastify')) { frameworks.add('Fastify'); }

	if (frameworks.size > 0) { return Array.from(frameworks); }

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
		if (matches.length) { frameworks.add(fallback.name); }
	}

	return Array.from(frameworks);
}

async function readWorkspacePackageJson(): Promise<
	| { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
	| undefined
> {
	const packageUris = await vscode.workspace.findFiles('**/package.json', '**/node_modules/**', 5);
	if (!packageUris.length) { return undefined; }

	const root = vscode.workspace.workspaceFolders?.[0];
	const selected = root
		? packageUris.find(uri => uri.fsPath.startsWith(root.uri.fsPath)) ?? packageUris[0]
		: packageUris[0];

	try {
		const content = await vscode.workspace.fs.readFile(selected);
		return JSON.parse(Buffer.from(content).toString('utf8'));
	} catch {
		return undefined;
	}
}
