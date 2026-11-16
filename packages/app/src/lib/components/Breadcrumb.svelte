<script lang="ts">
  // The path to the current page. The last item has no link.
  let { items }: { items: { label: string; href?: string }[] } = $props();
</script>

<nav class="breadcrumb" aria-label="Breadcrumb">
  <ol>
    {#each items as item, i (i)}
      <li aria-current={item.href === undefined ? "page" : undefined}>
        {#if item.href !== undefined}<a href={item.href}>{item.label}</a
          >{:else}{item.label}{/if}
      </li>
    {/each}
  </ol>
</nav>

<style>
  .breadcrumb {
    font-size: 0.9rem;
    color: var(--muted);
  }
  ol {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.5rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li + li::before {
    content: "/";
    margin-right: 0.5rem;
    color: var(--border);
  }
</style>
