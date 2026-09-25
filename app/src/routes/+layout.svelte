<script lang="ts">
	import '$lib/theme.css';
	let { children } = $props();
</script>

<svelte:head>
	<title>GrantNav Static</title>
</svelte:head>

{@render children()}
