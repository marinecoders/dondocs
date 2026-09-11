/**
 * The output root comes from DONDOCS_OUT_ROOT. A bundle host fills that from
 * a setting whose default is written with a placeholder (`${DOCUMENTS}`); if
 * the placeholder arrives unexpanded, the companion must not make a folder by
 * that name under whatever directory it was launched in.
 */
// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { DEFAULT_ROOT, outputRoot } from '../../companion/outputPath';

const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
afterEach(() => { stderr.mockClear(); });

describe('outputRoot', () => {
  it('is the default when the variable is unset or empty', () => {
    expect(outputRoot(undefined)).toBe(DEFAULT_ROOT);
    expect(outputRoot('')).toBe(DEFAULT_ROOT);
    expect(stderr).not.toHaveBeenCalled();
  });

  it('is the variable when it names a directory', () => {
    expect(outputRoot('/Users/someone/Letters')).toBe('/Users/someone/Letters');
    expect(stderr).not.toHaveBeenCalled();
  });

  it.each(['${DOCUMENTS}/DonDocs', '${user_config.output_dir}'])('ignores %s and says so on stderr', (value) => {
    expect(outputRoot(value)).toBe(DEFAULT_ROOT);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('DONDOCS_OUT_ROOT'));
  });
});
