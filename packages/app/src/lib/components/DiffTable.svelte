<script lang="ts">
  interface Entry {
    kind: "removed" | "added" | "count" | "printing";
    section: string;
    name: string;
    from?: number | string;
    to?: number | string;
  }

  // The card changes between two versions: added, removed, a different number of
  // copies, or a different printing.
  let { entries, from }: { entries: Entry[]; from: string } = $props();

  const label = {
    added: "Added",
    removed: "Removed",
    count: "Count changed",
    printing: "Printing changed",
  } as const;

  function change(e: Entry): string {
    switch (e.kind) {
      case "added":
        return `+${e.to ?? ""}`;
      case "removed":
        return `−${e.from ?? ""}`;
      case "count": {
        const d = Number(e.to) - Number(e.from);
        return `${d > 0 ? "+" : "−"}${Math.abs(d)} (${e.from} → ${e.to})`;
      }
      default:
        return `${e.from ?? ""} → ${e.to ?? ""}`;
    }
  }
</script>

{#if entries.length === 0}
  <p>No card changes since <code>{from.slice(0, 7)}</code>.</p>
{:else}
  <div class="scroll">
    <table>
      <caption class="sr-only">Card changes since {from.slice(0, 7)}</caption>
      <thead>
        <tr>
          <th scope="col">Change</th>
          <th scope="col">Card</th>
          <th scope="col">Section</th>
          <th scope="col" class="num">Difference</th>
        </tr>
      </thead>
      <tbody>
        {#each entries as e, i (i)}
          <tr class={e.kind}>
            <td><span class="kind">{label[e.kind]}</span></td>
            <th scope="row">{e.name}</th>
            <td>{e.section === "sideboard" ? "Sideboard" : "Main deck"}</td>
            <td class="num diff">{change(e)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  .scroll {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th,
  td {
    text-align: left;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid var(--border);
    vertical-align: baseline;
  }
  thead th {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  tbody th {
    font-weight: 600;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .diff {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    white-space: nowrap;
  }
  tr.added .diff {
    color: var(--ok);
  }
  tr.removed .diff {
    color: var(--bad);
  }
  tr.count .diff,
  tr.printing .diff {
    color: var(--warn);
  }
  .kind {
    font-size: 0.85rem;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
