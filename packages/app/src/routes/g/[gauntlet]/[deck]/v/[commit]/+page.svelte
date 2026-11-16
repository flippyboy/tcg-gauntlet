<script lang="ts">
  import Breadcrumb from "#lib/components/Breadcrumb.svelte";
  import CardGroup from "#lib/components/CardGroup.svelte";
  import DiffTable from "#lib/components/DiffTable.svelte";
  import { formatDate } from "#lib/format";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
</script>

<svelte:head
  ><title>{data.displayName} at {data.version.commit.slice(0, 7)}</title
  ></svelte:head
>

<Breadcrumb
  items={[
    { label: "Gauntlets", href: "/" },
    {
      label: data.gauntlet.name,
      href: `/g/${encodeURIComponent(data.gauntlet.folder)}`,
    },
    { label: data.displayName, href: data.base },
    { label: "History", href: `${data.base}/history` },
    { label: data.version.commit.slice(0, 7) },
  ]}
/>

<h1>{data.displayName} at <code>{data.version.commit.slice(0, 7)}</code></h1>
<p class="byline">
  <time datetime={data.version.date}>{formatDate(data.version.date)}</time> by {data
    .version.author}: {data.version.subject}
  (<a href={data.version.commitUrl}>on GitHub</a>)
</p>

{#if data.diff}
  <section aria-labelledby="changes-h">
    <h2 id="changes-h">
      Changes since <code>{data.diff.from.slice(0, 7)}</code>
    </h2>
    {#if data.diff.unavailable}
      <p>One of the versions does not parse, so there is no card diff.</p>
    {:else}
      <DiffTable entries={data.diff.entries} from={data.diff.from} />
    {/if}
  </section>
{/if}

{#if data.notice}<p class="notice" role="note">{data.notice}</p>{/if}

{#if data.groups}
  <section aria-labelledby="list-h">
    <h2 id="list-h">Main deck</h2>
    <div class="groups">
      {#each data.groups.main as group, i (i)}
        <CardGroup {group} showPrintings={false} />
      {/each}
    </div>
  </section>
  {#if data.groups.sideboard.length > 0}
    <section aria-labelledby="side-h">
      <h2 id="side-h">Sideboard</h2>
      <div class="groups">
        {#each data.groups.sideboard as group, i (i)}
          <CardGroup {group} showPrintings={false} />
        {/each}
      </div>
    </section>
  {/if}
{:else if data.raw !== null}
  <pre>{data.raw}</pre>
{/if}

{#if data.primerHtml}
  <section aria-labelledby="primer-h">
    <h2 id="primer-h">Primer at this version</h2>
    <div class="prose">
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html data.primerHtml}
    </div>
  </section>
{/if}

<style>
  .byline {
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .notice {
    padding: 0.6rem 1rem;
    background: var(--warn-bg);
    color: var(--warn-fg);
    border: 1px solid var(--warn);
    border-radius: 0.5rem;
  }
  .groups {
    display: grid;
    gap: 0 2rem;
    align-items: start;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr));
  }
</style>
