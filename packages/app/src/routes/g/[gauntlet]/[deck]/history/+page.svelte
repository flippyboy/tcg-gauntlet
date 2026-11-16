<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import Breadcrumb from "#lib/components/Breadcrumb.svelte";
  import { formatDate } from "#lib/format";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  // The two-version picker needs JavaScript. Every row also links to the changes
  // since the version before it, which works without.
  let enhanced = $state(false);
  onMount(() => {
    enhanced = true;
  });
  let from = $state("");
  let to = $state("");
  $effect(() => {
    if (to === "") to = data.versions[0]?.commit ?? "";
    if (from === "") from = data.versions[1]?.commit ?? "";
  });

  const label = (v: PageData["versions"][number]): string =>
    `${v.short} · ${formatDate(v.date)} · ${v.subject}`;

  function compare(e: SubmitEvent): void {
    e.preventDefault();
    if (from !== "" && to !== "" && from !== to)
      void goto(`${data.base}/v/${to}?compare=${from}`);
  }
</script>

<svelte:head><title>History of {data.displayName}</title></svelte:head>

<Breadcrumb
  items={[
    { label: "Gauntlets", href: "/" },
    {
      label: data.gauntlet.name,
      href: `/g/${encodeURIComponent(data.gauntlet.folder)}`,
    },
    { label: data.displayName, href: data.base },
    { label: "History" },
  ]}
/>

<h1>History of {data.displayName}</h1>

{#if data.versions.length === 0}
  <p>This deck has no recorded versions.</p>
{:else}
  <p class="note">
    One version is one commit on the tracked branch. Showing at most {data.limit},
    newest first.
  </p>

  {#if enhanced && data.versions.length > 1}
    <form class="picker" onsubmit={compare} aria-label="Compare two versions">
      <label>
        From (older)
        <select bind:value={from}>
          {#each data.versions as v (v.seq)}
            <option value={v.commit}>{label(v)}</option>
          {/each}
        </select>
      </label>
      <label>
        To (newer)
        <select bind:value={to}>
          {#each data.versions as v (v.seq)}
            <option value={v.commit}>{label(v)}</option>
          {/each}
        </select>
      </label>
      <button type="submit" disabled={from === to}>Compare</button>
    </form>
  {/if}

  <ol class="versions">
    {#each data.versions as v, i (v.seq)}
      {@const older = data.versions[i + 1]}
      <li>
        <div class="head">
          <a class="sha" href="{data.base}/v/{v.commit}"
            ><code>{v.short}</code></a
          >
          <time datetime={v.date}>{formatDate(v.date)}</time>
          <span class="who">{v.author}</span>
          <span class="tag"
            >{v.status}{v.changed.includes("md") ? ", primer" : ""}</span
          >
        </div>
        <p class="subject">{v.subject}</p>
        <p class="links">
          <a href="{data.base}/v/{v.commit}">View this version</a>
          {#if older}
            <a href="{data.base}/v/{v.commit}?compare={older.commit}"
              >Changes since {older.short}</a
            >
          {/if}
          <a href={v.commitUrl}>On GitHub</a>
        </p>
      </li>
    {/each}
  </ol>
{/if}

<style>
  .note {
    color: var(--muted);
  }
  .picker {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.75rem;
    margin: 1rem 0 1.5rem;
    padding: 0.85rem 1rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
  }
  label {
    display: grid;
    gap: 0.2rem;
    font-size: 0.85rem;
    color: var(--muted);
    min-width: 0;
    flex: 1 1 14rem;
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
  .versions {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.75rem;
  }
  li {
    padding: 0.75rem 1rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 0.9rem;
  }
  .who,
  time {
    color: var(--muted);
    font-size: 0.9rem;
  }
  .tag {
    margin-left: auto;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .subject {
    margin: 0.3rem 0;
    overflow-wrap: anywhere;
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    margin: 0;
    font-size: 0.9rem;
  }
</style>
