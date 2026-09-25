<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { setSearch } from '$lib/url.svelte';

	// Local text is the source while typing; the URL is the source otherwise
	// (clear, Back, a shared link). `pushed` is the last value sent to the URL,
	// so the sync below only fires for changes made elsewhere — comparing with
	// `value` would wipe keystrokes before the debounce fires.
	const initial = page.url.searchParams.get('q') ?? '';
	let value = $state(initial);
	let pushed = $state(initial);
	let input: HTMLInputElement;
	let timer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		const fromUrl = page.url.searchParams.get('q') ?? '';
		if (fromUrl !== untrack(() => pushed)) {
			pushed = fromUrl;
			value = fromUrl;
		}
	});

	function onInput() {
		clearTimeout(timer);
		timer = setTimeout(() => {
			pushed = value.trim();
			setSearch(value);
		}, 250);
	}

	function onGlobalKey(e: KeyboardEvent) {
		const t = e.target as HTMLElement;
		if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) {
			e.preventDefault();
			input.focus();
			input.select();
		}
	}
</script>

<svelte:window onkeydown={onGlobalKey} />

<label class="search">
	<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="M13 13l4.5 4.5" /></svg>
	<input
		bind:this={input}
		type="search"
		autocomplete="off"
		spellcheck="false"
		placeholder="Search titles, descriptions, recipients, programmes…"
		aria-label="Search grants"
		bind:value
		oninput={onInput}
	/>
	<kbd>/</kbd>
</label>

<style>
	.search {
		flex: 1 1 22rem;
		max-width: 34rem;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0 0.6rem;
		height: 2.35rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--sunk);
	}
	.search:focus-within {
		border-color: var(--grants);
		background: var(--surface);
		box-shadow: 0 0 0 3px var(--grants-tint);
	}
	svg {
		width: 1rem;
		height: 1rem;
		flex: none;
		fill: none;
		stroke: var(--text-faint);
		stroke-width: 2;
		stroke-linecap: round;
	}
	input {
		flex: 1;
		min-width: 0;
		border: 0;
		background: none;
		outline: none;
		font-size: 0.9rem;
	}
	kbd {
		font-family: var(--mono);
		font-size: 0.7rem;
		color: var(--text-faint);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0 0.3rem;
	}
	.search:focus-within kbd {
		display: none;
	}
</style>
