/**
 * Page correlation helper: is the current page still the captured page?
 *
 * Compares protocol + host + pathname + search; the hash/fragment is ignored
 * because fragment changes are not page-identity changes. Unparseable input is
 * treated as "not the same page" (fail safe).
 */
export function isSameCapturedPage(expectedUrl: string, actualUrl: string): boolean {
  let expected: URL;
  let actual: URL;
  try {
    expected = new URL(expectedUrl);
    actual = new URL(actualUrl);
  } catch {
    return false;
  }
  return (
    expected.protocol === actual.protocol &&
    expected.host === actual.host &&
    expected.pathname === actual.pathname &&
    expected.search === actual.search
  );
}
