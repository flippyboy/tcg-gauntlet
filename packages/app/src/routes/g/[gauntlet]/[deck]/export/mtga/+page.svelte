<script lang="ts">
  import Breadcrumb from "#lib/components/Breadcrumb.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  let copied = $state(false);
  let failed = $state(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(data.text);
      copied = true;
      failed = false;
    } catch {
      copied = false;
      failed = true;
    }
  }
</script>

<svelte:head><title>{data.displayName} for MTG Arena</title></svelte:head>

<Breadcrumb
  items={[
    { label: "Gauntlets", href: "/" },
    {
      label: data.gauntlet.name,
      href: `/g/${encodeURIComponent(data.gauntlet.folder)}`,
    },
    { label: data.displayName, href: data.base },
    { label: "MTG Arena" },
  ]}
/>

<h1>{data.displayName} for MTG Arena</h1>
<p>Copy the text, then use Import in the Arena deck builder.</p>

{#if data.unavailable.length > 0}
  <section class="warn" aria-label="Cards not on Arena">
    <h2>Not on Arena</h2>
    <p>These cards are not available on Arena and are left out of the list:</p>
    <ul>
      {#each data.unavailable as n (n)}<li>{n}</li>{/each}
    </ul>
  </section>
{/if}

<p class="row">
  <button type="button" onclick={copy}>Copy to clipboard</button>
  <span role="status">
    {#if copied}Copied.{:else if failed}Copying was blocked. Select the text
      below instead.{/if}
  </span>
</p>
<pre>{data.text}</pre>

<style>
  .warn {
    padding: 0.25rem 1rem 0.5rem;
    background: var(--warn-bg);
    color: var(--warn-fg);
    border: 1px solid var(--warn);
    border-radius: 0.5rem;
  }
  .warn h2 {
    margin-top: 0.5rem;
    font-size: 1.05rem;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
</style>
