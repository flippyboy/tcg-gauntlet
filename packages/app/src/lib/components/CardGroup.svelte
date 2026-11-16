<script lang="ts">
  import type { GroupView } from "#lib/view-types";
  import CardPreview from "./CardPreview.svelte";

  // One type group: a heading with the number of cards, then a row per entry.
  let {
    group,
    showPrintings = true,
  }: { group: GroupView; showPrintings?: boolean } = $props();
</script>

<section class="group" aria-label="{group.name}, {group.count} cards">
  <h3>
    {group.name} <span class="total">{group.count}</span>
  </h3>
  <ul>
    {#each group.cards as c, i (i)}
      <li class:unknown={!c.known}>
        <span class="qty" aria-label="{c.count} copies">{c.count}</span>
        <span class="card">
          <CardPreview name={c.name} image={c.normal} />
          {#if !c.known}<span class="flag">unknown card</span>{/if}
        </span>
        {#if showPrintings && c.set}
          <span class="set">{c.set}{c.number ? ` ${c.number}` : ""}</span>
        {/if}
      </li>
    {/each}
  </ul>
</section>

<style>
  .group {
    break-inside: avoid;
    margin: 0 0 1.25rem;
  }
  h3 {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin: 0 0 0.35rem;
    padding-bottom: 0.25rem;
    border-bottom: 1px solid var(--border);
    font-size: 0.95rem;
    letter-spacing: 0.02em;
  }
  .total {
    color: var(--muted);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: grid;
    grid-template-columns: 1.75rem 1fr auto;
    align-items: baseline;
    gap: 0.25rem;
    padding: 0.15rem 0;
  }
  .qty {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    text-align: right;
    padding-right: 0.35rem;
  }
  .set {
    color: var(--muted);
    font-size: 0.8rem;
    text-transform: uppercase;
    font-variant-numeric: tabular-nums;
  }
  .flag {
    margin-left: 0.4rem;
    color: var(--bad);
    font-size: 0.8rem;
  }
</style>
