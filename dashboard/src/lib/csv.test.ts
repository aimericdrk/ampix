import { describe, expect, it, vi } from 'vitest';
import { downloadCsv, toCsv } from './csv';

describe('toCsv', () => {
  it('joins headers and rows with commas and CRLF line endings', () => {
    expect(toCsv(['Name', 'Count'], [['Apple', '5'], ['Banana', '10']])).toBe(
      'Name,Count\r\nApple,5\r\nBanana,10',
    );
  });

  it('returns just the header line when rows is empty', () => {
    expect(toCsv(['Name', 'Count'], [])).toBe('Name,Count');
  });

  it('quotes fields containing a comma', () => {
    expect(toCsv(['Name'], [['Doe, Jane']])).toBe('Name\r\n"Doe, Jane"');
  });

  it('quotes fields containing a double quote and doubles it', () => {
    expect(toCsv(['Name'], [['5" screen']])).toBe('Name\r\n"5"" screen"');
  });

  it('quotes fields containing a newline', () => {
    expect(toCsv(['Notes'], [['line one\nline two']])).toBe('Notes\r\n"line one\nline two"');
  });

  it('quotes fields containing a carriage return', () => {
    expect(toCsv(['Notes'], [['line one\rline two']])).toBe('Notes\r\n"line one\rline two"');
  });

  it('leaves plain fields unquoted', () => {
    expect(toCsv(['Name'], [['Plain Value']])).toBe('Name\r\nPlain Value');
  });

  it('handles empty string fields', () => {
    expect(toCsv(['Name', 'Count'], [['', '5']])).toBe('Name,Count\r\n,5');
  });

  it('handles a field that is only a quote character', () => {
    expect(toCsv(['Name'], [['"']])).toBe('Name\r\n""""');
  });

  it('handles multiple rows with mixed quoting needs', () => {
    expect(
      toCsv(
        ['Name', 'Bio'],
        [
          ['Alex', 'Loves, "commas"'],
          ['Sam', 'plain'],
        ],
      ),
    ).toBe('Name,Bio\r\nAlex,"Loves, ""commas"""\r\nSam,plain');
  });
});

describe('downloadCsv', () => {
  it('creates an object URL, an anchor, clicks it, then revokes the URL', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    const revokeObjectURL = vi.fn();
    // jsdom doesn't implement these; stub them for this assertion.
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    downloadCsv('report', 'a,b\r\n1,2');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

    clickSpy.mockRestore();
  });

  it('appends a .csv suffix when the filename lacks one', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const createElementSpy = vi.spyOn(document, 'createElement');

    downloadCsv('users', 'a\r\n1');

    const anchor = createElementSpy.mock.results.find(
      (r) => r.value instanceof HTMLAnchorElement,
    )?.value as HTMLAnchorElement;
    expect(anchor.download).toBe('users.csv');

    clickSpy.mockRestore();
    createElementSpy.mockRestore();
  });
});
