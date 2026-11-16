<script lang="ts">
  import { page } from "$app/state";
  import "../lib/theme.css";
</script>

<svelte:head
  ><title
    >{page.status === 503
      ? "Preparing data"
      : page.status === 404
        ? "Not found"
        : `Error ${page.status}`}</title
  ></svelte:head
>

<main class="error">
  {#if page.status === 503}
    <h1>Preparing data</h1>
    <p>
      The deck repository and the card data are loading. Try again in a minute.
    </p>
  {:else if page.status === 404}
    <h1>Not found</h1>
    <p>
      There is nothing at this address. <a href="/">Back to the gauntlets</a>.
    </p>
  {:else}
    <h1>Error {page.status}</h1>
    <p>{page.error?.message}</p>
  {/if}
</main>

<style>
  .error {
    max-width: 40rem;
    margin: 4rem auto;
    padding: 0 1rem;
  }
</style>
