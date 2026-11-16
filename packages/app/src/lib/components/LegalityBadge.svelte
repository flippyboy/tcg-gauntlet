<script lang="ts">
  import type { ViolationView } from "#lib/view-types";

  // Legal or not legal, with the MTGJSON version the verdict used and an expandable
  // list of violations. `compact` shows only the pill, for tables.
  let {
    valid,
    errorCount,
    warningCount,
    violations = [],
    mtgjsonVersion = null,
    mtgjsonDate = null,
    compact = false,
  }: {
    valid: boolean;
    errorCount: number;
    warningCount: number;
    violations?: ViolationView[];
    mtgjsonVersion?: string | null;
    mtgjsonDate?: string | null;
    compact?: boolean;
  } = $props();

  const summary = $derived(
    [
      errorCount > 0
        ? `${errorCount} ${errorCount === 1 ? "error" : "errors"}`
        : "",
      warningCount > 0
        ? `${warningCount} ${warningCount === 1 ? "warning" : "warnings"}`
        : "",
    ]
      .filter((s) => s !== "")
      .join(", "),
  );
</script>

{#if compact}
  <span class="pill" class:ok={valid} class:bad={!valid}>
    <span aria-hidden="true">{valid ? "✓" : "✗"}</span>
    {valid ? "Legal" : "Not legal"}{#if summary}<span class="sr-only"
        >, {summary}</span
      >{/if}
  </span>
  {#if summary}<span class="counts" aria-hidden="true">{summary}</span>{/if}
{:else}
  <section class="badge" aria-label="Legality">
    <p class="line">
      <span class="pill big" class:ok={valid} class:bad={!valid}>
        <span aria-hidden="true">{valid ? "✓" : "✗"}</span>
        {valid ? "Legal" : "Not legal"}
      </span>
      {#if mtgjsonVersion}
        <span class="version">
          checked with MTGJSON <code>{mtgjsonVersion}</code
          >{#if mtgjsonDate}&nbsp;({mtgjsonDate}){/if}
        </span>
      {/if}
    </p>
    {#if violations.length > 0}
      <details open={!valid}>
        <summary>{summary || "Notes"}</summary>
        <ul>
          {#each violations as v, i (i)}
            <li class={v.severity}>
              <span class="sev">{v.severity}</span>
              <code>{v.code}</code>
              {#if v.line !== null}<span class="at">line {v.line}</span>{/if}
              <span class="msg">{v.message}</span>
              {#if v.suggestion}<em class="hint">{v.suggestion}</em>{/if}
            </li>
          {/each}
        </ul>
      </details>
    {/if}
  </section>
{/if}

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.1rem 0.6rem;
    border-radius: 999px;
    border: 1px solid currentColor;
    font-size: 0.85rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .pill.big {
    font-size: 1rem;
    padding: 0.2rem 0.85rem;
  }
  .ok {
    color: var(--ok);
    background: var(--ok-bg);
  }
  .bad {
    color: var(--bad);
    background: var(--bad-bg);
  }
  .counts {
    margin-left: 0.4rem;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.9rem;
    margin: 0;
  }
  .version {
    color: var(--muted);
    font-size: 0.9rem;
  }
  details {
    margin-top: 0.6rem;
  }
  summary {
    cursor: pointer;
    font-weight: 600;
    padding: 0.25rem 0;
  }
  summary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  ul {
    list-style: none;
    margin: 0.4rem 0 0;
    padding: 0;
    display: grid;
    gap: 0.35rem;
  }
  li {
    padding: 0.4rem 0.6rem;
    border-left: 3px solid var(--border);
    background: var(--surface);
    border-radius: 0 0.4rem 0.4rem 0;
    overflow-wrap: anywhere;
  }
  li.error {
    border-left-color: var(--bad);
  }
  li.warning {
    border-left-color: var(--warn);
  }
  .sev {
    text-transform: uppercase;
    font-size: 0.7rem;
    letter-spacing: 0.06em;
    color: var(--muted);
    margin-right: 0.3rem;
  }
  .at {
    color: var(--muted);
    font-size: 0.85rem;
  }
  .hint {
    display: block;
    color: var(--muted);
    font-size: 0.9rem;
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
