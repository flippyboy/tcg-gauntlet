// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {
    // Nothing is stored in `locals` or `PageData` at the app level.
    interface Error {
      message: string;
    }
  }
}

export {};
