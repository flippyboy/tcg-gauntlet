<script lang="ts">
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Gauntlets</title></svelte:head>

<h1>Gauntlets</h1>
{#if data.gauntlets.length === 0}
  <p>There are no gauntlets in this repository yet.</p>
{:else}
  <ul class="cards">
    {#each data.gauntlets as g (g.folder)}
      <li>
        <a class="card" href="/g/{encodeURIComponent(g.folder)}">
          <span class="name">{g.name}</span>
          {#if g.formatName}<span class="format">{g.formatName}</span>{/if}
          <span class="stats">
            {g.deckCount}
            {g.deckCount === 1 ? "deck" : "decks"}
            {#if g.invalidCount > 0}
              · <span class="bad">{g.invalidCount} not legal</span>
            {/if}
            {#if g.errorCount > 0}
              · <span class="bad"
                >{g.errorCount}
                {g.errorCount === 1 ? "problem" : "problems"}</span
              >
            {/if}
          </span>
        </a>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .cards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr));
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    height: 100%;
    padding: 1rem 1.1rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    color: var(--fg);
    text-decoration: none;
  }
  .card:hover,
  .card:focus-visible {
    border-color: var(--accent);
  }
  .name {
    font-size: 1.15rem;
    font-weight: 700;
  }
  .format {
    color: var(--accent);
    font-size: 0.9rem;
  }
  .stats {
    color: var(--muted);
    font-size: 0.9rem;
  }
  .bad {
    color: var(--bad);
  }
</style>
