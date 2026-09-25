<script lang="ts">
	/** A card that follows the cursor and flips left/up to stay on screen. */
	import type { Snippet } from 'svelte';

	let { x, y, children }: { x: number; y: number; children: Snippet } = $props();

	let el = $state<HTMLDivElement>();
	let pos = $state({ left: -9999, top: -9999 });

	$effect(() => {
		void children;
		if (!el) return;
		const pad = 12;
		const { width, height } = el.getBoundingClientRect();
		let left = x + 16;
		let top = y + 18;
		if (left + width + pad > innerWidth) left = Math.max(pad, x - width - 16);
		if (top + height + pad > innerHeight) top = Math.max(pad, y - height - 14);
		pos = { left, top };
	});
</script>

<div class="tip peek" bind:this={el} style:left="{pos.left}px" style:top="{pos.top}px" role="tooltip">
	{@render children()}
</div>

<style>
	.tip {
		position: fixed;
		z-index: 30;
		width: min(30rem, calc(100vw - 24px));
		max-height: min(26rem, calc(100vh - 24px));
		overflow: hidden;
		padding: 0.75rem 0.9rem 0.6rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: 0 10px 30px rgba(18, 26, 34, 0.16);
		pointer-events: none;
		font-size: 0.82rem;
	}
	.tip :global(h4) {
		margin: 0 0 0.35rem;
		font-size: 0.92rem;
		line-height: 1.3;
		color: var(--text-strong);
	}
	.tip :global(dl) {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.1rem 0.7rem;
		margin: 0;
		padding-top: 0.45rem;
		border-top: 1px solid var(--border-soft);
	}
	.tip :global(dt) {
		color: var(--text-faint);
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		line-height: 1.7;
	}
	.tip :global(dd) {
		margin: 0;
	}
	.tip :global(.money) {
		color: var(--money);
		font-weight: 600;
		font-family: var(--mono);
	}
	.tip :global(.foot) {
		margin: 0.45rem 0 0;
		font-size: 0.7rem;
		color: var(--text-faint);
	}
</style>
