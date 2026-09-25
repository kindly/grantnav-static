import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Connect, type Plugin } from 'vite';
import { createReadStream, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The data images are hundreds of MB and are deployed on their own
 * (../scripts/deploy_s3.sh), so they are not in static/ where every build would
 * copy them. Dev and preview serve them from here instead, and deliberately
 * the way S3 does: plain bytes, no Content-Encoding, so the page takes the same
 * .gz + DecompressionStream path it will take in production.
 */
const DATA_DIR = process.env.GRANTNAV_DATA ?? join(import.meta.dirname, '../data/site');

function serveData(): Plugin {
	const handler: Connect.NextHandleFunction = (req, res, next) => {
		const m = /^\/data\/([\w.-]+)$/.exec((req.url ?? '').split('?')[0]);
		if (!m) return next();
		let st;
		try {
			st = statSync(join(DATA_DIR, m[1]));
		} catch {
			res.statusCode = 404;
			return res.end();
		}
		res.setHeader('Content-Length', st.size);
		res.setHeader('Content-Type', 'application/octet-stream');
		res.setHeader('Last-Modified', st.mtime.toUTCString());
		res.setHeader('ETag', `"${st.size.toString(16)}-${st.mtimeMs.toString(16)}"`);
		if (req.method === 'HEAD') return res.end();
		createReadStream(join(DATA_DIR, m[1])).pipe(res);
	};
	return {
		name: 'grantnav-data',
		configureServer: (s) => void s.middlewares.use(handler),
		configurePreviewServer: (s) => void s.middlewares.use(handler)
	};
}

// SvelteKit config lives here, not in svelte.config.js (same as ../gem-explorer).
export default defineConfig({
	worker: { format: 'es' },
	// facetful resolves its worker and wasm with new URL(..., import.meta.url);
	// pre-bundling would move index.js away from them
	optimizeDeps: { exclude: ['facetful'] },
	plugins: [
		serveData(),
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// Pure static hosting (S3). One route; a grant opens as ?grant=<id>, so
			// no path ever needs a server-side fallback.
			adapter: adapter({ fallback: 'index.html' })
		})
	]
});
