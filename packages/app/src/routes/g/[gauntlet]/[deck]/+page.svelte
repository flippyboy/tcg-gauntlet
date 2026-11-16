<script lang="ts">
  import Breadcrumb from "#lib/components/Breadcrumb.svelte";
  import CardGroup from "#lib/components/CardGroup.svelte";
  import ExportMenu from "#lib/components/ExportMenu.svelte";
  import LegalityBadge from "#lib/components/LegalityBadge.svelte";
  import { formatDate } from "#lib/format";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{data.displayName}</title></svelte:head>

<Breadcrumb
  items={[
    { label: "Gauntlets", href: "/" },
    {
      label: data.gauntlet.name,
      href: `/g/${encodeURIComponent(data.gauntlet.folder)}`,
    },
    { label: data.displayName },
  ]}
/>

<h1>{data.displayName}</h1>

<div class="actions">
  <ExportMenu links={data.links} />
  <a class="button secondary" href={data.links.history}>History</a>
  <a class="button secondary" href={data.links.edit}>Edit on GitHub</a>
</div>

<LegalityBadge
  valid={data.legality.valid}
  errorCount={data.legality.errorCount}
  warningCount={data.legality.warningCount}
  violations={data.legality.violations}
  mtgjsonVersion={data.legality.mtgjsonVersion}
  mtgjsonDate={data.legality.mtgjsonDate}
/>

<dl class="meta">
  {#if data.formatName}<div>
      <dt>Format</dt>
      <dd>{data.formatName}</dd>
    </div>{/if}
  {#if data.meta.author}<div>
      <dt>Author</dt>
      <dd>{data.meta.author}</dd>
    </div>{/if}
  {#if data.meta.archetype}<div>
      <dt>Archetype</dt>
      <dd>{data.meta.archetype}</dd>
    </div>{/if}
  {#if data.meta.tags.length > 0}<div>
      <dt>Tags</dt>
      <dd>{data.meta.tags.join(", ")}</dd>
    </div>{/if}
  {#if data.meta.source}<div>
      <dt>Source</dt>
      <dd>{data.meta.source}</dd>
    </div>{/if}
  {#if data.meta.lastUpdated}<div>
      <dt>Updated</dt>
      <dd>
        <time datetime={data.meta.lastUpdated}
          >{formatDate(data.meta.lastUpdated)}</time
        >
      </dd>
    </div>{/if}
</dl>
{#if data.meta.description}<p>{data.meta.description}</p>{/if}

<section aria-labelledby="main-h">
  <h2 id="main-h">Main deck <span class="count">{data.mainCount}</span></h2>
  <div class="groups">
    {#each data.groups.main as group (group.name)}
      <CardGroup {group} />
    {/each}
  </div>
</section>

{#if data.groups.sideboard.length > 0}
  <section aria-labelledby="side-h">
    <h2 id="side-h">
      Sideboard <span class="count">{data.sideboardCount}</span>
    </h2>
    <div class="groups">
      {#each data.groups.sideboard as group (group.name)}
        <CardGroup {group} />
      {/each}
    </div>
  </section>
{/if}

{#if data.primerHtml}
  <section aria-labelledby="primer-h">
    <h2 id="primer-h">Primer</h2>
    <!-- Rendered by markdown-it with raw HTML turned off. -->
    <div class="prose primer">
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html data.primerHtml}
    </div>
  </section>
{/if}

<style>
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 1.25rem;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 2rem;
    margin: 1.25rem 0 0.75rem;
  }
  .meta div {
    min-width: 0;
  }
  dt {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .count {
    color: var(--muted);
    font-weight: 500;
    font-size: 1rem;
  }
  .groups {
    display: grid;
    gap: 0 2rem;
    align-items: start;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr));
  }
  .primer {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    padding: 0.5rem 1.25rem 1rem;
    overflow-wrap: anywhere;
  }
  .primer :global(img) {
    max-width: 100%;
  }
</style>
