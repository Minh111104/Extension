import * as vscode from 'vscode';
import type { GuideSuggestion, WalkthroughStep } from './types';

export function buildWalkthroughSteps(
	suggestions: GuideSuggestion[],
	frameworks: string[]
): WalkthroughStep[] {
	const findByEndsWith = (suffixes: string[]): vscode.Uri | undefined =>
		suggestions.find(s => suffixes.some(suffix => s.label.toLowerCase().endsWith(suffix)))?.uri;
	const findByContains = (snippet: string): vscode.Uri | undefined =>
		suggestions.find(s => s.label.toLowerCase().includes(snippet))?.uri;

	const steps: WalkthroughStep[] = [
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
				target: findByEndsWith(['app/layout.tsx', 'app/page.tsx', 'pages/_app.tsx', 'pages/index.tsx'])
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
			target: suggestions.find(s => s.label.toLowerCase().includes('controllers/'))?.uri
		},
		{
			title: 'Follow data and services',
			details: 'Find services, database clients, or data access layers.',
			target: suggestions.find(s => s.label.toLowerCase().includes('services/'))?.uri
		}
	);

	return steps;
}
