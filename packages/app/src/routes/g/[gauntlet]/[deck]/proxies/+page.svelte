<script lang="ts">
  import { onMount } from "svelte";
  import Breadcrumb from "#lib/components/Breadcrumb.svelte";
  import {
    type BuildProgress,
    type Paper,
    buildProxyPdf,
    downloadPdf,
    pageCount,
  } from "#lib/client/pdf";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const total = $derived(
    data.cards.reduce((n, c) => n + c.count * (c.hasBackFace ? 2 : 1), 0),
  );
  const pages = $derived(pageCount(total));

  // Building needs JavaScript: it runs in the browser. Until the page is ready the
  // button stays off, and a note explains why for readers without scripts.
  let ready = $state(false);
  onMount(() => {
    ready = true;
  });

  let paper = $state<Paper>("a4");
  let cutLines = $state(true);
  let marginNote = $state(true);
  let busy = $state(false);
  let progress = $state<BuildProgress | null>(null);
  let error = $state<string | null>(null);
  let done = $state<string | null>(null);

  const fileName = $derived(
    `${data.name.replace(/[^A-Za-z0-9._-]+/g, "_") || "deck"}-proxies.pdf`,
  );

  async function build(): Promise<void> {
    busy = true;
    error = null;
    done = null;
    progress = null;
    try {
      const bytes = await buildProxyPdf(data.cards, {
        paper,
        cutLines,
        marginNote,
        onProgress: (p) => (progress = p),
      });
      downloadPdf(bytes, fileName);
      done = `${fileName} was saved: ${total} cards on ${pages} ${pages === 1 ? "page" : "pages"}.`;
    } catch (e) {
      error = e instanceof Error ? e.message : "The PDF could not be built.";
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Proxies for {data.displayName}</title></svelte:head>

<Breadcrumb
  items={[
    { label: "Gauntlets", href: "/" },
    {
      label: data.gauntlet.name,
      href: `/g/${encodeURIComponent(data.gauntlet.folder)}`,
    },
    { label: data.displayName, href: data.base },
    { label: "Print proxies" },
  ]}
/>

<h1>Proxies for {data.displayName}</h1>
<p>
  <span data-testid="card-total">{total}</span>
  {total === 1 ? "card" : "cards"} on
  <span data-testid="page-total">{pages}</span>
  {pages === 1 ? "page" : "pages"}, nine to a page at 63 × 88 mm. Double-faced
  cards print both faces. The PDF is built in your browser and saved to your
  device.
</p>

<form
  class="options"
  onsubmit={(e) => {
    e.preventDefault();
    void build();
  }}
>
  <fieldset disabled={busy}>
    <legend>Options</legend>
    <label>
      Paper
      <select bind:value={paper}>
        <option value="a4">A4 (210 × 297 mm)</option>
        <option value="letter">US Letter (8.5 × 11 in)</option>
      </select>
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={cutLines} />
      Cut lines in the margin
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={marginNote} />
      “Proxy — not for sale” note in the bottom margin
    </label>
  </fieldset>

  <p class="go">
    <button type="submit" disabled={!ready || busy || total === 0}>
      {busy ? "Building…" : "Download PDF"}
    </button>
    {#if busy && progress}
      <progress
        max={progress.total}
        value={progress.done}
        aria-label={progress.phase === "fetch"
          ? "Loading card images"
          : "Building the PDF"}
      ></progress>
      <span class="status" role="status">
        {progress.phase === "fetch"
          ? `Loading images ${progress.done} of ${progress.total}`
          : "Building the PDF"}
      </span>
    {/if}
  </p>
  <noscript>
    <p class="notice">
      Building the PDF needs JavaScript. The card list below can be printed or
      copied instead.
    </p>
  </noscript>
</form>

{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if done}<p class="done" role="status" data-testid="pdf-done">{done}</p>{/if}

<h2>Cards</h2>
<ul class="list">
  {#each data.cards as c (c.scryfallId)}
    <li>
      <span class="qty">{c.count}</span>
      {c.name}{c.hasBackFace ? " (double-faced, both faces print)" : ""}
    </li>
  {/each}
</ul>

<style>
  .options {
    display: grid;
    gap: 1rem;
    max-width: 38rem;
  }
  fieldset {
    display: grid;
    gap: 0.75rem;
    margin: 0;
    padding: 0.75rem 1rem 1rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
  }
  legend {
    padding: 0 0.4rem;
    font-weight: 600;
  }
  label {
    display: grid;
    gap: 0.25rem;
  }
  label.check {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  select {
    font: inherit;
    padding: 0.4rem;
    max-width: 100%;
    color: var(--fg);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 0.4rem;
  }
  .go {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    margin: 0;
  }
  progress {
    flex: 1 1 10rem;
    max-width: 20rem;
    accent-color: var(--accent);
  }
  .status {
    color: var(--muted);
    font-size: 0.9rem;
  }
  .notice,
  .error {
    padding: 0.6rem 1rem;
    border-radius: 0.5rem;
  }
  .error {
    background: var(--bad-bg);
    color: var(--bad);
    border: 1px solid var(--bad);
  }
  .done {
    color: var(--ok);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    columns: 16rem;
  }
  .list li {
    break-inside: avoid;
    padding: 0.15rem 0;
  }
  .qty {
    display: inline-block;
    min-width: 1.5rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
</style>
