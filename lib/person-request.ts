import { PERSON_HEADER, PERSON_PARAM } from "./people";

/** The page's `<meta>` naming the person it was rendered for (see app/page.tsx). */
export const PERSON_META = "carby-person";

/**
 * `fetch` for Carby's own API, naming the person this page was opened for. Switching people in
 * another tab changes only the default, so a request from this tab still reaches this person.
 */
export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const person = document.querySelector<HTMLMetaElement>(`meta[name="${PERSON_META}"]`)?.content;
  const headers = new Headers(init.headers);
  if (person) headers.set(PERSON_HEADER, person);
  return fetch(input, { ...init, headers });
}

/** A plain link (such as a download) to Carby's API for `person`; links can't send headers. */
export function personHref(path: string, person: string): string {
  const url = new URL(path, "http://carby.invalid");
  url.searchParams.set(PERSON_PARAM, person);
  return `${url.pathname}${url.search}`;
}
