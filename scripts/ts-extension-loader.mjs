// Node strips TypeScript types but does not map TypeScript's source-level .js import specifiers to .ts files.
import { registerHooks } from 'node:module';

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier.endsWith('.js') && (specifier.startsWith('.') || specifier.startsWith('#lib/'))) {
			try {
				return nextResolve(specifier.slice(0, -3) + '.ts', context);
			} catch {
				// Actual JavaScript imports keep Node's normal resolution.
			}
		}
		return nextResolve(specifier, context);
	}
});
