<script lang="ts">
  import { onMount } from "svelte";

  // A card name that shows the card's `normal` image on hover, on keyboard focus and
  // on tap. Without JavaScript (and for a card with no image) it is plain text. The
  // image is `loading="lazy"` inside a hidden box, so the browser fetches it only
  // after the first time the preview opens.
  let { name, image }: { name: string; image: string | null } = $props();
  const id = $props.id();

  let enhanced = $state(false);
  let hover = $state(false);
  let focused = $state(false);
  let pinned = $state(false);
  let flipX = $state(false);
  let flipY = $state(false);
  let root: HTMLSpanElement | undefined = $state();
  const visible = $derived(hover || focused || pinned);

  onMount(() => {
    enhanced = true;
  });

  // Keep the image inside the window: open to the left or upwards when it would not
  // fit to the right or below.
  function place(): void {
    if (root === undefined) return;
    const r = root.getBoundingClientRect();
    flipX = r.left + 260 > window.innerWidth;
    flipY = r.bottom + 360 > window.innerHeight && r.top > 360;
  }

  function close(): void {
    hover = false;
    focused = false;
    pinned = false;
  }

  function onkeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
  }
</script>

<svelte:window
  onclick={(e: MouseEvent) => {
    if (pinned && root !== undefined && !root.contains(e.target as Node))
      pinned = false;
  }}
/>

{#if image !== null && enhanced}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <span
    class="wrap"
    bind:this={root}
    onpointerenter={(e) => {
      if (e.pointerType === "mouse") {
        place();
        hover = true;
      }
    }}
    onpointerleave={() => (hover = false)}
    {onkeydown}
  >
    <button
      type="button"
      class="name"
      aria-expanded={visible}
      aria-controls="preview-{id}"
      onclick={() => {
        place();
        pinned = !pinned;
      }}
      onfocus={(e) => {
        if (e.currentTarget.matches(":focus-visible")) {
          place();
          focused = true;
        }
      }}
      onblur={() => (focused = false)}>{name}</button
    >
    <span
      id="preview-{id}"
      class="preview"
      class:flip-x={flipX}
      class:flip-y={flipY}
      hidden={!visible}
    >
      <img src={image} alt="Card image of {name}" loading="lazy" />
    </span>
  </span>
{:else}
  <span class="plain">{name}</span>
{/if}

<style>
  .wrap {
    position: relative;
    display: inline-block;
    max-width: 100%;
  }
  .name {
    all: unset;
    cursor: pointer;
    color: var(--fg);
    border-bottom: 1px dotted var(--muted);
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  .name:hover {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
  .name:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 2px;
  }
  .preview {
    position: absolute;
    z-index: 20;
    left: 0;
    top: calc(100% + 0.35rem);
    width: min(15.5rem, 70vw);
    padding: 0.25rem;
    border-radius: 0.75rem;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: 0 0.5rem 1.5rem var(--shadow);
    pointer-events: none;
  }
  .preview[hidden] {
    display: none;
  }
  .preview.flip-x {
    left: auto;
    right: 0;
  }
  .preview.flip-y {
    top: auto;
    bottom: calc(100% + 0.35rem);
  }
  .preview img {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: 488 / 680;
    border-radius: 0.6rem;
    background: var(--border);
  }
  /* On a phone the preview is a sheet at the bottom of the window. */
  @media (max-width: 40rem) {
    .preview,
    .preview.flip-x,
    .preview.flip-y {
      position: fixed;
      left: 50%;
      right: auto;
      top: auto;
      bottom: 1rem;
      transform: translateX(-50%);
      width: min(16rem, 72vw);
    }
  }
</style>
