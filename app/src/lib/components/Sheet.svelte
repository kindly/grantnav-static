<script lang="ts">
	/**
	 * The card that slides in on the right for a grant, funder or recipient.
	 * It sits over the page, so the filters and grid scroll position underneath
	 * are exactly where you left them.
	 */
	import type { Snippet } from 'svelte';
	import { closeCard } from '$lib/url.svelte';

	let { label, children }: { label: string; children: Snippet } = $props();
	let el = $state<HTMLElement>();

	// a new card (grant -> its funder -> one of their recipients) starts at the top
	$effect(() => {
		void label;
		if (el) el.scrollTop = 0;
	});
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && closeCard()} />

<div class="scrim" onclick={closeCard} aria-hidden="true"></div>
<article class="sheet" aria-label={label} bind:this={el}>
	<button class="close" onclick={closeCard} aria-label="Close">
		<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
	</button>
	{@render children()}
</article>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 40;
		background: rgba(18, 26, 34, 0.28);
	}
	.sheet {
		position: fixed;
		z-index: 41;
		top: 0;
		right: 0;
		bottom: 0;
		width: min(40rem, 100vw);
		overflow-y: auto;
		background: var(--surface);
		box-shadow: -10px 0 40px rgba(18, 26, 34, 0.18);
		padding: 1.4rem 1.6rem 2rem;
	}
	.close {
		position: sticky;
		top: 0;
		float: right;
		width: 2rem;
		height: 2rem;
		margin: -0.4rem -0.6rem 0 0.5rem;
		border: 1px solid var(--border);
		border-radius: 50%;
		background: var(--surface);
		color: var(--text-muted);
		cursor: pointer;
		display: grid;
		place-items: center;
		z-index: 1;
	}
	.close svg {
		width: 0.8rem;
		height: 0.8rem;
	}
	/* shared by every card's content */
	.sheet :global(h2) {
		margin: 0 0 0.6rem;
		font-size: 1.3rem;
		line-height: 1.25;
	}
	.sheet :global(h3) {
		margin: 1.2rem 0 0.4rem;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-faint);
	}
	.sheet :global(.kind) {
		margin: 0 0 0.2rem;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-faint);
	}
	.sheet :global(.muted) {
		color: var(--text-faint);
	}
	.sheet :global(.figures) {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
		gap: 0.6rem;
		margin: 0 0 0.6rem;
	}
	.sheet :global(.figures > div) {
		background: var(--sunk);
		border-radius: 8px;
		padding: 0.55rem 0.7rem;
		min-width: 0;
	}
	.sheet :global(.figures b) {
		display: block;
		font-size: 1rem;
		color: var(--text-strong);
		line-height: 1.3;
		overflow-wrap: anywhere;
	}
	.sheet :global(.figures b.money) {
		color: var(--money);
		font-family: var(--mono);
		font-size: 1.15rem;
	}
	.sheet :global(.figures b.grants) {
		color: var(--grants);
		font-family: var(--mono);
		font-size: 1.15rem;
	}
	.sheet :global(.figures span) {
		font-size: 0.72rem;
		color: var(--text-faint);
	}
	.sheet :global(a.org) {
		color: inherit;
		text-decoration: underline;
		text-decoration-color: var(--border);
		text-underline-offset: 3px;
	}
	.sheet :global(a.org:hover) {
		text-decoration-color: currentColor;
	}
	.sheet :global(.src) {
		margin-top: 1.6rem;
		font-size: 0.75rem;
		color: var(--text-faint);
	}
	.sheet :global(.src a) {
		color: var(--accent);
	}
</style>
