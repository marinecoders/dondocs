import { describe, it, expect, beforeEach } from 'vitest';
import { useRoutingStore, sanitizeOverrides } from '@/stores/routingStore';

beforeEach(() => useRoutingStore.setState({ overrides: {} }));

describe('routingStore', () => {
  it('sets and reads an override, trimming whitespace', () => {
    useRoutingStore.getState().setOverride('pay', '  IPAC Bldg 100 pay window  ');
    expect(useRoutingStore.getState().overrides.pay).toBe('IPAC Bldg 100 pay window');
  });

  it('treats an empty/whitespace value as a clear, not a stored blank', () => {
    useRoutingStore.getState().setOverride('pay', 'X');
    useRoutingStore.getState().setOverride('pay', '   ');
    expect('pay' in useRoutingStore.getState().overrides).toBe(false);
  });

  it('clears one override and resets all', () => {
    const s = useRoutingStore.getState();
    s.setOverride('pay', 'A');
    s.setOverride('leave', 'B');
    s.clearOverride('pay');
    expect(useRoutingStore.getState().overrides).toEqual({ leave: 'B' });
    useRoutingStore.getState().resetOverrides();
    expect(useRoutingStore.getState().overrides).toEqual({});
  });
});

describe('sanitizeOverrides', () => {
  it('keeps known ids with non-empty string values, trimmed', () => {
    expect(sanitizeOverrides({ pay: 'IPAC', leave: '  Chain of command  ' })).toEqual({
      pay: 'IPAC',
      leave: 'Chain of command',
    });
  });

  it('drops unknown ids, non-string values, and blanks', () => {
    expect(sanitizeOverrides({ not_a_real_id: 'x', pay: 42, leave: '   ' })).toEqual({});
  });

  it('returns {} for non-object input', () => {
    expect(sanitizeOverrides(null)).toEqual({});
    expect(sanitizeOverrides('nope')).toEqual({});
    expect(sanitizeOverrides(undefined)).toEqual({});
  });
});
