<script lang="ts">
  import Breadcrumb from "#lib/components/Breadcrumb.svelte";
  import LegalityBadge from "#lib/components/LegalityBadge.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  const deckHref = (name: string): string =>
    `/g/${encodeURIComponent(data.folder)}/${encodeURIComponent(name)}`;
</script>

<svelte:head><title>{data.name}</title></svelte:head>

<Breadcrumb items={[{ label: "Gauntlets", href: "/" }, { label: data.name }]} />
<h1>{data.name}</h1>
{#if data.formatName}<p class="format">
    Format: <strong>{data.formatName}</strong>
  </p>{/if}

{#if data.descriptionHtml}
  <!-- Rendered by markdown-it with raw HTML turned off. -->
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  <section class="prose">{@html data.descriptionHtml}</section>
{/if}

{#if data.errors.length > 0}
  <section class="problems" aria-label="Gauntlet problems">
    <h2>Problems</h2>
    <ul>
      {#each data.errors as e, i (i)}
        <li><code>{e.code}</code> {e.message}</li>
      {/each}
    </ul>
  </section>
{/if}

<h2>Decks ({data.deckCount})</h2>
{#if data.decks.length === 0}
  <p>There are no decks in this gauntlet yet.</p>
{:else}
  <div class="scroll">
    <table>
      <thead>
        <tr>
          <th scope="col">Deck</th>
          <th scope="col" class="hide-small">Archetype</th>
          <th scope="col" class="hide-small">Tags</th>
          <th scope="col">Legality</th>
        </tr>
      </thead>
      <tbody>
        {#each data.decks as d (d.name)}
          <tr>
            <th scope="row"><a href={deckHref(d.name)}>{d.displayName}</a></th>
            <td class="hide-small">{d.archetype ?? ""}</td>
            <td class="hide-small">{d.tags.join(", ")}</td>
            <td>
              <LegalityBadge
                compact
                valid={d.valid}
                errorCount={d.errorCount}
                warningCount={d.warningCount}
              />
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<p><a class="button secondary" href={data.newDeckUrl}>New deck on GitHub</a></p>

<style>
  .format {
    color: var(--muted);
  }
  .problems {
    padding: 0.5rem 1rem;
    border: 1px solid var(--bad);
    border-radius: 0.5rem;
    background: var(--bad-bg);
  }
  .scroll {
    overflow-x: auto;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    margin-bottom: 1.5rem;
  }
  table {
    width: 100%;
  }
  th,
  td {
    text-align: left;
    padding: 0.6rem 0.85rem;
    border-bottom: 1px solid var(--border);
    vertical-align: baseline;
  }
  tbody tr:last-child > * {
    border-bottom: 0;
  }
  thead th {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  @media (max-width: 40rem) {
    .hide-small {
      display: none;
    }
  }
</style>
