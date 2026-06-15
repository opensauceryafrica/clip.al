import { describe, expect, it } from 'vitest';
import { isDatacenterIp } from './asn-denylist';

describe('isDatacenterIp', () => {
  it('matches known datacenter IPv4 ranges', () => {
    expect(isDatacenterIp('3.5.6.7')).toBe(true); // AWS 3.0.0.0/9
    expect(isDatacenterIp('34.192.0.1')).toBe(true); // AWS 34.192.0.0/10
    expect(isDatacenterIp('20.1.2.3')).toBe(true); // Azure 20.0.0.0/8
    expect(isDatacenterIp('159.65.10.10')).toBe(true); // DigitalOcean
    expect(isDatacenterIp('5.9.1.1')).toBe(true); // Hetzner
    expect(isDatacenterIp('51.38.0.5')).toBe(true); // OVH
  });

  it('does not match residential / public-resolver IPs', () => {
    expect(isDatacenterIp('8.8.8.8')).toBe(false);
    expect(isDatacenterIp('1.1.1.1')).toBe(false);
    expect(isDatacenterIp('203.0.113.7')).toBe(false);
    expect(isDatacenterIp('100.64.1.2')).toBe(false);
  });

  it('handles v4-mapped v6 addresses', () => {
    expect(isDatacenterIp('::ffff:3.5.6.7')).toBe(true);
    expect(isDatacenterIp('::ffff:8.8.8.8')).toBe(false);
  });

  it('matches known datacenter IPv6 ranges', () => {
    expect(isDatacenterIp('2600:1f00::1')).toBe(true); // AWS
    expect(isDatacenterIp('2a01:4f8:abcd::1')).toBe(true); // Hetzner
    expect(isDatacenterIp('2001:4860:4860::8888')).toBe(false); // Google DNS (not in list)
  });

  it('never throws on garbage / empty input', () => {
    expect(isDatacenterIp('')).toBe(false);
    expect(isDatacenterIp('0.0.0.0')).toBe(false);
    expect(isDatacenterIp('not-an-ip')).toBe(false);
    expect(isDatacenterIp('999.999.999.999')).toBe(false);
    expect(isDatacenterIp('::')).toBe(false);
    expect(isDatacenterIp(':::::')).toBe(false);
  });
});
